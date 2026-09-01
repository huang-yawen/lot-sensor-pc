/** 【文件职责】自动控制（simple）与分层联动（layered）共用的工具函数——两套模式
 * 是互斥的档位（CONTROL_MODE 二选一，不会同时跑），但读传感器、读开关状态、按
 * preffix 查阈值、下发指令这些底层动作完全一样，之前各自维护一份几乎逐字相同的
 * 实现，容易改一处忘改另一处，现在统一收在这里，两边都从这里 import。
 * 决策逻辑（decidePump/decideHeater、分层的七个 decide* 规则函数）不在这里——
 * 那是两套档位真正不同、需要保持独立的部分，不属于这次合并的范围。
 * 【配置中心关联】SENSOR_FIELD_MAP、SINGLE_DEVICE_MODE、MQTT_QOS 每次调用实时读取。 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')
const { firstValue, getTopic, buildSwitchPayload } = require('../../utils/protocol')
const { resolveFieldAliases } = require('../../utils/mappedData')
const { getDirectValue, saveDirectData } = require('../directData/saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory/saveOperationHistory')

/** 异常最大值哨兵：超过此值视为传感器异常（掉线/短路）。 */
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

/** 防抖：同一设备同一开关切换至少间隔 minIntervalMs；两套模式共用同一份计时状态，
 * 模式切换时防抖不会从零开始，不会因为切模式那一刻允许连续瞬间切换。 */
const lastSwitchTime = new Map()

async function resolveConfigIdByPrefix(prefix) {
  if (!prefix) return null
  const [rows] = await promisePool.query(
    "SELECT id FROM t_direct_config WHERE preffix IS NOT NULL AND preffix != '' AND LOWER(preffix) = LOWER(?) ORDER BY id ASC LIMIT 1",
    [prefix]
  )
  return rows[0]?.id ?? null
}

// 先按 preffix 查一次，查不到再按中文名（t_name）查一次，两种方式任一种查到
// 就返回对应的 config_id。
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

/** 下发一次开关指令：找到对应指令项、拼协议报文、发布 MQTT、更新 t_direct、记操作历史。
 * source 由调用方传入（'auto_control' 或 'layered_control'），日志和操作历史里
 * 都带着这个来源标签，能区分是哪套模式下发的这条指令。 */
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
  console.log(`[ControlShared] ${name} -> ${value}（${source}），设备 ${deviceNo || '全局'}`)
  return true
}

// 防抖：记录每个设备+开关上次动作的时间戳，同一个开关必须间隔满 minIntervalMs
// 才允许再次动作，间隔不够就返回 false 拦住这次切换。
function canAct(deviceNo, key, minIntervalMs = 3000) {
  const k = `${deviceNo || 'global'}:${key}`
  const last = lastSwitchTime.get(k) || 0
  if (Date.now() - last < minIntervalMs) return false
  lastSwitchTime.set(k, Date.now())
  return true
}

module.exports = {
  ABNORMAL_MAX,
  THRESHOLD_SLOTS,
  resolveConfigIdByPrefix,
  resolveThresholdConfigId,
  toNumber,
  getThresholdValue,
  readSensors,
  readSwitchStates,
  findSwitchConfig,
  getTargetTemp,
  setSwitch,
  canAct,
}
