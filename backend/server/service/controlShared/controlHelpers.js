/** 【文件职责】service/linkageRules/linkageRules.js 共用的底层工具函数——读传感器、
 * 读开关状态、按 preffix 查阈值、下发指令，各条规则都要用到这些动作，抽出来只维护
 * 一份实现。9 条规则函数本身（rulePumpAlwaysOn/ruleHeaterHysteresis 等）不在这里——
 * 那是规则之间真正不同、需要保持独立的部分。
 * 【配置】SENSOR_FIELD_MAP、SINGLE_DEVICE_MODE、MQTT_QOS 见对应 config.js。 */
const promisePool = require('../../config/dbPool')
const { SENSOR_FIELD_MAP, SINGLE_DEVICE_MODE } = require('../../config/appSettings')
const { COMPUTED_METRICS } = require('../../config/metrics')
const { MQTT_QOS } = require('../../config/mqtt')
const SAFETY_CONFIG = require('../safety/config')
const { firstValue, getTopic, buildSwitchPayload } = require('../../utils/protocol')
const { resolveFieldAliases, resolveDeviceNo } = require('../../utils/mappedData')
const { getDirectValue, saveDirectData } = require('../directData/saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory')

/**
 * 异常最大值哨兵：读数达到或超过它视为传感器异常（掉线/短路，比如传感器故障时
 * 卡死在量程最大值）。可在配置中心 SAFETY_INTERLOCK.abnormalMax 调整（现场传感器
 * 满量程不是 9999 时会用到）；没配置或不是正数时退回硬常量 9999。
 * safetyInterlock.js 和 linkageRules.js 共用这一处判断，不再各自维护一份。
 */
function getAbnormalMax() {
  const v = Number(SAFETY_CONFIG.abnormalMax)
  return Number.isFinite(v) && v > 0 ? v : 9999
}

/**
 * 从一条上报数据里解析出设备号，并统一标准化成 `字符串 | null`：解析不出、或解析出
 * 空串/纯空白 -> null（代表"全局/单设备"），否则是去掉首尾空白的字符串。
 * safetyInterlock.js / linkageRules.js / faultStatus.js 原本各写一遍
 * `String((await resolveDeviceNo(info)) || '').trim() || null`，其中 linkageRules 还
 * 一条消息里解析了两次。统一到这里，调用方一行搞定，也少一次重复解析。
 * @returns {Promise<string|null>}
 */
async function resolveDeviceNoStr(info) {
  return String((await resolveDeviceNo(info)) || '').trim() || null
}

/**
 * 判断流量读数是不是"正常"——好几条联动规则和安全联锁都要用（linkageRules.js 原来的
 * isFlowNormal，上移到共用层，两处共用同一份）。要同时满足四点才算正常：
 *   1. 不是 null：传感器确实上报了数据
 *   2. 不是 0：水真的在流动，不是完全没流量
 *   3. 没顶到异常最大值哨兵（getAbnormalMax）：顶到哨兵通常代表传感器掉线/短路，
 *      读数被硬件卡死在满量程，不是真实流量
 *   4. 落在配置的下限和上限之间（对应阈值为 null 表示没配置，就跳过那一条检查）
 * @param {number|null} flow
 * @param {number|null} flowLow  - 流量下限阈值，null 表示没配置，不检查这条
 * @param {number|null} flowHigh - 流量上限阈值，null 表示没配置，不检查这条
 * @returns {boolean}
 */
function isFlowNormal(flow, flowLow, flowHigh) {
  if (flow == null || flow === 0 || flow >= getAbnormalMax()) return false
  if (flowLow != null && flow < flowLow) return false
  if (flowHigh != null && flow > flowHigh) return false
  return true
}

/**
 * 进出水温差的绝对值。安全联锁"温差过大"、故障机"水泵故障"、联动的"双温度融合 /
 * 滞回带通断"都要算这个值，统一在这里，各处只是拿到 diff 之后跟各自的阈值比。
 *
 * temp1 / temp2 任一缺失（传感器没上报 / 读不到）时返回 null，而不是算出一个 NaN：
 * 调用方约定"diff == null 就跳过依赖温差的那条判断"。如果这里返回 NaN，`NaN > 阈值`
 * 永远是 false，依赖温差的保护会看起来在生效、实际完全没生效（悄悄失效最难排查）。
 * 只看绝对值、不分进水高还是出水高，是因为这几处都只关心"温差大不大"。
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

/**
 * 温度观测点映射表：每条"只盯一个温度"的控制规则，到底看进水（temp1）还是出水（temp2）。
 * 赛场按赛题要换观测点时，只改这一张表 + 重启后端即可，不用再去各个规则里翻代码。
 *
 * 取值只能是 'temp1'（进水，对应 SENSOR_FIELD_MAP 的 field1）或 'temp2'（出水，field2）。
 * 规则里统一写成 sensors[TEMP_SOURCES.xxx]，所以改了这里，判定和日志文案会一起跟着变。
 *
 * 注意：只有"单点观测"的规则收录在这里。下面这几类不在表里，也不该放进来——
 *   - 温度单层 / 温度+流量融合 / 温度+压力融合第二段 / 安全联锁温度上下限：
 *     它们的语义是"进水出水任意一个超限就算"，本来就两个都看，改成单点会改变判定含义。
 *   - getTempDiff()：算的是两者之差，跟盯哪一个无关。
 */
const TEMP_SOURCES = {
  dryBurn: 'temp2',           // 故障③干烧：加热开启后盯哪个温度"不上升"
  heaterHysteresis: 'temp2',  // 联动-加热滞回带通断：拿哪个温度跟目标温度比
  tempPressureTrend: 'temp2', // 联动-温度+压力融合第一段：盯哪个温度判断"持续上升"
  pidProcess: 'temp2',        // PID 恒温的被控量（PID 要稳定住的那个温度）
  pidFeedforward: 'temp1',    // PID 前馈补偿参考的温度
}

/** 观测点的中文名，只用于告警/日志文案。跟着 TEMP_SOURCES 走，换了观测点文案自动同步。 */
const TEMP_SOURCE_LABELS = { temp1: '进水温度', temp2: '出水温度' }

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

/** 把原始字符串/数字统一转成有限数字，转不出来（空值、空字符串、非数字字符串、
 * NaN、Infinity）统一返回 null。这样后面各处直接用 `!= null` 就能判断"有没有读到
 * 有效数值"，不用到处再写一遍 isNaN / typeof 检查。安全联锁 / 联动 / 故障机原来各自
 * 维护一份一模一样的实现，现统一在这里。 */
async function toNumber(raw) {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** 读取指令中心某个阈值槽位（见 THRESHOLD_SLOTS）的当前值：先按 preffix 找到指令项
 * config_id，再取该设备的值（getDirectValue 内部是"设备专属值优先、其次全局值"）。
 * 指令项不存在或没有有效数值时返回 null——调用方据此跳过依赖这个阈值的判断，而不是
 * 拿 NaN/undefined 去比较（那样比较结果永远 false，规则会"悄悄失效"）。 */
async function getThresholdValue(slot, deviceNo) {
  const configId = await resolveThresholdConfigId(slot)
  if (configId == null) return null
  return toNumber(await getDirectValue({ config_id: configId, d_no: deviceNo }))
}

/** 从一条上报消息里按字段映射表解析出各传感器的物理数值，返回
 * { temp1, temp2, flow, pressure, ... }（键由 SENSOR_FIELD_MAP 决定）。
 * 安全联锁 / 联动 / 故障机三块都要读同一批传感器值，统一走这里。 */
async function readSensors(info) {
  const out = {}
  // SENSOR_FIELD_MAP 来自配置中心，不能在模块顶层缓存（要求实时取值，热更新才能生效）。
  for (const [key, field] of Object.entries(SENSOR_FIELD_MAP)) {
    const aliases = await resolveFieldAliases('t_sensor_data', field)
    out[key] = await toNumber(firstValue(info, aliases))
  }
  return out
}

/**
 * 读取设备当前上报的水泵/加热开关状态（行为数据 field1=水泵，field2=加热器），
 * 返回 { pumpOn, heatOn }。安全联锁 / 联动 / 故障机三块共用这一份解析，避免各写一遍
 * 时对 "on"/"off"/未知值的判定不一致。
 *
 * toOn 的取值语义（三块统一按这个来）：
 *   - 字段缺失（消息里根本没带这个字段，比如纯传感器消息）-> null，表示"不知道"
 *   - 能识别为开（on/open/1/true）-> true
 *   - 其它任何值（包括明确的 off/0，以及无法识别的字符串）-> false
 * 调用方判断"确认开着"要用 `=== true`，判断"确认没开"用 `=== false` 时要意识到：
 * 未知值也会落进 false。故障机只用到 `=== true` 和 `!heatOn`，不受这个边界影响。
 */
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
  const areaCm2 = Number(COMPUTED_METRICS?.pipeAreaCm2)
  if (!Number.isFinite(areaCm2) || areaCm2 <= 0) return null
  const qM3PerSec = (flowLPerMin / 60) / 1000
  const areaM2 = areaCm2 / 10000
  return Number((qM3PerSec / areaM2).toFixed(4))
}

/** 读目标温度：优先指令中心 target_temperature，否则用配置中心默认值。 */
async function getTargetTemp(deviceNo, fallback) {
  return getNumberValue('target_temperature', deviceNo, fallback, 22)
}

/** 下发一次开关指令：找到对应指令项 -> 拼协议报文 -> 发布 MQTT -> 更新 t_direct 显示值
 * -> 记一条操作历史。找不到指令项时返回 false，其余情况返回 true。
 * source 由调用方传入（'linkage_rules' / 'interlock' / 'fault_status' / 'fault_reset' 等），
 * 日志和操作历史里都带着这个来源标签，方便事后区分"这次开关是谁下发的"。
 *
 * skipPersist=true 时只发布 MQTT（真正给硬件通/断电），**不**改 t_direct 的开关显示值、
 * **不**记操作历史——专门给故障状态机用：故障触发时要"硬件立刻断电、但页面上的开关
 * 仍显示故障前的状态（泵原来开着就还显示开）"，等用户复位时再按快照恢复。普通控制
 * （联动 / 安全联锁 / PID 等）都用默认的 skipPersist=false，硬件和页面显示保持一致。 */
async function setSwitch(prefix, name, value, deviceNo, source, skipPersist = false) {
  const conf = await findSwitchConfig(prefix)
  if (!conf) return false
  const mqttClient = require('../../mqtt')
  const payload = buildSwitchPayload(conf, value)
  if (!SINGLE_DEVICE_MODE && deviceNo) payload.d_no = deviceNo
  await mqttClient.publish(getTopic('control'), payload, { qos: MQTT_QOS })
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
  TEMP_SOURCES,
  TEMP_SOURCE_LABELS,
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
