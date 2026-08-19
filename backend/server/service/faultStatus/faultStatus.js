/**
 * 【文件职责】故障状态服务：检测硬故障并强制保护——关闭水泵和加热，同时把控制模式
 * 切回手动（自动切换到手动模式，供人工介入维修），与安全联锁（safetyInterlock）相互独立、
 * 都全程生效，二者可能同时触发（本模块的条件多数是安全联锁条件的子集叠加），属于正常的
 * 多层防护重叠，不冲突。
 *
 * 触发条件（均可通过配置中心 FAULT_STATUS 独立开关）：
 *   1. 加热模块故障：(a) 水泵和加热均开启时，流量低于下限阈值（干烧）；
 *      (b) 加热开启后长时间温度都没有明显上升，超过 heaterStallDurationMs（默认 60s）
 *   2. 水泵故障：水泵开启时，流量为 0 且压力为 0，且持续 >= pumpFaultDurationMs（默认 2s）
 *   3. 管道堵塞：压力高于上限阈值且流量低于下限阈值
 *   4. 管道漏水：压力为 0 且（流量低于下限阈值 或 流量为 0）
 *
 * 阈值实时读取指令中心 t_direct，页面修改即时生效。
 * 【配置中心关联】FAULT_STATUS 每次评估动态读取，保存配置后立即生效。
 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')
const { firstValue, getTopic, buildSwitchPayload } = require('../../utils/protocol')
const { resolveDeviceNo, resolveFieldAliases } = require('../../utils/mappedData')
const { saveDirectData, getDirectValue } = require('../directData/saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory/saveOperationHistory')

/** 阈值槽位（优先 preffix，其次中文名），与 safetyInterlock.js/autoControl.js 保持一致。 */
const THRESHOLD_SLOTS = {
  flowLow: { prefix: 'flow_low', name: '流量下限阈值' },
  pressureHigh: { prefix: 'pressure_high', name: '压力上限阈值' },
}

/** 传感器字段槽位。 */
const SENSOR_SLOTS = {
  temp1: 'field1',
  flow: 'field3',
  pressure: 'field4',
}

/** 水泵故障持续计时：记录条件首次成立的时间戳，条件中断则清除。 */
const pumpFaultSince = new Map()
/** 加热温度停滞检测：记录“最近一次明显升温”时的温度和时间戳，加热关闭时清除。 */
const heaterStallState = new Map()
/** 告警冷却时间戳，避免同一故障高频重复触发。 */
const lastFired = new Map()

/* ============================ 工具函数 ============================ */

async function resolveConfigIdByPrefix(prefix) {
  if (!prefix) return null
  const [rows] = await promisePool.query(
    "SELECT id FROM t_direct_config WHERE preffix IS NOT NULL AND preffix != '' AND LOWER(preffix) = LOWER(?) ORDER BY id ASC LIMIT 1",
    [prefix]
  )
  return rows[0]?.id ?? null
}

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
  const num = Number(raw)
  return Number.isFinite(num) ? num : null
}

async function getThresholdValue(slot, deviceNo) {
  const configId = await resolveThresholdConfigId(slot)
  if (configId == null) return null
  return toNumber(await getDirectValue({ config_id: configId, d_no: deviceNo }))
}

async function readSensors(info) {
  const result = {}
  for (const [key, field] of Object.entries(SENSOR_SLOTS)) {
    const aliases = await resolveFieldAliases('t_sensor_data', field)
    result[key] = await toNumber(firstValue(info, aliases))
  }
  return result
}

async function readSwitchStates(info) {
  const pumpAliases = await resolveFieldAliases('t_behavior_data', 'field2')
  const heatAliases = await resolveFieldAliases('t_behavior_data', 'field3')
  const toOn = v => {
    if (v == null) return null
    const s = String(v).trim().toLowerCase()
    return ['on', 'open', '1', 'true'].includes(s)
  }
  return { pumpOn: toOn(firstValue(info, pumpAliases)), heatOn: toOn(firstValue(info, heatAliases)) }
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
  return true
}

/** 关闭水泵和加热，并把控制模式切回手动（自动切换到手动模式，供人工修复）。 */
async function closeAndSwitchManual(deviceNo, triggerId) {
  let published = 0
  for (const [prefix, name] of [['pump', '水泵'], ['heater', '加热']]) {
    try {
      const ok = await setSwitch(prefix, name, 'off', deviceNo, 'fault_status')
      if (ok) {
        published++
        console.log(`[FaultStatus] 故障保护关闭 ${name}（${triggerId}），设备 ${deviceNo || '全局'}`)
      }
    } catch (err) {
      console.error(`[FaultStatus] 关闭 ${name} 失败:`, err.message)
    }
  }
  try {
    await setSwitch('mode', '控制模式', 'off', deviceNo, 'fault_status')
    console.log(`[FaultStatus] 已自动切换到手动模式（${triggerId}），设备 ${deviceNo || '全局'}`)
  } catch (err) {
    console.error('[FaultStatus] 切换手动模式失败:', err.message)
  }
  return published > 0
}

async function recordAlarm(deviceNo, trigger) {
  const time = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const message = `${trigger.name}，已执行故障保护（关闭水泵和加热，自动切换到手动模式），${trigger.detail || ''}`
  await promisePool.execute(
    'INSERT INTO t_error_msg (d_no, c_time, e_msg, e_no, type) VALUES (?, ?, ?, ?, ?)',
    [deviceNo || null, time, message, trigger.id, '故障保护']
  )
}

function withinCooldown(key, cooldownMs) {
  const last = lastFired.get(key) || 0
  return Date.now() - last < cooldownMs
}

function markFired(key) {
  lastFired.set(key, Date.now())
}

async function fire(trigger, deviceNo, faultConfig) {
  const cooldownKey = `${deviceNo || 'global'}:${trigger.id}`
  const cooldownMs = Number(faultConfig.alarmCooldownMs) >= 0 ? Number(faultConfig.alarmCooldownMs) : 30000
  if (withinCooldown(cooldownKey, cooldownMs)) return null
  markFired(cooldownKey)

  await closeAndSwitchManual(deviceNo, trigger.id)
  await recordAlarm(deviceNo, trigger)
  return trigger
}

/* ============================ 主评估 ============================ */

/**
 * 加热开启后长时间温度都没有明显上升，判定为加热模块故障的另一种情形（比如干烧条件
 * 触发不了，但加热管其实已经不发热了）。用“最近一次比基线明显升温”的时间戳滚动判断：
 * 温度比基线高出 heaterStallMinRiseC 就更新基线、重新计时；一直没有明显升温，
 * 超过 heaterStallDurationMs 才判定停滞。加热关闭时清空状态，不跨加热周期累计。
 */
function checkHeaterStall(deviceNo, heatOn, temp1, faultConfig) {
  const key = deviceNo || 'global'
  if (!heatOn || temp1 == null) {
    heaterStallState.delete(key)
    return false
  }
  const minRise = Number(faultConfig.heaterStallMinRiseC) >= 0 ? Number(faultConfig.heaterStallMinRiseC) : 0.3
  const durationMs = Number(faultConfig.heaterStallDurationMs) > 0 ? Number(faultConfig.heaterStallDurationMs) : 60000
  const state = heaterStallState.get(key)
  if (!state) {
    heaterStallState.set(key, { baselineTemp: temp1, since: Date.now() })
    return false
  }
  if (temp1 >= state.baselineTemp + minRise) {
    heaterStallState.set(key, { baselineTemp: temp1, since: Date.now() })
    return false
  }
  return Date.now() - state.since >= durationMs
}

async function evaluateFaultStatus(info) {
  const faultConfig = systemConfig.getConfig().FAULT_STATUS || {}
  if (faultConfig.enabled !== true) return []

  const deviceNo = String((await resolveDeviceNo(info)) || '').trim() || null
  const sensors = await readSensors(info)
  const states = await readSwitchStates(info)
  const [flowLow, pressureHigh] = await Promise.all([
    getThresholdValue('flowLow', deviceNo),
    getThresholdValue('pressureHigh', deviceNo),
  ])

  const triggers = []

  // 1. 加热模块故障：(a) 水泵和加热均开启时，流量低于下限阈值（干烧）；
  //    (b) 加热开启后长时间温度都没有明显上升（加热管可能已经不发热了）。
  if (faultConfig.heaterFault !== false) {
    if (states.pumpOn === true && states.heatOn === true
      && flowLow != null && sensors.flow != null && sensors.flow < flowLow) {
      triggers.push({ id: 'heater_fault', name: '加热模块故障（干烧）', detail: `水泵、加热均开启，流量=${sensors.flow}，下限=${flowLow}` })
    }
    if (checkHeaterStall(deviceNo, states.heatOn, sensors.temp1, faultConfig)) {
      const durationMs = Number(faultConfig.heaterStallDurationMs) > 0 ? Number(faultConfig.heaterStallDurationMs) : 60000
      triggers.push({ id: 'heater_fault', name: '加热模块故障（长时间温度不上升）', detail: `加热已开启超过 ${Math.round(durationMs / 1000)} 秒，温度=${sensors.temp1} 无明显上升` })
    }
  }

  // 2. 水泵故障：水泵开启时，流量为 0 且压力为 0，且持续 >= pumpFaultDurationMs。
  const pumpFaultKey = deviceNo || 'global'
  const pumpFaultNow = faultConfig.pumpFault !== false && states.pumpOn === true && sensors.flow === 0 && sensors.pressure === 0
  if (pumpFaultNow) {
    if (!pumpFaultSince.has(pumpFaultKey)) pumpFaultSince.set(pumpFaultKey, Date.now())
    const durationMs = Number(faultConfig.pumpFaultDurationMs) >= 0 ? Number(faultConfig.pumpFaultDurationMs) : 2000
    if (Date.now() - pumpFaultSince.get(pumpFaultKey) >= durationMs) {
      triggers.push({ id: 'pump_fault', name: '水泵故障', detail: `水泵开启，流量=0 且压力=0，持续>=${durationMs}ms` })
    }
  } else {
    pumpFaultSince.delete(pumpFaultKey)
  }

  // 3. 管道堵塞：压力高于上限阈值且流量低于下限阈值。
  if (faultConfig.blockage !== false && pressureHigh != null && sensors.pressure != null && sensors.pressure > pressureHigh
    && flowLow != null && sensors.flow != null && sensors.flow < flowLow) {
    triggers.push({ id: 'blockage', name: '管道堵塞', detail: `压力=${sensors.pressure}，上限=${pressureHigh}，流量=${sensors.flow}，下限=${flowLow}` })
  }

  // 4. 管道漏水：压力为 0 且（流量低于下限阈值 或 流量为 0）。
  if (faultConfig.leak !== false && sensors.pressure === 0
    && ((flowLow != null && sensors.flow != null && sensors.flow < flowLow) || sensors.flow === 0)) {
    triggers.push({ id: 'leak', name: '管道漏水', detail: `压力=0，流量=${sensors.flow}${flowLow != null ? `，下限=${flowLow}` : ''}` })
  }

  const results = []
  for (const trigger of triggers) {
    const r = await fire(trigger, deviceNo, faultConfig)
    if (r) results.push(r)
  }

  if (results.length) {
    console.log(`[FaultStatus] 触发 ${results.length} 项故障保护，设备 ${deviceNo || '全局'}`)
  }
  return results
}

module.exports = { evaluateFaultStatus }
