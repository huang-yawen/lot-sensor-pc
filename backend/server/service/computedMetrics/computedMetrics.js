/**
 * 【文件职责】“需要计算的数据”服务：从实时上报数据派生工程指标，供首页专用板块展示。
 *
 * 计算指标（可配置显示开关，见 COMPUTED_METRICS）：
 *   1. 系统阻力系数 K = ΔP / Q²（管路结垢/堵塞黄金指标）
 *   2. 压力陡降速率 V = dP/dt（吸入空气紧急停泵判定）
 *   3. 温度变化率 dT/dt（传感器断线/开路/短路判定）
 *   4. 换热效率 η = ρ·Cp·Q·ΔT / P_heater
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

/** 水密度 1000 kg/m³，定压比热容 4200 J/(kg·℃)。 */
const WATER_DENSITY = 1000
const WATER_CP = 4200

/** 传感器字段槽位。 */
const SENSOR_SLOTS = {
  temp1: 'field1',
  temp2: 'field2',
  flow: 'field3',
  pressure: 'field4',
}

/** 每个设备的滚动状态。 */
const stateMap = new Map()

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

function getState(deviceNo) {
  if (!stateMap.has(deviceNo)) stateMap.set(deviceNo, initialState())
  return stateMap.get(deviceNo)
}

async function toNumber(raw) {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

async function readSensors(info) {
  const out = {}
  for (const [key, field] of Object.entries(SENSOR_SLOTS)) {
    const aliases = await resolveFieldAliases('t_sensor_data', field)
    out[key] = await toNumber(firstValue(info, aliases))
  }
  return out
}

/** 读取水泵/加热开关线上状态。 */
async function readSwitchStates(info) {
  const pumpAliases = await resolveFieldAliases('t_behavior_data', 'field2')
  const heatAliases = await resolveFieldAliases('t_behavior_data', 'field3')
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

async function compute(info, timestampMs = Date.now()) {
  const config = systemConfig.getConfig().COMPUTED_METRICS || {}
  const deviceNo = String((await resolveDeviceNo(info)) || '').trim() || null
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
  const deltaT = temp1 != null && temp2 != null ? Math.abs(temp2 - temp1) : null
  const powerW = Number(config.heaterRatedPower)
  if (flowLPerSec != null && deltaT != null && switches.heatOn === true && powerW > 0) {
    const qM3PerSec = flowLPerSec / 1000 // L/s -> m³/s
    const heatTransferredW = WATER_DENSITY * WATER_CP * qM3PerSec * deltaT
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
  const pumpAliases = await resolveFieldAliases('t_behavior_data', 'field2')
  const heatAliases = await resolveFieldAliases('t_behavior_data', 'field3')

  const [[behaviorLatest]] = await promisePool.query(
    'SELECT field2, field3 FROM t_behavior_data ORDER BY id DESC LIMIT 1'
  )
  const pumpState = behaviorLatest ? behaviorLatest.field2 : null
  const heatState = behaviorLatest ? behaviorLatest.field3 : null

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
    await compute(info, Number.isFinite(ts) ? ts : Date.now())
  }
}

module.exports = { compute, getLatest, refreshFromDB }
