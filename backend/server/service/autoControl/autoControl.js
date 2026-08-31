/**
 * 【文件职责】正常状况联动（自动控制）服务，仅在 AUTO_CONTROL.enabled 开启时运行
 * （项目里已经没有独立的设备“自动/手动模式”概念）。
 *
 * 自动启停水泵和加热，与安全联锁（safetyInterlock）相互独立：
 *   - 安全联锁负责“异常时强制关闭”（保护）。
 *   - 自动控制负责“正常时按目标启停”（控制）。
 *
 * 规则（均可通过配置中心 AUTO_CONTROL 独立开关）：
 * 【水泵开】任意水箱温度低于目标温度，且无故障、其他传感器数值正常。
 * 【水泵关】T1/T2 均达到目标温度且温差小于阈值；或触发堵管/漏水/干烧保护；或累计流量达到目标。
 * 【加热开】T1 温度小于目标温度，且无故障。
 * 【加热关】T1 >= 目标温度；或水泵关闭/流量=0；或触发堵管/漏水/干烧保护；或 T1/T2 温差过大。
 *
 * 阈值与目标温度实时读取指令中心 t_direct，页面修改即时生效。
 * 【配置中心关联】AUTO_CONTROL 每次评估动态读取。
 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')
const { firstValue, getTopic, buildSwitchPayload } = require('../../utils/protocol')
const { resolveDeviceNo, resolveFieldAliases } = require('../../utils/mappedData')
const { getDirectValue, saveDirectData } = require('../directData/saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory/saveOperationHistory')
const { isPidEnabled } = require('../pidHeating/pidHeating')
const { isLockedByFault, isAnyLocked } = require('../faultStatus/faultStatus')

/** 异常最大值哨兵。 */
const ABNORMAL_MAX = 9999

/** 阈值槽位（优先 preffix，其次中文名）。 */
const THRESHOLD_SLOTS = {
  tempHigh: { prefix: 'temp_high', name: '温度上限阈值' },
  tempLow: { prefix: 'temp_low', name: '温度下限阈值' },
  flowLow: { prefix: 'flow_low', name: '流量下限阈值' },
  flowHigh: { prefix: 'flow_high', name: '流量上限阈值' },
  pressureLow: { prefix: 'pressure_low', name: '压力下限阈值' },
  pressureHigh: { prefix: 'pressure_high', name: '压力上限阈值' },
}

/** 上次该条件动作，用于日志与最小化重复下发。 */
const lastActions = new Map()
/** 防抖：不允许同一设备在极短时间内反复切换同一开关。 */
const lastSwitchTime = new Map()

/* ============================ 工具函数 ============================ */

async function resolveConfigIdByPrefix(prefix) {
  if (!prefix) return null
  const [rows] = await promisePool.query(
    "SELECT id FROM t_direct_config WHERE preffix IS NOT NULL AND preffix != '' AND LOWER(preffix) = LOWER(?) ORDER BY id ASC LIMIT 1",
    [prefix]
  )
  return rows[0]?.id ?? null
}

// 先按 preffix 查，查不到再按中文名兜底，两种方式任一种能对上号就行，
// 不强制要求现场一定把 preffix 配置齐全。
async function resolveThresholdConfigId(slot) {
  const def = THRESHOLD_SLOTS[slot]
  if (!def) return null
  const byPrefix = await resolveConfigIdByPrefix(def.prefix)
  if (byPrefix != null) return byPrefix
  const [rows] = await promisePool.query(
    'SELECT id FROM t_direct_config WHERE t_name = ? ORDER BY id ASC LIMIT 1',
    [def.name]
  )
  return rows[0]?.id ?? null
}

async function toNumber(raw) {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

async function getThresholdValue(slot, deviceNo) {
  const configId = await resolveThresholdConfigId(slot)
  if (configId == null) return null
  return toNumber(await getDirectValue({ config_id: configId, d_no: deviceNo }))
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

async function findSwitchConfig(prefix, name) {
  const byPrefix = await resolveConfigIdByPrefix(prefix)
  const [rows] = await promisePool.query(
    `SELECT id, t_name, preffix, wire_template, wire_on_payload, wire_off_payload, f_type FROM t_direct_config
     WHERE f_type = '1' AND (id = ? OR t_name LIKE ?) ORDER BY (id = ?) DESC, id ASC LIMIT 1`,
    [byPrefix ?? -1, `%${name}%`, byPrefix ?? -1]
  )
  return rows[0] || null
}

/** 读目标温度：优先指令中心 target_temperature，否则用配置中心默认值。 */
async function getTargetTemp(deviceNo, fallback) {
  const configId = await resolveConfigIdByPrefix('target_temperature')
  const value = configId != null
    ? await toNumber(await getDirectValue({ config_id: configId, d_no: deviceNo }))
    : null
  return value != null ? value : Number(fallback) || 22
}

/** 读取设备当前水泵/加热开关线上状态（water_Y2/heat_Y1）。 */
async function readSwitchStates(info) {
  const pumpAliases = await resolveFieldAliases('t_behavior_data', 'field1')
  const heatAliases = await resolveFieldAliases('t_behavior_data', 'field2')
  const rawPump = firstValue(info, pumpAliases)
  const rawHeat = firstValue(info, heatAliases)
  const toOn = v => {
    if (v == null) return null
    const s = String(v).trim().toLowerCase()
    return ['on', 'open', '1', 'true'].includes(s)
  }
  return { pumpOn: toOn(rawPump), heatOn: toOn(rawHeat) }
}

/** 故障检测：堵管 / 漏水 / 干烧。返回命中的故障名称数组。 */
async function detectFaults(sensors, deviceNo, states) {
  const faults = []
  const flowLow = await getThresholdValue('flowLow', deviceNo)
  const pressureHigh = await getThresholdValue('pressureHigh', deviceNo)

  // 干烧：水泵和加热均开启时，流量低于下限。
  if (states.pumpOn && states.heatOn && flowLow != null && sensors.flow != null && sensors.flow < flowLow) {
    faults.push('干烧')
  }
  // 堵管：压力高于上限且流量低于下限。
  if (pressureHigh != null && sensors.pressure != null && sensors.pressure > pressureHigh
    && flowLow != null && sensors.flow != null && sensors.flow < flowLow) {
    faults.push('堵管')
  }
  // 漏水：压力为 0 且流量为 0 或低于下限。
  if (sensors.pressure === 0 && (sensors.flow === 0 || (flowLow != null && sensors.flow != null && sensors.flow < flowLow))) {
    faults.push('漏水')
  }
  return faults
}

/* ============================ 下发控制 ============================ */

async function setSwitch(prefix, name, value, deviceNo, source) {
  const conf = await findSwitchConfig(prefix, name)
  if (!conf) return false
  const mqttClient = require('../../mqtt')
  const payload = buildSwitchPayload(conf, value)
  if (!systemConfig.getConfig().SINGLE_DEVICE_MODE && deviceNo) payload.d_no = deviceNo
  await mqttClient.publish(getTopic('control'), payload, { qos: systemConfig.getConfig().MQTT_QOS })
  const oldValue = await getDirectValue({ config_id: conf.id, d_no: deviceNo })
  await saveDirectData({ config_id: conf.id, value, d_no: deviceNo })
  await saveOperationHistory({ d_no: deviceNo, config_id: conf.id, old_value: oldValue, new_value: value, source })
  console.log(`[AutoControl] ${name} -> ${value}（${source}），设备 ${deviceNo || '全局'}`)
  return true
}

// 为什么需要防抖：传感器数值会在阈值附近小幅波动（比如温度在目标值上下 0.1℃ 抖动），
// 如果不限制频率，每条 MQTT 消息都可能得出不同的开关结论，导致水泵/加热来回猛烈切换
// （继电器频繁通断也会加速硬件老化）。这里强制同一个开关至少间隔 minIntervalMs 才能
// 再次动作，把频繁的小幅判断波动过滤掉。
/** 防抖：同一设备同一开关切换至少间隔 minIntervalMs。 */
function canAct(deviceNo, key, minIntervalMs = 3000) {
  const k = `${deviceNo || 'global'}:${key}`
  const last = lastSwitchTime.get(k) || 0
  if (Date.now() - last < minIntervalMs) return false
  lastSwitchTime.set(k, Date.now())
  return true
}

/* ============================ 决策 ============================ */

function decidePump(sensors, targetTemp, faults, diffCloseThreshold) {
  const temps = [sensors.temp1, sensors.temp2].filter(v => v != null)
  // allNormal：流量/压力都拿到了有效读数、不是 0、也没有触到 ABNORMAL_MAX 这个异常
  // 哨兵值——只有这三个条件都满足才认为传感器读数可信，才允许自动开水泵。这是为了
  // 避免传感器掉线/短路（读数变成 0 或钳位到极端大值）时系统还傻乎乎地把水泵打开。
  const allNormal = faults.length === 0
    && sensors.flow != null && sensors.flow !== 0 && sensors.flow < ABNORMAL_MAX
    && sensors.pressure != null && sensors.pressure !== 0 && sensors.pressure < ABNORMAL_MAX

  // 【关】任一保护故障。
  if (faults.length > 0) return 'off'

  // 【关】两侧温度均达到目标且温差小于阈值。为什么还要求温差小于阈值才关泵：如果
  // 两侧都到了目标温度但温差很大（比如水没循环均匀），说明水路还没真正混合均匀，
  // 这时候关泵会让温度分布进一步失衡，所以要等温差也收敛了才真正停泵。
  if (temps.length === 2 && temps.every(t => t >= targetTemp)
    && Math.abs(sensors.temp1 - sensors.temp2) < diffCloseThreshold) {
    return 'off'
  }

  // 【开】任一温度低于目标且其他传感器正常。
  if (temps.some(t => t < targetTemp) && allNormal) return 'on'

  return null
}

function decideHeater(sensors, targetTemp, faults, states, diffOpenThreshold) {
  const temp1 = sensors.temp1
  const diff = (sensors.temp1 != null && sensors.temp2 != null) ? Math.abs(sensors.temp1 - sensors.temp2) : null

  // 【关】保护故障。
  if (faults.length > 0) return 'off'
  // 【关】水泵关闭或瞬时流量=0：这是防干烧的关键一条——没有水流动的情况下加热器
  // 还在通电，热量出不去会导致局部温度飙升甚至烧坏加热管，所以水泵没开/没水流就
  // 绝对不能开加热，跟水泵是否达到目标温度完全无关，优先级最高。
  if (states.pumpOn === false || (sensors.flow != null && sensors.flow === 0)) return 'off'
  // 【关】温差过大。
  if (diff != null && diff > diffOpenThreshold) return 'off'
  // 【关】T1 >= 目标。
  if (temp1 != null && temp1 >= targetTemp) return 'off'
  // 【开】T1 < 目标。
  if (temp1 != null && temp1 < targetTemp) return 'on'

  return null
}

/* ============================ 主评估 ============================ */

async function evaluateAutoControl(info) {
  const rootConfig = systemConfig.getConfig()
  // CONTROL_MODE='layered' 时改由 service/layeredControl/layeredControl.js 接管，避免两套逻辑同时下发指令。
  if (rootConfig.CONTROL_MODE === 'layered') return []
  const config = rootConfig.AUTO_CONTROL || {}
  if (config.enabled !== true) return []

  // ====== 故障锁短路 ======
  // 故障态下 faultStatus 已强制关闭水泵和加热、并锁定指令页面，
  // 自动控制必须立即返回，避免下一条 MQTT 消息到达时把执行器又重新打开，
  // 否定故障保护。
  // 单设备模式直接查任意锁；多设备模式按 d_no 精确匹配。
  if (rootConfig.SINGLE_DEVICE_MODE === true) {
    if (isAnyLocked()) return []
  } else {
    const preDeviceNo = String((await resolveDeviceNo(info)) || '').trim() || null
    if (isLockedByFault(preDeviceNo)) return []
  }

  const deviceNo = String((await resolveDeviceNo(info)) || '').trim() || null

  const sensors = await readSensors(info)
  const states = await readSwitchStates(info)
  const targetTemp = await getTargetTemp(deviceNo, rootConfig.DEFAULT_TARGET_TEMP)
  const diffCloseThreshold = Number(config.tempDiffCloseThreshold ?? 2)
  const diffOpenThreshold = Number(config.tempDiffOpenThreshold ?? 3)

  const faults = await detectFaults(sensors, deviceNo, states)

  const actions = []
  const result = { targetTemp, faults, sensors }

  // 水泵控制。
  if (config.pump !== false) {
    const desired = decidePump(sensors, targetTemp, faults, diffCloseThreshold)
    result.pumpDesired = desired
    if (desired && states.pumpOn !== undefined && states.pumpOn !== (desired === 'on') && canAct(deviceNo, 'pump')) {
      await setSwitch('pump', '水泵', desired, deviceNo, 'auto_control')
      actions.push({ device: 'pump', action: desired })
    }
  }

  // 加热控制。“自动控制开关”（指令配置页面）开启时改由 service/pidHeating/pidHeating.js
  // 接管加热，这里跳过，避免两边抢控制权。
  if (config.heater !== false && !(await isPidEnabled(deviceNo))) {
    const desired = decideHeater(sensors, targetTemp, faults, states, diffOpenThreshold)
    result.heaterDesired = desired
    if (desired && states.heatOn !== undefined && states.heatOn !== (desired === 'on') && canAct(deviceNo, 'heater')) {
      await setSwitch('heater', '加热', desired, deviceNo, 'auto_control')
      actions.push({ device: 'heater', action: desired })
    }
  }

  result.actions = actions
  lastActions.set(deviceNo, result)

  if (actions.length) {
    console.log(`[AutoControl] 设备 ${deviceNo || '全局'} 自动联动:`, JSON.stringify(actions), '故障:', faults)
  }
  return actions
}

module.exports = { evaluateAutoControl }