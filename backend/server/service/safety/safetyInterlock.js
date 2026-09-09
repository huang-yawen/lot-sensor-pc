/**
 * 【文件职责】安全联锁服务：每收到一条设备上报，按规则表逐条判断，命中就下发规则
 * 自己指定的动作，并往 t_error_msg 写一条记录（type='安全联锁'）。
 *
 * ★ 判断条件和触发后干什么，全部写在同目录 config.js 的 rules 数组里 ★
 *   本文件只负责"跑规则"这件事，不含任何具体的判断条件，也没有写死的动作——
 *   要改安全联锁的行为，改 config.js 就够了，不用动这个文件。
 *
 * 整条链路只有两层：
 *   evaluateSafety（每条消息）──┐
 *                              ├─→ applyRule ─→ setSwitch（下发 MQTT + 落库 + 操作历史）
 *   monitorOffline（定时器）───┘
 *
 * 触发两条路径的区别：evaluateSafety 靠"收到消息"驱动，能判断消息里的数值；
 * monitorOffline 靠定时器主动查"整台设备心跳超时、完全没消息进来"——没消息就不会
 * 有人调 evaluateSafety，所以这条必须单独起定时器。它直接复用规则表里 sensor_offline
 * 那条的 then 动作，两条路径共用同一份冷却，不会重复关。
 *
 * 模式语义：安全联锁在自动和手动模式下**全程生效**，不因手动强制开启而失效
 * （如手动开了加热但检测到无水流，仍会按规则强制关掉）。
 *
 * 【配置】见同目录 config.js，改后需重启后端。
 */

// ========== 赛场速改索引（要改什么 → 去哪） ==========
//  改判断条件 / 改触发后的动作   config.js 的 rules 数组，每条的 when / then
//  加一条新规则                 config.js 的 rules 里照着抄一条改
//  临时停掉某一条               config.js 那条规则的 enabled: false
//  关掉整个安全联锁             config.js enabled=false
//  改阈值                       指令中心网页（温度上限/流量下限/压力上限…），不用重启
//  "开加热必须先开泵"           config.js requirePumpBeforeHeater=true（不受总开关约束）
//  掉线检测周期                 config.js monitorIntervalMs（改后重启）
// ===================================================
const EventEmitter = require('events')
const CONFIG = require('./config')
const { SENSOR_FIELD_MAP } = require('../../config/appSettings')
const { MQTT_TOPICS } = require('../../config/mqtt')
const { getCurrentMode } = require('../directData/getControlMode')
const {
  getNumberValue,
  getAbnormalMax,
  getThresholdValue,
  getTempDiff,
  readSensors,
  readSwitchStates,
  setSwitch,
  resolveDeviceNoStr,
} = require('../controlShared/controlHelpers')
const { createCooldown } = require('../controlShared/cooldown')
const { recordEvent } = require('../controlShared/recordEvent')

/** 规则 then 里的开关 preffix → 日志和告警里显示的中文名。没列到的直接用 preffix 本身，
 *  所以 config.js 里写 then: { fan: 'on' } 也能用，不必回来改这张表。 */
const SWITCH_LABELS = { pump: '水泵', heater: '加热' }

/** 每个设备上一次的控制模式，用来识别"自动 -> 手动"这个切换瞬间。 */
const lastMode = new Map()
/** 触发冷却：同一个"设备+规则"在 alarmCooldownMs 内只处理一次。 */
const cooldown = createCooldown()
/** 每次真正触发时 emit 'safety'，app.js 转成 WebSocket 推给前端弹提示。 */
const events = new EventEmitter()
/** 每个设备最近若干个流量读数，用于算波动幅度。 */
const flowWindowMap = new Map()
/** 掉线监测定时器。 */
let monitorTimer = null

/** 追加一个流量读数到滑动窗口，超出窗口大小丢掉最早的。窗口没填满返回 null
 *  （数据不够不判断，避免设备刚上线就误报），填满后返回最大值-最小值。 */
function trackFlowVolatility(deviceNo, flow) {
  const size = Number.isInteger(Number(CONFIG.flowVolatilityWindow)) && Number(CONFIG.flowVolatilityWindow) >= 2
    ? Number(CONFIG.flowVolatilityWindow)
    : 10
  const key = deviceNo || 'global'
  if (!flowWindowMap.has(key)) flowWindowMap.set(key, [])
  const window = flowWindowMap.get(key)
  window.push(flow)
  if (window.length > size) window.shift()
  if (window.length < size) return null
  return Math.max(...window) - Math.min(...window)
}

/**
 * 一条规则命中之后要做的全部事情：冷却判断 → 按 then 下发动作 → 写故障记录 → 广播。
 * 冷却期内直接返回 null，不重复下发也不重复记录。
 * then 里写了几个开关就下发几个，每个单独 try/catch，一个失败不影响另一个。
 */
async function applyRule(rule, deviceNo, detail) {
  const cooldownKey = `${deviceNo || 'global'}:${rule.id}`
  const cooldownMs = Number(CONFIG.alarmCooldownMs) >= 0 ? Number(CONFIG.alarmCooldownMs) : 30000
  if (cooldown.withinCooldown(cooldownKey, cooldownMs)) return null
  cooldown.markFired(cooldownKey)

  const actions = Object.entries(rule.then || {})
  const done = []
  for (const [prefix, value] of actions) {
    const label = SWITCH_LABELS[prefix] || prefix
    try {
      if (await setSwitch(prefix, label, value, deviceNo, 'interlock')) {
        done.push(`${label}→${value}`)
        console.log(`[SafetyInterlock] ${rule.name}：${label} -> ${value}，设备 ${deviceNo || '全局'}`)
      }
    } catch (err) {
      console.error(`[SafetyInterlock] ${label} -> ${value} 下发失败:`, err.message)
    }
  }

  // 规则配了动作就记成"安全联锁"，没配动作（then 空）就是"只记录不动作"的安全告警。
  const suffix = actions.length > 0
    ? `，已执行安全联锁（${done.length ? done.join('、') : '下发失败'}）`
    : '，安全联锁已记录（未执行关闭）'
  await recordEvent({
    deviceNo,
    message: `${rule.name}${suffix}，${detail || ''}`,
    code: rule.id,
    type: actions.length > 0 ? '安全联锁' : '安全告警',
  })

  const outcome = { id: rule.id, name: rule.name, detail: detail || '', interlocked: done.length > 0 }
  events.emit('safety', { ...outcome, deviceNo: deviceNo || null })
  return outcome
}

/**
 * 每条 MQTT 数据入库后调用，是本模块唯一的消息入口。
 * 先把这条消息能提供的现场数据整理成 s，再拿 config.js 的 rules 一条条判。
 * @param {Object} info - 已解析的设备上报数据
 * @returns {Array} 本次触发的规则结果
 */
async function evaluateSafety(info) {
  if (CONFIG.enabled !== true) return []

  const deviceNo = await resolveDeviceNoStr(info)
  const sensors = await readSensors(info)
  const states = await readSwitchStates(info)

  // 控制模式是个持续状态、不是事件，得跟上次读到的比才能判断出"这一刻刚切换"。
  const mode = await getCurrentMode(deviceNo)
  const prevMode = lastMode.get(deviceNo)
  lastMode.set(deviceNo, mode)

  // 设备每条上报都带齐 SENSOR_FIELD_MAP 里的传感器字段是常态，缺了就说明那一路掉线。
  // 传感器和行为字段合并在同一条消息上报时，水泵/加热状态字段缺失同样算掉线；
  // 分主题上报时纯传感器消息本就不带行为字段，不参与这条判断，免得每条都误触发。
  const missingFields = Object.keys(SENSOR_FIELD_MAP || {}).filter((key) => sensors[key] == null)
  const topics = MQTT_TOPICS || {}
  if (topics.sensor && topics.sensor === topics.behavior) {
    if (states.pumpOn == null) missingFields.push('水泵状态')
    if (states.heatOn == null) missingFields.push('加热状态')
  }

  const s = {
    flow: sensors.flow,
    pressure: sensors.pressure,
    temp1: sensors.temp1,
    temp2: sensors.temp2,
    tempDiff: getTempDiff(sensors),
    pumpOn: states.pumpOn,
    heatOn: states.heatOn,
    flowVolatility: sensors.flow != null ? trackFlowVolatility(deviceNo, sensors.flow) : null,
    missingFields,
    modeJustToManual: mode === 'manual' && prevMode === 'auto',
    mode,
  }
  const ctx = {
    deviceNo,
    config: CONFIG,
    abnormalMax: getAbnormalMax(),
    threshold: (slot) => getThresholdValue(slot, deviceNo),
    number: (prefix, fallback, fallbackDefault) => getNumberValue(prefix, deviceNo, fallback, fallbackDefault),
  }

  const results = []
  for (const rule of CONFIG.rules || []) {
    if (rule.enabled === false) continue
    let hit
    try {
      hit = await rule.when(s, ctx)
    } catch (err) {
      // 单条规则写错了不能把整个安全联锁带崩，跳过这条继续判下一条。
      console.error(`[SafetyInterlock] 规则 ${rule.id} 判断出错，已跳过:`, err.message)
      continue
    }
    if (!hit) continue
    const outcome = await applyRule(rule, deviceNo, typeof hit === 'string' ? hit : '')
    if (outcome) results.push(outcome)
  }

  if (results.length) {
    console.log(`[SafetyInterlock] 触发 ${results.length} 项安全联锁，设备 ${deviceNo || '全局'}，模式 ${mode}`)
  }
  return results
}

/* ============================ 掉线监测 ============================ */

/** 上面 evaluateSafety 靠"收到消息"驱动，但设备彻底掉线时根本没有消息进来，
 *  也就没人去调它。这里用独立定时器主动查每台设备的心跳，超时就按规则表里
 *  sensor_offline 那条的动作处理（跟"消息缺字段"共用同一条规则和同一份冷却）。 */
async function monitorOffline() {
  if (CONFIG.enabled !== true) return
  const rule = (CONFIG.rules || []).find((r) => r.id === 'sensor_offline')
  if (!rule || rule.enabled === false) return

  let mqttClient
  try {
    mqttClient = require('../../mqtt')
  } catch (err) {
    return
  }
  for (const st of mqttClient.getAllDeviceStatus() || []) {
    if (!st.configured || st.online) continue
    const deviceNo = st.deviceNumber || st.deviceId
    await applyRule(rule, deviceNo, `设备 ${deviceNo} 心跳超时，无数据上报`)
  }
}

/** 启动掉线监测定时器（服务启动时调一次）。周期在启动时读一次 monitorIntervalMs，
 *  改了要重启后端才生效，不是热更新。 */
function startMonitor() {
  if (monitorTimer) return
  const configured = Number(CONFIG.monitorIntervalMs)
  const intervalMs = Number.isFinite(configured) && configured >= 1000 ? configured : 5000
  monitorTimer = setInterval(async () => {
    try {
      await monitorOffline()
    } catch (err) {
      console.error('[SafetyInterlock] 掉线监测失败:', err.message)
    }
  }, intervalMs)
  monitorTimer.unref?.()
}

module.exports = { evaluateSafety, startMonitor, onSafetyInterlock: (listener) => events.on('safety', listener) }
