/** 【文件职责】service/linkageRules/linkageRules.js 共用的底层工具函数——读传感器、
 * 读开关状态、按 preffix 查阈值、下发指令，各条规则都要用到这些动作，抽出来只维护
 * 一份实现。9 条规则函数本身（rulePumpAlwaysOn/ruleHeaterHysteresis 等）不在这里——
 * 那是规则之间真正不同、需要保持独立的部分。
 * 【配置中心关联】SENSOR_FIELD_MAP、SINGLE_DEVICE_MODE、MQTT_QOS 每次调用实时读取。 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')
const { firstValue, getTopic, buildSwitchPayload } = require('../../utils/protocol')
const { resolveFieldAliases, resolveDeviceNo } = require('../../utils/mappedData')
const { getDirectValue, saveDirectData } = require('../directData/saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory/saveOperationHistory')

/**
 * 异常最大值哨兵：读数达到或超过它视为传感器异常（掉线/短路，比如传感器故障时
 * 卡死在量程最大值）。可在配置中心 SAFETY_INTERLOCK.abnormalMax 调整（现场传感器
 * 满量程不是 9999 时会用到）；没配置或不是正数时退回硬常量 9999。
 * safetyInterlock.js 和 linkageRules.js 共用这一处判断，不再各自维护一份。
 */
function getAbnormalMax() {
  const v = Number(systemConfig.getConfig().SAFETY_INTERLOCK?.abnormalMax)
  return Number.isFinite(v) && v > 0 ? v : 9999
}

/**
 * 从上报数据里解析设备号并标准化成 `字符串 | null`。
 * safetyInterlock.js / linkageRules.js / faultStatus.js 里原本各写一遍
 * `String((await resolveDeviceNo(info)) || '').trim() || null`，统一到这里。
 * @returns {Promise<string|null>}
 */
async function resolveDeviceNoStr(info) {
  return String((await resolveDeviceNo(info)) || '').trim() || null
}

/**
 * 判断流量读数是不是"正常"（linkageRules.js 原来的 isFlowNormal，上移到共用层）。
 * 要同时满足：非 null、非 0、没顶到异常最大值哨兵、落在配置的上下限之间
 * （没配对应阈值就跳过那一条检查）。
 * @param {number|null} flow
 * @param {number|null} flowLow  - null 表示没配置，不检查这条
 * @param {number|null} flowHigh - null 表示没配置，不检查这条
 * @returns {boolean}
 */
function isFlowNormal(flow, flowLow, flowHigh) {
  if (flow == null || flow === 0 || flow >= getAbnormalMax()) return false
  if (flowLow != null && flow < flowLow) return false
  if (flowHigh != null && flow > flowHigh) return false
  return true
}

/**
 * 进出水温差绝对值；两个读数任一缺失时返回 null（不能拿 NaN 去跟阈值比较，
 * 那样比较结果永远是 false，会悄悄绕过依赖温差的判断）。
 * @param {{temp1: number|null, temp2: number|null}} sensors
 * @returns {number|null}
 */
function getTempDiff(sensors) {
  if (sensors.temp1 == null || sensors.temp2 == null) return null
  return Math.abs(sensors.temp1 - sensors.temp2)
}

/** 阈值槽位（优先 preffix，其次中文名）。safetyInterlock.js / faultStatus.js /
 * linkageRules.js 共用这一份，不再各自维护。tempDiff 供故障状态机的"水泵故障"判据用。 */
const THRESHOLD_SLOTS = {
  tempHigh: { prefix: 'temp_high', name: '温度上限阈值' },
  tempLow: { prefix: 'temp_low', name: '温度下限阈值' },
  flowLow: { prefix: 'flow_low', name: '流量下限阈值' },
  flowHigh: { prefix: 'flow_high', name: '流量上限阈值' },
  pressureLow: { prefix: 'pressure_low', name: '压力下限阈值' },
  pressureHigh: { prefix: 'pressure_high', name: '压力上限阈值' },
  tempDiff: { prefix: 'temp_diff', name: '温差阈值' },
}

/** 防抖：同一设备同一开关切换至少间隔 minIntervalMs；所有规则共用同一份计时状态。 */
const lastSwitchTime = new Map()

async function resolveConfigIdByPrefix(prefix) {
  if (!prefix) return null
  const [rows] = await promisePool.query(
    "SELECT id FROM t_direct_config WHERE preffix IS NOT NULL AND preffix != '' AND LOWER(preffix) = LOWER(?) ORDER BY id ASC LIMIT 1",
    [prefix]
  )
  return rows[0]?.id ?? null
}

/** 按 preffix 查阈值指令项的 config_id。所有指令项都有 preffix，不再需要 t_name 兜底。 */
async function resolveThresholdConfigId(slot) {
  const def = THRESHOLD_SLOTS[slot]
  if (!def) return null
  return resolveConfigIdByPrefix(def.prefix)
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

/** 按 preffix 找开关类（f_type=1）配置。所有开关都有 preffix，不再需要 t_name LIKE 兜底。 */
async function findSwitchConfig(prefix) {
  const configId = await resolveConfigIdByPrefix(prefix)
  if (configId == null) return null
  const [rows] = await promisePool.query(
    `SELECT id, t_name, preffix, wire_template, wire_on_payload, wire_off_payload, f_type FROM t_direct_config
     WHERE id = ? AND f_type = '1' LIMIT 1`,
    [configId]
  )
  return rows[0] || null
}

/**
 * 读一个数值型指令项，三级兜底，保证返回的一定是有限数字：
 *   1) 指令中心 t_direct 里这个 preffix 的当前值（现场实时调整，优先生效）；
 *   2) 指令项被删掉、或者从没配过值时，回退到调用方传入的配置中心兜底值；
 *   3) 配置中心那个也没了/不是数字时，用 hardFallback 常量兜住。
 * 三层都不会抛异常——删掉指令项只是让它退回下一层，不会让控制逻辑吃到
 * NaN/undefined（那会让比较判断永远为 false，表现成"规则悄悄失效"）。
 */
async function getNumberValue(prefix, deviceNo, fallback, hardFallback) {
  const configId = await resolveConfigIdByPrefix(prefix)
  const value = configId != null
    ? await toNumber(await getDirectValue({ config_id: configId, d_no: deviceNo }))
    : null
  if (value != null) return value
  const fb = Number(fallback)
  return Number.isFinite(fb) ? fb : hardFallback
}

/**
 * 把管路流量读数换算成管内平均流速（m/s），换算不出来时返回 null。
 *   v = Q / A
 * 单位链条（跟 t_sensor_field_mapper 里 field3 声明的 L/min、以及
 * service/computedMetrics/computedMetrics.js 的"平均流速 v = Q / A"完全一致）：
 *   流量 L/min --÷60--> L/s --÷1000--> m³/s
 *   管道横截面积 cm² --÷10000--> m²
 * 管道横截面积来自配置中心 COMPUTED_METRICS.pipeAreaCm2；没配置或填了 0 时算不出
 * 流速，这里返回 null，由调用方决定怎么处理（恒流速控制会因此整轮不动作，
 * 而不是拿一个错误的流速去开关水泵）。
 * @param {number|null} flowLPerMin 管路流量读数（L/min）
 * @returns {number|null} 流速（m/s）
 */
function toVelocity(flowLPerMin) {
  if (flowLPerMin == null || !Number.isFinite(flowLPerMin)) return null
  const areaCm2 = Number(systemConfig.getConfig().COMPUTED_METRICS?.pipeAreaCm2)
  if (!Number.isFinite(areaCm2) || areaCm2 <= 0) return null
  const qM3PerSec = (flowLPerMin / 60) / 1000
  const areaM2 = areaCm2 / 10000
  return Number((qM3PerSec / areaM2).toFixed(4))
}

/** 读目标温度：优先指令中心 target_temperature，否则用配置中心默认值。 */
async function getTargetTemp(deviceNo, fallback) {
  return getNumberValue('target_temperature', deviceNo, fallback, 22)
}

/** 下发一次开关指令：找到对应指令项、拼协议报文、发布 MQTT、更新 t_direct、记操作历史。
 * source 由调用方传入（如 'linkage_rules'），日志和操作历史里都带着这个来源标签。
 * skipPersist=true 时只发布 MQTT 断电/通电，不改 t_direct 的开关显示值、不记操作历史——
 * 用于故障触发时"硬件断电但页面保持故障前开关状态"（faultStatus.js 用）。 */
async function setSwitch(prefix, name, value, deviceNo, source, skipPersist = false) {
  const conf = await findSwitchConfig(prefix)
  if (!conf) return false
  const mqttClient = require('../../mqtt')
  const payload = buildSwitchPayload(conf, value)
  if (!systemConfig.getConfig().SINGLE_DEVICE_MODE && deviceNo) payload.d_no = deviceNo
  await mqttClient.publish(getTopic('control'), payload, { qos: systemConfig.getConfig().MQTT_QOS })
  if (!skipPersist) {
    const oldValue = await getDirectValue({ config_id: conf.id, d_no: deviceNo })
    await saveDirectData({ config_id: conf.id, value, d_no: deviceNo })
    await saveOperationHistory({ d_no: deviceNo, config_id: conf.id, old_value: oldValue, new_value: value, source })
  }
  console.log(`[ControlShared] ${name} -> ${value}（${source}${skipPersist ? '，仅硬件' : ''}），设备 ${deviceNo || '全局'}`)
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
  getAbnormalMax,
  THRESHOLD_SLOTS,
  resolveConfigIdByPrefix,
  resolveThresholdConfigId,
  toNumber,
  getThresholdValue,
  getNumberValue,
  readSensors,
  readSwitchStates,
  findSwitchConfig,
  getTargetTemp,
  toVelocity,
  setSwitch,
  canAct,
  resolveDeviceNoStr,
  isFlowNormal,
  getTempDiff,
}
