/**
 * 【文件职责】“需要计算的数据”服务：从实时上报数据派生工程指标，供首页专用板块展示。
 *
 * 计算指标（可配置显示开关，见 COMPUTED_METRICS）：
 *   1. 系统阻力系数 K = ΔP / Q²（管路结垢/堵塞黄金指标）
 *   2. 压力陡降速率 V = dP/dt（吸入空气紧急停泵判定）
 *   3. 温度变化率 dT/dt（传感器断线/开路/短路判定）
 *   4. 换热效率 η = ρ·Cp·Q·ΔT / P_heater（ρ/Cp 默认水的物性参数，可在配置中心改）
 *   5. 系统能效比（COP）与热平衡
 *   6. 流量-压力特性曲线拟合（线性回归斜率）
 *   7. 累计流量（上一时刻总流量 + 瞬时流量 × 时间）
 *   8. 平均流速 v = Q / A
 *   9. 液位（基于两水箱初始水量与累计流量）
 *
 * 内存中维护滚动状态；每条 MQTT 消息调用 compute() 更新并返回最新结果。
 * 【配置中心关联】COMPUTED_METRICS 每次计算读取，保存后立即生效。
 */
const systemConfig = require('../../config/systemConfig')
const promisePool = require('../../config/dbPool')
const { firstValue } = require('../../utils/protocol')
const { resolveDeviceNo, resolveFieldAliases } = require('../../utils/mappedData')


/** 每个设备的滚动状态。 */
const stateMap = new Map()

/** 每个设备状态的初始值：cumulativeFlowL 累计流量供指标 7/9 用；last 记上
 * 一次读数供指标 2/3（差分类）算变化率用；curve/kHistory 分别是指标 6/1 的
 * 滚动历史窗口；series 是首页小趋势图用的最近 60 个点。 */
function initialState() {
  return {
    cumulativeFlowL: 0,
    last: null, // { pressure, temp1, temp2, timestamp }
    curve: [], // [{ flow, pressure }]
    kHistory: [], // [{ k, timestamp }]
    series: [], // [{ time, averageTemp, averageVelocity }]
    latest: null,
  }
}

/** 取（或首次创建）一个设备的滚动状态，每个 deviceNo 各自独立一份，互不影响。 */
function getState(deviceNo) {
  if (!stateMap.has(deviceNo)) stateMap.set(deviceNo, initialState())
  return stateMap.get(deviceNo)
}

/** 把原始字符串/数字转成有限数字，转不出来统一返回 null，不会把 NaN 带进后面的计算。 */
async function toNumber(raw) {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

async function readSensors(info) {
  const out = {}
  // SENSOR_FIELD_MAP 来自配置中心，不能在模块顶层缓存（要求实时取值，热更新才能生效）。
  for (const [key, field] of Object.entries(systemConfig.getConfig().SENSOR_FIELD_MAP)) {
    const aliases = await resolveFieldAliases('t_sensor_data', field)
    out[key] = await toNumber(firstValue(info, aliases))
  }
  return out
}

/** 读取水泵/加热开关线上状态。 */
async function readSwitchStates(info) {
  const pumpAliases = await resolveFieldAliases('t_behavior_data', 'field1')
  const heatAliases = await resolveFieldAliases('t_behavior_data', 'field2')
  const toOn = v => {
    if (v == null) return null
    const s = String(v).trim().toLowerCase()
    return ['on', 'open', '1', 'true'].includes(s)
  }
  return {
    pumpOn: toOn(firstValue(info, pumpAliases)),
    heatOn: toOn(firstValue(info, heatAliases)),
  }
}

/** 除法的安全版本：除数是 0/null/非有限数，或者被除数不是有限数，统一
 * 返回 null，不会算出 Infinity/NaN 混进展示结果里。 */
function safeDivide(num, den) {
  if (den == null || den === 0 || !Number.isFinite(den) || num == null || !Number.isFinite(num)) return null
  const value = num / den
  return Number.isFinite(value) ? value : null
}

/** 线性回归斜率（压力 vs 流量）。 */
function linearSlope(points) {
  if (points.length < 2) return null
  const xs = points.map(p => p.flow)
  const ys = points.map(p => p.pressure)
  const n = xs.length
  const xMean = xs.reduce((a, b) => a + b, 0) / n
  const yMean = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean)
    den += (xs[i] - xMean) ** 2
  }
  if (den === 0) return null
  return num / den
}

/** 计算 K 值在最近 3 天内的变化趋势（返回比例，如 0.05 表示上升 5%）。 */
function kTrend(kHistory) {
  if (kHistory.length < 2) return null
  const now = Date.now()
  const threeDaysAgo = now - 3 * 24 * 3600 * 1000
  const recent = kHistory.filter(h => h.timestamp >= threeDaysAgo)
  if (recent.length < 2) return null
  const first = recent[0].k
  const latest = recent[recent.length - 1].k
  if (!first || first === 0) return null
  return (latest - first) / first
}

async function compute(info, timestampMs = Date.now(), knownDeviceNo = undefined) {
  const config = systemConfig.getConfig().COMPUTED_METRICS || {}
  // refreshFromDB() 回放历史数据时，传进来的 info.d_no 是已经落库、已经解析过的
  // 设备号（不是设备原始上报的 id 字段），不能再让 resolveDeviceNo 重新按
  // DEVICE_ID_FIELDS 当成原始序列号去 t_device.number 里找一遍——DEVICE_ID_FIELDS
  // 里恰好也配了 'd_no' 这个候选名，会导致查不到匹配、误判成未识别设备。knownDeviceNo
  // 由 refreshFromDB() 显式传入已解析好的设备号时跳过重新解析；实时消息路径不传，
  // 走原来的 resolveDeviceNo(info) 逻辑。
  const deviceNo = knownDeviceNo !== undefined
    ? (String(knownDeviceNo || '').trim() || null)
    : String((await resolveDeviceNo(info)) || '').trim() || null
  const state = getState(deviceNo)

  const sensors = await readSensors(info)
  const switches = await readSwitchStates(info)
  const nowMs = timestampMs

  const result = {
    deviceNo,
    timestamp: nowMs,
    flags: {
      resistanceK: config.resistanceK !== false,
      pressureDropRate: config.pressureDropRate !== false,
      tempChangeRate: config.tempChangeRate !== false,
      heatExchangeEfficiency: config.heatExchangeEfficiency !== false,
      eerHeatBalance: config.eerHeatBalance !== false,
      flowPressureCurve: config.flowPressureCurve !== false,
      cumulativeFlow: config.cumulativeFlow !== false,
      averageVelocity: config.averageVelocity !== false,
      waterLevel: config.waterLevel !== false,
      averageTempChart: config.averageTempChart !== false,
      averageVelocityChart: config.averageVelocityChart !== false,
    },
    heaterRatedPower: Number(config.heaterRatedPower) || null,
  }

  const flowLPerMin = sensors.flow
  const flowLPerSec = flowLPerMin != null ? flowLPerMin / 60 : null
  const pressure = sensors.pressure
  const temp1 = sensors.temp1
  const temp2 = sensors.temp2

  // ---- 平均温度 = (T1 + T2) / 2 ----
  const averageTemp = temp1 != null && temp2 != null ? (temp1 + temp2) / 2 : null
  if (averageTemp != null) result.averageTemp = { value: Number(averageTemp.toFixed(2)), unit: '℃' }

  // ---- 1. 系统阻力系数 K = ΔP / Q²（Q 单位 L/s，避开 Q=0） ----
  // 物理依据：管路水流阻力跟流量的平方成正比（这是流体力学里常见的紊流
  // 阻力关系），K 就是这个比例系数，只反映管路本身"通不通畅"，不随瞬时
  // 流量大小变化——管路结垢、局部堵塞会让内径变小、阻力变大，K 就会持续
  // 走高，所以拿它最近 3 天的变化趋势（kTrend）提示"该清洗管路了"。
  if (flowLPerSec != null && flowLPerSec !== 0 && pressure != null) {
    const k = safeDivide(pressure, flowLPerSec ** 2)
    if (k != null) {
      state.kHistory.push({ k, timestamp: nowMs })
      if (state.kHistory.length > 2000) state.kHistory.shift()
      result.resistanceK = {
        value: Number(k.toFixed(4)),
        unit: 'kPa/(L/s)²',
        trend3d: kTrend(state.kHistory),
      }
    }
  }

  // ---- 2. 压力陡降速率 V = dP/dt ----
  // 正常运行时压力变化是平缓的；水泵吸入空气（比如水箱快抽空、管路密封
  // 不严进气）会让压力在很短时间内断崖式下跌——这种"跌得极快"跟"正常慢慢
  // 降压"在数值上差异很明显，dropInHalfSecond 单独标记"0.5 秒内骤降"，
  // 比只盯着压力绝对值本身更早发现吸空气这种需要紧急处理的情况。
  if (state.last && pressure != null && state.last.pressure != null) {
    const dtSec = (nowMs - state.last.timestamp) / 1000
    if (dtSec > 0) {
      result.pressureDropRate = {
        value: Number(((pressure - state.last.pressure) / dtSec).toFixed(3)),
        unit: 'kPa/s',
        dropInHalfSecond: dtSec <= 0.5 && (pressure - state.last.pressure) < 0,
      }
    }
  }

  // ---- 3. 温度变化率 dT/dt ----
  // 正常加热/降温时温度是连续、平缓变化的；传感器断线通常会让读数卡死在
  // 一个固定值不动（变化率趋近 0），短路则可能让读数瞬间冲高或掉底——靠
  // "变化率是否符合物理常理"，比只盯着温度绝对值本身更快发现传感器异常。
  if (state.last) {
    const dtSec = (nowMs - state.last.timestamp) / 1000
    if (dtSec > 0) {
      const rate1 = temp1 != null && state.last.temp1 != null ? (temp1 - state.last.temp1) / dtSec : null
      const rate2 = temp2 != null && state.last.temp2 != null ? (temp2 - state.last.temp2) / dtSec : null
      result.tempChangeRate = {
        temp1: rate1 == null ? null : Number(rate1.toFixed(3)),
        temp2: rate2 == null ? null : Number(rate2.toFixed(3)),
        unit: '℃/s',
      }
    }
  }

  // ---- 4 & 5. 换热效率 η 与 能效比/热平衡 ----
  // 换热效率的物理意思：加热器每秒钟往电路里花的电（powerW，额定功率），
  // 有多少真正变成了水带走的热量（heatTransferredW），两者的比值就是效率。
  // "水带走了多少热"怎么算：想象每秒钟有 Q（m³）体积的水流过，从进水温度升到
  // 出水温度，温差是 ΔT。这些水本身的质量是 ρ×Q（密度×体积=质量），把这些水
  // 加热 ΔT 度需要的热量是"质量×比热容×温差"——比热容（Cp）就是"让 1kg 这种
  // 液体升高 1℃需要多少焦耳"，水的比热容比大多数液体都大，也是水常被用来
  // 做冷却/加热介质的原因。合起来就是：
  //     每秒传递的热功率 = 密度ρ × 比热容Cp × 每秒流过的体积Q × 温差ΔT
  // 这也是为什么现场如果不是拿纯水做介质（比如实验用了乙二醇防冻液、盐水），
  // 必须把下面这两个参数改成对应介质的真实物性值——密度、比热容用错了，
  // 这里算出来的"效率"就跟实际不是一回事。
  const deltaT = temp1 != null && temp2 != null ? Math.abs(temp2 - temp1) : null
  const powerW = Number(config.heaterRatedPower)
  if (flowLPerSec != null && deltaT != null && switches.heatOn === true && powerW > 0) {
    // 介质密度/比热容默认是水的物性参数，配置中心没配或不是正数时退回这两个默认值，
    // 现场介质不是纯水（乙二醇防冻液、盐水等）时在"计算数据"页调整即可。
    const waterDensity = Number(config.waterDensity) > 0 ? Number(config.waterDensity) : 1000
    const waterSpecificHeat = Number(config.waterSpecificHeat) > 0 ? Number(config.waterSpecificHeat) : 4200
    const qM3PerSec = flowLPerSec / 1000 // L/s -> m³/s
    // ρ × Cp × Q × ΔT：见上方注释里的公式，算出来的单位是瓦特（W），
    // 因为 kg/m³ × J/(kg·℃) × m³/s × ℃ 约分后正好剩下 J/s = W。
    const heatTransferredW = waterDensity * waterSpecificHeat * qM3PerSec * deltaT
    // 效率 = 实际传给水的热功率 ÷ 加热器额定功率，理论上不该超过 100%（超过了
    // 说明额定功率填错了，或者传感器读数有问题——这里不做上限裁剪，方便发现异常）。
    const efficiency = safeDivide(heatTransferredW, powerW)
    result.heatExchangeEfficiency = {
      value: efficiency == null ? null : Number(efficiency.toFixed(3)),
      unit: '%',
      heatTransferredW: Number(heatTransferredW.toFixed(2)),
    }
    if (efficiency != null) {
      result.eerHeatBalance = {
        cop: Number(efficiency.toFixed(3)),
        heatTransferredW: Number(heatTransferredW.toFixed(2)),
        heatLossW: Number(Math.max(0, powerW - heatTransferredW).toFixed(2)),
        unit: 'W',
      }
    }
  }

  // ---- 6. 流量-压力特性曲线拟合（斜率） ----
  if (flowLPerMin != null && pressure != null) {
    state.curve.push({ flow: flowLPerMin, pressure })
    if (state.curve.length > 60) state.curve.shift()
    const slope = linearSlope(state.curve)
    if (slope != null) {
      result.flowPressureCurve = { slope: Number(slope.toFixed(4)), unit: 'kPa/(L/min)', samples: state.curve.length }
    }
  }

  // ---- 7. 累计流量（上一时刻总流量 + 瞬时流量 × 时间） ----
  if (flowLPerSec != null && flowLPerSec >= 0) {
    const dtSec = state.last ? Math.max(0, Math.min(10, (nowMs - state.last.timestamp) / 1000)) : 1
    state.cumulativeFlowL += flowLPerSec * dtSec
    result.cumulativeFlow = { value: Number(state.cumulativeFlowL.toFixed(2)), unit: 'L' }
  }

  // ---- 8. 平均流速 v = Q / A ----
  let averageVelocity = null
  if (flowLPerSec != null) {
    const areaCm2 = Number(config.pipeAreaCm2)
    if (areaCm2 > 0) {
      const areaM2 = areaCm2 / 10000 // cm² -> m²
      const qM3PerSec = flowLPerSec / 1000 // L/s -> m³/s
      const velocity = safeDivide(qM3PerSec, areaM2)
      if (velocity != null) {
        averageVelocity = Number(velocity.toFixed(4))
        result.averageVelocity = { value: averageVelocity, unit: 'm/s' }
      }
    }
  }

  // ---- 9. 液位（基于两水箱初始水量与累计流量） ----
  // 隐含的物理布局假设：水从水箱 1 被抽出、流经管路和加热器，最终流进水箱 2
  // （所以水箱 1 的水量是"初始量 - 累计流量"、水箱 2 是"初始量 + 累计流量"）。
  // 这不是靠液位传感器实测出来的，是纯粹靠累计流量反推的估算值——现场如果
  // 循环方向不是"1 抽到 2"，或者中途有额外补水/排水，这个估算会跟实际不符。
  const tankAreaCm2 = Number(config.tankAreaCm2)
  if (tankAreaCm2 > 0) {
    const initial1 = Number(config.initialWaterTank1)
    const initial2 = Number(config.initialWaterTank2)
    const water1 = Math.max(0, initial1 - state.cumulativeFlowL)
    const water2 = Math.max(0, initial2 + state.cumulativeFlowL)
    const cmFromLiters = liters => (liters * 1000) / tankAreaCm2 // 1L=1000cm³，高度cm
    result.waterLevel = {
      tank1: { liters: Number(water1.toFixed(2)), levelCm: Number(cmFromLiters(water1).toFixed(2)) },
      tank2: { liters: Number(water2.toFixed(2)), levelCm: Number(cmFromLiters(water2).toFixed(2)) },
      unit: 'cm',
    }
  }

  // 记录时间序列，供首页平均温度/平均流速趋势图使用（最多保留 60 点）。
  const timeLabel = new Date(nowMs).toLocaleTimeString('zh-CN', { hour12: false })
  state.series.push({ time: timeLabel, averageTemp, averageVelocity })
  if (state.series.length > 60) state.series.shift()
  result.series = state.series

  // 更新滚动状态。
  state.last = {
    pressure: pressure != null ? pressure : state.last?.pressure ?? null,
    temp1: temp1 != null ? temp1 : state.last?.temp1 ?? null,
    temp2: temp2 != null ? temp2 : state.last?.temp2 ?? null,
    timestamp: nowMs,
  }
  state.latest = result

  return result
}

/** 从当前配置实时读取各指标的显示开关（配置中心改动后，下次请求立即生效）。 */
function currentFlags() {
  const config = systemConfig.getConfig().COMPUTED_METRICS || {}
  return {
    enabled: config.enabled !== false,
    resistanceK: config.resistanceK !== false,
    pressureDropRate: config.pressureDropRate !== false,
    tempChangeRate: config.tempChangeRate !== false,
    heatExchangeEfficiency: config.heatExchangeEfficiency !== false,
    eerHeatBalance: config.eerHeatBalance !== false,
    flowPressureCurve: config.flowPressureCurve !== false,
    cumulativeFlow: config.cumulativeFlow !== false,
    averageVelocity: config.averageVelocity !== false,
    waterLevel: config.waterLevel !== false,
    averageTempChart: config.averageTempChart !== false,
    averageVelocityChart: config.averageVelocityChart !== false,
  }
}

/** 返回当前内存中最新一次计算结果，并附上最新配置的显示开关。 */
function getLatest() {
  const flags = currentFlags()
  const out = {}
  for (const [deviceNo, state] of stateMap.entries()) {
    if (state.latest) out[deviceNo] = { ...state.latest, flags }
  }
  return out
}

/** 从数据库回放最近历史数据，设备离线时首页计算板块也能有值。 */
async function refreshFromDB() {
  if (stateMap.size > 0) return

  const temp1Aliases = await resolveFieldAliases('t_sensor_data', 'field1')
  const temp2Aliases = await resolveFieldAliases('t_sensor_data', 'field2')
  const flowAliases = await resolveFieldAliases('t_sensor_data', 'field3')
  const pressureAliases = await resolveFieldAliases('t_sensor_data', 'field4')
  const pumpAliases = await resolveFieldAliases('t_behavior_data', 'field1')
  const heatAliases = await resolveFieldAliases('t_behavior_data', 'field2')

  const [[behaviorLatest]] = await promisePool.query(
    'SELECT field1, field2 FROM t_behavior_data ORDER BY id DESC LIMIT 1'
  )
  const pumpState = behaviorLatest ? behaviorLatest.field1 : null
  const heatState = behaviorLatest ? behaviorLatest.field2 : null

  const [sensorRows] = await promisePool.query(
    'SELECT d_no, field1, field2, field3, field4, c_time FROM t_sensor_data ORDER BY id ASC'
  )
  const recent = sensorRows.slice(-120)

  for (const row of recent) {
    const info = { d_no: row.d_no }
    if (temp1Aliases[0]) info[temp1Aliases[0]] = row.field1
    if (temp2Aliases[0]) info[temp2Aliases[0]] = row.field2
    if (flowAliases[0]) info[flowAliases[0]] = row.field3
    if (pressureAliases[0]) info[pressureAliases[0]] = row.field4
    if (pumpAliases[0]) info[pumpAliases[0]] = pumpState
    if (heatAliases[0]) info[heatAliases[0]] = heatState
    const rawTime = row.c_time ? String(row.c_time).replace(' ', 'T') : ''
    const ts = rawTime ? new Date(rawTime).getTime() : NaN
    await compute(info, Number.isFinite(ts) ? ts : Date.now(), row.d_no)
  }
}

module.exports = { compute, getLatest, refreshFromDB }
