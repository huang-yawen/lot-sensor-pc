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
// 只读 pumpWarmupMs 这一项，给 getPumpWarmupMs 当兜底（faultStatus/config.js 是纯常量，不会循环依赖）
const FAULT_CONFIG = require('../faultStatus/config')
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
 * -> 记一条操作历史。找不到指令项时返回 false；下发成功返回 { oldValue }——oldValue 是
 * 下发前指令页面上这个开关的值（'on'/'off'，没存过值时为 null），各模块写记录时拿它拼
 * "水泵 开→关"里箭头左边的调整前状态。返回对象本身是真值，只判真假的调用方不受影响。
 * skipPersist=true 时不读页面值，oldValue 固定为 null（故障机从快照取调整前状态）。
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
  let oldValue = null
  if (!skipPersist) {
    oldValue = await getDirectValue({ config_id: conf.id, d_no: deviceNo })
    await saveDirectData({ config_id: conf.id, value, d_no: deviceNo })
    await saveOperationHistory({ d_no: deviceNo, config_id: conf.id, old_value: oldValue, new_value: value, source })
  }
  console.log(`[ControlShared] ${name} -> ${value}（${source}${skipPersist ? '，仅硬件' : ''}），设备 ${deviceNo || '全局'}`)
  return { oldValue }
}

/** 开关原始值 -> 记录里显示的中文：能认出开/关就写开/关，null 或认不出的值写"未知"
 *  （比如指令页面上这个开关从没存过值），不瞎猜成"关"。 */
function switchText(value) {
  if (value == null) return '未知'
  const v = String(value).trim().toLowerCase()
  if (['on', 'open', '1', 'true'].includes(v)) return '开'
  if (['off', 'close', 'closed', '0', 'false'].includes(v)) return '关'
  return '未知'
}

/**
 * 拼"告警记录"页里一个开关的调整前后状态，安全联锁 / 联动控制 / 故障保护三块共用，
 * 保证三张表写法一致。约定：箭头左边是调整前，右边是调整后。
 *   formatSwitchChange('水泵', 'on', 'off')  -> '水泵 开→关'
 *   formatSwitchChange('水泵', 'off', 'off') -> '水泵 关→关（未变）'
 *   formatSwitchChange('加热', null, 'off')  -> '加热 未知→关'
 * 调整前后相同时特意标"（未变）"：安全联锁会把水泵、加热一起关，原本就关着的那个
 * 实际没动，不标出来会被误读成"又关了一次"。
 */
function formatSwitchChange(label, before, after) {
  const from = switchText(before)
  const to = switchText(after)
  return `${label} ${from}→${to}${from === to && from !== '未知' ? '（未变）' : ''}`
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

/**
 * ★★ 赛场写控制规则用：一行拿到现场数据 s 和读参数用的 ctx ★★
 *
 * 【为什么有这个函数】
 *   安全联锁 checkRules、联动 checkRules、故障状态机 checkFaults 都是同一个写法：
 *   "s 放这条上报的现场数据，ctx 放阈值和参数"，规则里只写 if 判断。赛场上临时要加
 *   一个新的控制模块/新规则时，不用再照抄一遍"解析设备号 → 读传感器 → 读开关 →
 *   算温差 → 包成 s/ctx"这一串，直接调这个函数就行。
 *   ⚠ 现有的三个模块暂时还是自己组装 s/ctx，没有改用这个函数（避免赛前改动已验证过
 *   的控制链路）。这里 s/ctx 的字段名、取值语义跟那三处完全一致，规则代码可以互相抄。
 *
 * 【返回值】{ deviceNo, sensors, states, s, ctx }
 *
 *   s —— 这一条上报解析出来的现场数据（读不到的一律是 null，不会是 NaN/undefined）：
 *     s.flow        流量（L/min）          s.pressure    压力（kPa）
 *     s.temp1       进水温度（℃）          s.temp2       出水温度（℃）
 *     s.tempDiff    进出水温差的绝对值（两路温度缺一个就是 null，见 getTempDiff）
 *     s.pumpOn      水泵开着吗：true / false / null（null = 这条消息没带水泵字段，
 *                   比如传感器和行为数据分主题上报时的纯传感器消息）
 *     s.heatOn      加热开着吗：同上
 *     判断时注意：
 *       · 数值先判 `!= null` 再比较。`null > 30` 是 false 不报错，规则会"看着在跑、
 *         实际没生效"，最难排查。
 *       · 开关"确认开着"写 `s.pumpOn === true`；"确认关着"写 `s.pumpOn === false`。
 *         不要写 `!s.pumpOn`：它会把"不知道(null)"也当成"关着"。
 *
 *   ctx —— 读指令中心参数的方法（都按当前设备读，"设备专属值优先、其次全局值"；
 *          页面上改了，下一条消息就生效，不用重启后端）：
 *     ctx.deviceNo
 *         当前设备号，null 代表全局/单设备。下发指令、写记录时原样传下去。
 *     await ctx.threshold('tempHigh')
 *         读阈值槽位，指令项不存在或没填数值时返回 null（据此跳过这条判断）。
 *         可用槽位（见上方 THRESHOLD_SLOTS）：
 *           tempHigh 温度上限   tempLow 温度下限   flowHigh 流量上限   flowLow 流量下限
 *           pressureHigh 压力上限   pressureLow 压力下限   tempDiff 温差阈值
 *     await ctx.number('pump_warmup_ms', 兜底值, 默认值)
 *         按 preffix 读任意数值指令项，三级兜底，一定返回有限数字（见 getNumberValue）：
 *         指令中心的值 → 第二个参数（一般传 config.js 里的值）→ 第三个参数（写死的常量）。
 *         适合"指令项可能被删掉、删了也要能跑"的参数。
 *     ⚠ threshold / number 都要查数据库，前面必须加 await。忘了 await 拿到的是 Promise，
 *       `Promise > 30` 永远是 false，规则同样会悄悄失效。
 *
 *   deviceNo / sensors / states —— 顺手一起返回，后面下发指令、写记录、算特有字段时直接用：
 *     sensors   readSensors 的完整结果（键由 SENSOR_FIELD_MAP 决定，比 s 里多出来的
 *               字段也在这里），配合 TEMP_SOURCES 用：sensors[TEMP_SOURCES.pidProcess]
 *     states    readSwitchStates 的结果 { pumpOn, heatOn }，跟 s 里的同名字段是同一个值
 *
 * 【参数】
 *   info      已解析的设备上报数据（handler 里拿到的那个 info，原样传进来）
 *   deviceNo  可选。调用方已经解析好设备号时传进来，这里就不再解析一遍；不传（undefined）
 *             才在函数里解析。典型场景：要先用设备号做"故障锁 / 手动模式"短路，短路没命中
 *             才读传感器——这时先 resolveDeviceNoStr 再把结果传进来，一条消息只解析一次。
 *             注意是"不传"才解析，显式传 null 表示"就是全局/单设备"，不会再解析。
 *
 * 【用法一：最小用法——新写一个控制模块】
 *   const { buildRuleInput, setSwitch } = require('../controlShared/controlHelpers')
 *
 *   async function evaluateMyRule(info) {
 *     const { s, ctx } = await buildRuleInput(info)
 *     const tempHigh = await ctx.threshold('tempHigh')
 *     // 出水温度超过温度上限，且加热确实开着 → 关加热
 *     if (s.temp2 != null && tempHigh != null && s.temp2 > tempHigh && s.heatOn === true) {
 *       await setSwitch('heater', '加热', 'off', ctx.deviceNo, 'my_rule')
 *     }
 *   }
 *
 * 【用法二：先短路再读数据（跟联动 / PID 的顺序一样）】
 *   const deviceNo = await resolveDeviceNoStr(info)
 *   if (SINGLE_DEVICE_MODE === true ? isAnyLocked() : isLockedByFault(deviceNo)) return []
 *   if ((await getCurrentMode(deviceNo)) === 'manual') return []
 *   const { s, ctx } = await buildRuleInput(info, deviceNo)   // 把设备号传进来，不重复解析
 *
 * 【用法三：往 s / ctx 上补本模块特有的字段，规则函数保持 checkRules(s, ctx) 的写法】
 *   const { s, ctx } = await buildRuleInput(info)
 *   const flowLow = await ctx.threshold('flowLow')
 *   const flowHigh = await ctx.threshold('flowHigh')
 *   Object.assign(s, { flowNormal: isFlowNormal(s.flow, flowLow, flowHigh) })   // 补现场派生量
 *   Object.assign(ctx, { flowLow, flowHigh, config: CONFIG })                   // 补读好的阈值/配置
 *   const results = await checkRules(s, ctx)
 *   为什么特有字段不直接做进这个函数：同名字段在不同模块里算法/兜底不一样（比如温差阈值，
 *   故障机没配指令项会退回 config.js，安全联锁不会；预热计时每个模块各记一份状态），
 *   硬合成一份会悄悄改掉某个模块的判定。公共函数只放三处**完全一致**的部分。
 *
 * @param {Object} info - 已解析的设备上报数据
 * @param {string|null} [deviceNo] - 已解析好的设备号；不传才在函数内解析
 * @returns {Promise<{deviceNo: (string|null), sensors: Object, states: {pumpOn: (boolean|null), heatOn: (boolean|null)}, s: Object, ctx: Object}>}
 */
async function buildRuleInput(info, deviceNo) {
  if (deviceNo === undefined) deviceNo = await resolveDeviceNoStr(info)
  const sensors = await readSensors(info)
  const states = await readSwitchStates(info)
  const s = {
    flow: sensors.flow,
    pressure: sensors.pressure,
    temp1: sensors.temp1,
    temp2: sensors.temp2,
    tempDiff: getTempDiff(sensors),
    pumpOn: states.pumpOn,
    heatOn: states.heatOn,
  }
  const ctx = {
    deviceNo,
    threshold: (slot) => getThresholdValue(slot, deviceNo),
    number: (prefix, fallback, hardFallback) => getNumberValue(prefix, deviceNo, fallback, hardFallback),
  }
  return { deviceNo, sensors, states, s, ctx }
}

/* ============================================================
 * ★★ 赛场写规则用：水泵开关判断 + 水泵预热 ★★
 * ============================================================
 * 先分清项目里两种"水泵开没开"，写规则时别混用：
 *
 *   ① 设备上报的实际状态 —— s.pumpOn（buildRuleInput / readSwitchStates 给的）
 *      来自这条 MQTT 行为数据，代表"继电器现在真的是开还是关"。
 *      安全联锁、故障机、联动判断现场情况时都用这个。
 *
 *   ② 指令页面上开关的当前值 —— await readDirectSwitchOn('pump', deviceNo)
 *      来自 t_direct，代表"上位机最后一次让它开还是关"（页面手动点的、自动控制下发的
 *      都会写进去）。"开加热前必须先开水泵"这类拦截用的是这个（PID、定时任务、
 *      指令页面手动下发三处都是读 t_direct 的 pump 值）。
 *
 *   两者大多数时候一致：设备上报的开关状态一变，behaviorRealtimeRepository.js 会把 t_direct
 *   同步成上报值（操作历史里 source='auto' 的记录就是这么来的）。会不一致的情况：
 *   指令刚下发、设备还没回报；设备掉线没有上报；故障锁定期间（故障机只断执行器、
 *   不改页面显示值，同步也暂停）。
 *
 * 水泵预热：水泵刚启动的几秒里流量、压力、温差都还没稳定，这时候判"流量过低 / 压力
 * 异常 / 温差过大"会误报。所以这类规则都要等"水泵已经连续开满预热时长"才判。
 * 现在故障机、安全联锁、阈值告警、跳变过滤四个模块各自有一份一模一样的计时代码，
 * 预热时长都读同一个指令项 pump_warmup_ms。下面把这套做成公共函数，赛场新写规则直接用。
 * ⚠ 现有四个模块暂时还是用自己那份，没有改成调用这里（避免赛前动已验证的控制链路）。
 * ============================================================ */

/**
 * 判断一个开关值是不是"开"。on / open / 1 / true（不区分大小写、忽略首尾空格，
 * 数字 1 和布尔 true 也算）都算开；其它任何值——包括 off/0、空值、认不出来的字符串——
 * 都算"不是开"，返回 false。
 *
 * 跟 updateDirectConfigAndPublish.js、scheduleService.js、relayStuck.js 里各自那份
 * isOnValue 是同一套取值约定。
 *
 * ⚠ 它只有 true/false 两种结果，分不出"明确是关"和"根本没读到"。需要区分这两种情况时
 *   别用它，用 readSwitchStates（上报状态）或 readDirectSwitchOn（指令页面），它们会返回 null。
 *
 * 用法：
 *   isOnValue('ON ')  // true
 *   isOnValue(1)      // true
 *   isOnValue('0')    // false
 *   isOnValue(null)   // false（没读到也是 false，注意上面的 ⚠）
 *
 * @param {*} value
 * @returns {boolean}
 */
function isOnValue(value) {
  return ['on', 'open', '1', 'true'].includes(String(value).trim().toLowerCase())
}

/**
 * 读指令页面上某个开关（按 preffix 找）的当前值，返回三种结果：
 *   true  —— 指令项存在，当前值是开（on/open/1/true）
 *   false —— 指令项存在，当前值是别的（off/0/认不出来的值）
 *   null  —— 指令项不存在（比如赛场上从 t_direct_config 删掉了），或者存在但从来没存过值
 *
 * 跟 pidHeating.js 的 readSwitchOn 是同一个逻辑（那边的 PID / 恒流速 / 定温停机都在用），
 * 这里放一份在公共层，是因为 controlHelpers 不能反过来 require pidHeating.js（pidHeating
 * 已经 require 了本文件，互相 require 会拿到半初始化的空对象）。
 *
 * 常用 preffix：pump 水泵开关、heater 加热开关、auto_control_enabled 控制模式（开=自动）、
 *   pid_enabled PID恒温、heater_hysteresis_enabled 加热滞回带、shutdown_temp_enabled 定温停机。
 *   以 t_direct_config 表里实际的 preffix 列为准。
 *
 * ⚠ null 怎么处理由调用方自己决定，这里不替你选——现有几处本来就不一样：
 *   · PID 开加热前查水泵：`!(await readSwitchOn('pump'))`，水泵指令项不存在也算"没开"，拦截；
 *   · 定时任务开加热前查水泵：水泵指令项不存在就放行；
 *   · 指令页面手动开加热：水泵指令项不存在就拒绝。
 *   所以写规则时明确写出来：`=== true` 表示"确认开着才算"，`=== false` 表示"确认关着才算"，
 *   `== null` 单独处理"没配置"。
 *
 * ⚠ deviceNo 要传真实设备号（buildRuleInput 返回的 ctx.deviceNo 就是）。传 null 只会查
 *   d_no IS NULL 的全局值；单设备模式下开关值是存在真实设备号名下的，传 null 可能读不到，
 *   见 updateDirectConfigAndPublish.js 里 getDefaultDeviceId 那段注释。
 *
 * 用法：
 *   // 规则里要开加热，先确认指令页面上水泵是开的（水泵指令项没配置时按"没开"处理）
 *   if ((await readDirectSwitchOn('pump', ctx.deviceNo)) !== true) return
 *   await setSwitch('heater', '加热', 'on', ctx.deviceNo, 'my_rule')
 *
 *   // 只在自动模式下才跑的规则
 *   if ((await readDirectSwitchOn('auto_control_enabled', ctx.deviceNo)) !== true) return
 *
 * @param {string} prefix - 指令项 preffix
 * @param {string|null} deviceNo
 * @returns {Promise<boolean|null>}
 */
async function readDirectSwitchOn(prefix, deviceNo) {
  const configId = await resolveConfigIdByPrefix(prefix)
  if (configId == null) return null
  const value = await getDirectValue({ config_id: configId, d_no: deviceNo })
  if (value == null) return null
  return isOnValue(value)
}

/**
 * 读水泵预热时长（毫秒），三级兜底，一定返回有限数字：
 *   1) 指令页面"水泵预热宽限期(ms)"（preffix=pump_warmup_ms），页面改了下一条消息就生效；
 *   2) 指令项删掉或没填值时，用 faultStatus/config.js 的 pumpWarmupMs；
 *   3) 那个也没有 / 不是数字时，用 5000。
 * 跟故障机、安全联锁、阈值告警、跳变过滤四处读的是同一个值、同一套兜底，
 * 赛场新规则用这个，预热时长就跟现有保护保持一致。
 *
 * 用法：
 *   const warmupMs = await getPumpWarmupMs(ctx.deviceNo)
 *
 * @param {string|null} deviceNo
 * @returns {Promise<number>}
 */
async function getPumpWarmupMs(deviceNo) {
  return getNumberValue('pump_warmup_ms', deviceNo, FAULT_CONFIG.pumpWarmupMs, 5000)
}

/**
 * 创建一个水泵预热计时器（记"水泵已经连续开了多久"）。
 *
 * 【为什么是"创建一个"而不是直接导出一个函数】
 *   计时要记住"水泵是什么时候打开的"，这是一份内存状态。每个模块必须各自 create 一份：
 *   几个模块各自收消息、各自清零，要是共用一份，A 模块读到一条"水泵关"把计时清掉，
 *   B 模块的预热就被莫名其妙重置了。写法跟 controlShared/cooldown.js 的 createCooldown()
 *   一样——在模块顶层 create 一次，之后每条消息调用。
 *   ⚠ 不要在每条消息的处理函数里面 create：那样每次都是新计时器，永远是"刚开"，
 *     预热永远完成不了。
 *
 * 【计时规则】跟故障机 / 安全联锁 / 跳变过滤里的 trackPumpOnDuration 完全一致：
 *   pumpOn === true   水泵开着：第一次看到开就记下起始时间，之后返回"现在 − 起始时间"
 *   pumpOn === false  确认关了：清掉起始时间，返回 null；下次再开重新计时
 *   pumpOn == null    这条消息没带水泵状态（不知道）：不清零，已经在计时就继续返回已开时长，
 *                     没在计时就返回 null。不能当成"关"——传感器和行为数据分开上报时，
 *                     每条纯传感器消息都是 null，当成关的话预热永远攒不够。
 *   计时按服务器收到消息的时间（Date.now()）算，不是设备上报时间。
 *
 * 【返回的方法】
 *   tracker.track(deviceNo, pumpOn)
 *       同步。更新计时并返回水泵已连续开启的毫秒数；没开 / 不知道且没在计时 → null。
 *   await tracker.check(deviceNo, pumpOn)
 *       异步。track 一次，再读预热时长（getPumpWarmupMs），一次返回三个值：
 *       { pumpOnDurationMs, warmupMs, pumpWarmedUp }
 *       pumpWarmedUp = 已开时长不为 null 且 >= 预热时长。规则里一般直接用这个。
 *   tracker.reset(deviceNo)
 *       手动清掉某设备的计时（比如故障复位后想让预热从头算）。一般用不到。
 *   注意：每条消息只调一次 track 或 check（check 里已经 track 过了），两个都调不会算错，
 *   但没必要。
 *
 * 【用法：配合 buildRuleInput，给规则补上预热字段】
 *   const { buildRuleInput, createPumpWarmupTracker } = require('../controlShared/controlHelpers')
 *   const pumpWarmup = createPumpWarmupTracker()          // ← 模块顶层，只 create 一次
 *
 *   async function evaluateMyRule(info) {
 *     const { s, ctx } = await buildRuleInput(info)
 *     // 每条消息都要调，不管后面的规则用不用——否则规则中途打开时计时是断的
 *     Object.assign(s, await pumpWarmup.check(ctx.deviceNo, s.pumpOn))
 *     // 现在 s 上多了 s.pumpOnDurationMs / s.warmupMs / s.pumpWarmedUp
 *
 *     const flowLow = await ctx.threshold('flowLow')
 *     // 水泵预热完成后流量仍低于下限 → 关水泵
 *     if (s.pumpWarmedUp && s.flow != null && flowLow != null && s.flow < flowLow) {
 *       await setSwitch('pump', '水泵', 'off', ctx.deviceNo, 'my_rule')
 *     }
 *   }
 *
 * @returns {{track: Function, check: Function, reset: Function}}
 */
function createPumpWarmupTracker() {
  /** key（设备号，空设备号用 'global'）-> 水泵这次开启的起始时间戳（ms）。只在内存里，重启清空。 */
  const pumpStartStateMap = new Map()

  function track(deviceNo, pumpOn) {
    const key = deviceNo || 'global'
    if (pumpOn === false) {
      pumpStartStateMap.delete(key)
      return null
    }
    if (pumpOn == null) {
      const since = pumpStartStateMap.get(key)
      return since == null ? null : Date.now() - since
    }
    const now = Date.now()
    let since = pumpStartStateMap.get(key)
    if (since == null) {
      since = now
      pumpStartStateMap.set(key, since)
    }
    return now - since
  }

  async function check(deviceNo, pumpOn) {
    const pumpOnDurationMs = track(deviceNo, pumpOn)
    const warmupMs = await getPumpWarmupMs(deviceNo)
    const pumpWarmedUp = pumpOnDurationMs != null && pumpOnDurationMs >= warmupMs
    return { pumpOnDurationMs, warmupMs, pumpWarmedUp }
  }

  function reset(deviceNo) {
    pumpStartStateMap.delete(deviceNo || 'global')
  }

  return { track, check, reset }
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
  formatSwitchChange,
  canAct,
  resolveDeviceNoStr,
  isFlowNormal,
  getTempDiff,
  buildRuleInput,
  isOnValue,
  readDirectSwitchOn,
  getPumpWarmupMs,
  createPumpWarmupTracker,
}
