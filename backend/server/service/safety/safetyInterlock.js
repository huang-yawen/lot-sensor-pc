/**
 * 【文件职责】安全联锁（安全锁联）服务。
 *
 * 触发任一启用条件时，强制关闭水泵和加热，并把一条记录写进 t_error_msg
 * （type='安全联锁'）。所有条件都能通过配置中心 SAFETY_INTERLOCK 逐条布尔开关。
 *
 * 条件清单（括号里是评估它的函数）：
 *   - 流量异常：流量为 0 / 顶到异常哨兵 / 低于流量下限        （evaluateValueConditions）
 *   - 压力异常：压力为 0 / 顶到异常哨兵 / 高于压力上限        （evaluateValueConditions）
 *   - 温度超上限：进水或出水温度顶到异常哨兵 / 高于温度上限   （evaluateValueConditions）
 *   - 温差过大：|进水-出水| > 温差阈值（安全联锁专用的独立指令项 safety_temp_diff_threshold
 *     优先，没配置才退回配置中心 SAFETY_INTERLOCK.tempDiffThreshold；与联动"加热滞回带通断"
 *     ③号短路、故障机"水泵故障"各用各的指令项，互不影响，evaluateValueConditions）
 *   - 流量剧烈波动：最近 N 个读数的极差 > flowVolatilityThreshold（疑似水锤/湍流，evaluateValueConditions）
 *   - 未开水泵却开加热：加热确认开、水泵确认关（两个开关状态都明确上报时才判，evaluateValueConditions）
 *   - 进入手动模式：控制模式从 auto 切到 manual 的那一刻，安全关闭一次（evaluateSafety）
 *   - 传感器掉线：①收到消息但缺字段——传感器字段（SENSOR_FIELD_MAP）任缺其一即算掉线；
 *     传感器与行为合并上报时（MQTT_TOPICS.sensor === behavior），控制器的水泵/加热状态字段缺失
 *     同样算（evaluateValueConditions，每条消息判）；②设备心跳超时、完全没有消息进来（靠独立
 *     定时器 monitorOffline 主动查）。两条共用 sensor_offline
 *
 * 阈值分两类来源：温度/流量/压力上下限、温差阈值、流量波动阈值都从**指令中心** t_direct
 * 按 preffix 实时读（getThresholdValue/getNumberValue，指令项删掉才退回配置中心，
 * 用户在页面改完立即生效，符合项目"指令配置优先、配置中心兜底"的统一约定）；
 * 冷却时长、异常哨兵值、掉线检测周期这类纯软件行为参数没有对应硬件语义，只从
 * **配置中心** SAFETY_INTERLOCK 读。
 *
 * 模式语义：安全联锁在自动和手动模式下**全程生效**——触发任一启用条件都会强制关闭
 * 水泵和加热。区别只在于：
 *   - 自动模式：正常状况联动（linkageRules.js）按目标温度启停水泵/加热，安全联锁在其上层保护。
 *   - 手动模式：人工下发指令单独开关，但安全联锁不因手动强制开启而失效（如手动开加热
 *     但检测到无水流，仍会强制关加热）；额外地，"进入手动模式"这一刻会安全关闭一次。
 *
 * 【配置中心关联】SAFETY_INTERLOCK 每次评估动态读取，保存配置后立即生效
 * （monitorIntervalMs 除外——它在启动时读一次，改后需重启后端）。
 */
const EventEmitter = require('events')
// 安全联锁自己的开关和参数（总开关、各条件、异常哨兵值、掉线监测周期等）都在这里。
const CONFIG = require('./config')
const { SENSOR_FIELD_MAP } = require('../../config/appSettings')
const { MQTT_TOPICS } = require('../../config/mqtt')
const { getCurrentMode } = require('../directData/getControlMode')
// 读传感器/开关、查阈值、下发开关、解析设备号——统一走 controlShared，不再本地重抄一份。
// 流量波动阈值支持现场在指令中心调（preffix=flow_volatility），删掉就退回配置中心。
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

// 传感器掉线或短路时，很多硬件驱动不会直接不上报数据，而是把读数钳位成一个固定的
// 极端大值（比如 9999）。这里用这个哨兵值单独识别"掉线/短路"这种情况，跟"读数超过
// 正常阈值"区分开。哨兵值本身在 controlHelpers.js/getAbnormalMax() 统一维护
// （可在配置中心 SAFETY_INTERLOCK.abnormalMax 调），linkageRules.js 也用同一处。

/** 对每个设备记录上一次的控制模式，用于识别“自动 -> 手动”切换。 */
const lastMode = new Map()
/** 告警/联锁冷却：与故障状态机同一份实现（controlShared/cooldown），各自持有独立计时状态。 */
const cooldown = createCooldown()
/** 安全联锁事件总线：每次真正触发（非冷却期）时 emit 'safety'，供 app.js 转成
 * WebSocket 的 safety_triggered 推给前端非阻塞提示。跟 faultStatus.js 的 onFault、
 * evaluateRules.js 的 onAlarm 是同一套机制。 */
const events = new EventEmitter()

/** 每个设备最近若干个流量读数的滑动窗口，用于判断流量波动幅度（疑似水锤/湍流）。 */
const flowWindowMap = new Map()

/** 窗口大小（点数）：默认 10，可在配置中心 SAFETY_INTERLOCK.flowVolatilityWindow 调整；
 * 没配置或不是 >=2 的整数时退回默认值 10。跟"累计与滑动统计"页里 flow_volatility
 * 这个历史图表指标各自独立维护，不是同一份状态（那边查数据库算历史曲线，这里是
 * 实时联锁用内存滑动窗口判断），窗口大小不要求两边一致。 */
function getFlowVolatilityWindow() {
  const v = Number(CONFIG.flowVolatilityWindow)
  return Number.isInteger(v) && v >= 2 ? v : 10
}

/** 追加一个新读数到滑动窗口，超出窗口大小就丢弃最早的一个；窗口还没填满设定的点数时
 * 返回 null（数据不够，不判断，避免设备刚上线就误报），填满后返回窗口内最大值-
 * 最小值，即这段时间流量的波动幅度。 */
function trackFlowVolatility(deviceNo, flow) {
  const key = deviceNo || 'global'
  if (!flowWindowMap.has(key)) flowWindowMap.set(key, [])
  const window = flowWindowMap.get(key)
  const windowSize = getFlowVolatilityWindow()
  window.push(flow)
  if (window.length > windowSize) window.shift()
  if (window.length < windowSize) return null
  return Math.max(...window) - Math.min(...window)
}

/** 掉线监测定时器。 */
let monitorTimer = null

// 说明：读传感器（readSensors）、读开关状态（readSwitchStates）、按 preffix 查阈值
// （getThresholdValue）、按 preffix 查开关配置、把原始值转数字（toNumber）、解析设备号
// （resolveDeviceNoStr）这些底层动作，以前本文件各自维护了一份，现在统一在
// service/controlShared/controlHelpers.js（linkageRules.js / faultStatus.js 也共用同一份），
// 见文件顶部 require。冷却计时用 controlShared/cooldown.js，写 t_error_msg 用
// controlShared/recordEvent.js。

/* ============================ 告警与联锁 ============================ */

/**
 * 把一次触发写进故障记录表 t_error_msg，供"故障记录"页面查看。
 * interlocked 区分这次触发到底有没有真的去关闭执行器：
 *   true  -> 已经强制关闭了水泵和加热，消息里注明"已执行安全联锁"，类型标记为
 *            "安全联锁"（这套系统目前所有条件的 interlock 都传 true，预留
 *            false 分支是给以后可能"只记录不动作"的告警类型用）。
 *   false -> 只是记了一笔，没有真的去关执行器，类型标记为"安全告警"。
 */
async function recordAlarm(deviceNo, trigger, interlocked) {
  const suffix = interlocked
    ? '，已执行安全联锁（关闭水泵和加热）'
    : '，安全联锁已记录（未执行关闭）'
  await recordEvent({
    deviceNo,
    message: `${trigger.name}${suffix}，${trigger.detail || ''}`,
    code: trigger.id,
    type: interlocked ? '安全联锁' : '安全告警',
  })
}

/** 强制关闭水泵和加热（安全联锁的"动作"部分）。逐个调 controlShared 的 setSwitch，
 * 它内部会：发布 MQTT 断电报文 -> 把 t_direct 里的开关显示值改成 off -> 记一条
 * source='interlock' 的操作历史。两个执行器分别 try/catch，其中一个下发失败不影响
 * 另一个。只要有一个成功关掉就返回 true（供上层标记 interlocked=true）。 */
async function closePumpHeater(deviceNo, triggerId) {
  let closed = 0
  for (const [prefix, name] of [['pump', '水泵'], ['heater', '加热']]) {
    try {
      if (await setSwitch(prefix, name, 'off', deviceNo, 'interlock')) {
        closed++
        console.log(`[SafetyInterlock] 联锁关闭 ${name}（${triggerId}），设备 ${deviceNo || '全局'}`)
      }
    } catch (err) {
      console.error(`[SafetyInterlock] 关闭 ${name} 失败:`, err.message)
    }
  }
  return closed > 0
}

/**
 * 对单个触发条件执行：冷却判断 -> 告警记录 -> 可选联锁。
 *
 * cooldownMs 时间内，同一个"设备+故障类型"只处理一次：处理过一次后就记下时间戳，
 * 在冷却期内即使条件仍然满足也直接跳过，不会重复关水泵、重复写告警，等冷却期
 * 过了才会重新判断处理。
 * @returns {object|null} 执行结果，冷却期内返回 null。
 */
async function fire(trigger, deviceNo, safetyConfig, { interlock }) {
  const cooldownKey = `${deviceNo || 'global'}:${trigger.id}`
  const cooldownMs = Number(safetyConfig.alarmCooldownMs) >= 0 ? Number(safetyConfig.alarmCooldownMs) : 30000
  if (cooldown.withinCooldown(cooldownKey, cooldownMs)) return null
  cooldown.markFired(cooldownKey)

  const outcome = { ...trigger, interlocked: false }
  if (interlock) {
    outcome.interlocked = await closePumpHeater(deviceNo, trigger.id)
  }
  await recordAlarm(deviceNo, trigger, interlock)
  // 广播这次触发，供 app.js 转成 WebSocket safety_triggered 推给前端非阻塞提示。
  // 冷却期内上面已经 return null，能走到这里的都是真正动作过的触发。
  events.emit('safety', { ...outcome, deviceNo: deviceNo || null })
  return outcome
}

/* ============================ 条件评估 ============================ */

/**
 * 判断条件 1~4、条件 6 和条件 7（编号对应文件头部的清单）：这几条的共同点是只需要看
 * "这一条消息本身携带的数值/字段"就能判断，不需要额外记住跨消息的状态、也不需要
 * 单独起个定时器——这跟条件 5（进入手动模式，得记住上一次的模式才能判断出
 * "切换"这个瞬间）和"传感器掉线"里"完全没有消息进来"那部分（必须靠定时器
 * monitorOffline 主动查）是不同类型的判断，所以拆成单独一个函数、不跟它们混在一起。
 * 命中的条件都会被塞进 triggers 数组一起返回，调用方 evaluateSafety 逐个拿去
 * 走"冷却判断 -> 记录告警 -> 联锁关闭"这一整套流程（见 fire 函数）。
 */
async function evaluateValueConditions(info, deviceNo, safetyConfig) {
  const sensors = await readSensors(info)
  const states = await readSwitchStates(info)
  const triggers = []

  // 1. 流量低于下限阈值或流量为 0（含异常最大值）。
  if (safetyConfig.flowLow && sensors.flow != null) {
    const flowLow = await getThresholdValue('flowLow', deviceNo)
    if (sensors.flow === 0 || sensors.flow >= getAbnormalMax() || (flowLow != null && sensors.flow < flowLow)) {
      triggers.push({
        id: 'flow_low',
        name: '流量异常（低于下限/为0/掉线）',
        detail: `流量=${sensors.flow}${flowLow != null ? `，下限=${flowLow}` : ''}`,
      })
    }
  }

  // 2. 压力高于上限阈值或压力为 0（含异常最大值）。
  if (safetyConfig.pressureHigh && sensors.pressure != null) {
    const pressureHigh = await getThresholdValue('pressureHigh', deviceNo)
    if (sensors.pressure === 0 || sensors.pressure >= getAbnormalMax() || (pressureHigh != null && sensors.pressure > pressureHigh)) {
      triggers.push({
        id: 'pressure_high',
        name: '压力异常（高于上限/为0/掉线）',
        detail: `压力=${sensors.pressure}${pressureHigh != null ? `，上限=${pressureHigh}` : ''}`,
      })
    }
  }

  // 3. 任一温度高于上限阈值（含异常最大值）。
  if (safetyConfig.tempHigh) {
    const tempHigh = await getThresholdValue('tempHigh', deviceNo)
    for (const [key, label] of [['temp1', '温度1（进水）'], ['temp2', '温度2（出水）']]) {
      const v = sensors[key]
      if (v != null && (v >= getAbnormalMax() || (tempHigh != null && v > tempHigh))) {
        triggers.push({
          id: 'temp_high',
          name: '任一温度高于上限',
          detail: `${label}=${v}${tempHigh != null ? `，上限=${tempHigh}` : ''}`,
        })
      }
    }
  }

  // 4. 温差过大。温差本身用共用的 getTempDiff 算（进水或出水读数缺一个就返回 null，
  //    这里 `diff != null` 一并挡掉，不会拿 NaN 去比阈值）；阈值支持现场在指令中心调
  //    （preffix=safety_temp_diff_threshold，安全联锁专用的独立指令项），指令项删掉才退回
  //    配置中心 SAFETY_INTERLOCK.tempDiffThreshold。这个阈值只归安全联锁"温差过大"用：
  //    联动规则 ruleHeaterHysteresis 里③号短路判据用的是 temp_diff_open、联动"双温度融合"
  //    用的是 dual_temp_diff、故障机"水泵故障"用的是 temp_diff，四处各自独立，现场调参时
  //    注意别调错了对应的那一项。
  if (safetyConfig.tempDiff) {
    const diff = getTempDiff(sensors)
    const tempDiffThreshold = await getNumberValue('safety_temp_diff_threshold', deviceNo, safetyConfig.tempDiffThreshold, 10)
    if (diff != null && diff > tempDiffThreshold) {
      triggers.push({ id: 'temp_diff', name: '温差过大', detail: `温差=${diff.toFixed(2)} > ${tempDiffThreshold}℃` })
    }
  }

  // 5. 流量剧烈波动（疑似水锤/湍流）：最近 10 个读数里最大值-最小值超过阈值。
  // 跟前面几条比阈值不同——那几条是拿单次读数直接跟阈值比，这条要先攒够一段
  // 时间的读数才能算出"波动幅度"这个统计量，所以哪怕这次读数本身正常，只要
  // 跟前面几次差得太大，同样会触发。
  if (safetyConfig.flowVolatility && sensors.flow != null) {
    const volatility = trackFlowVolatility(deviceNo, sensors.flow)
    const threshold = await getNumberValue('flow_volatility', deviceNo, safetyConfig.flowVolatilityThreshold, 20)
    if (volatility != null && volatility > threshold) {
      triggers.push({
        id: 'flow_volatility',
        name: '流量剧烈波动（疑似水锤/湍流）',
        detail: `最近${getFlowVolatilityWindow()}个读数波动幅度=${volatility.toFixed(2)} > ${threshold}`,
      })
    }
  }

  // 6. 数据结构不完整（有传感器/控制器掉线）：设备每条上报都带齐 SENSOR_FIELD_MAP 里的
  // 全部传感器字段是常态，一旦本条消息里缺了任意一个（readSensors 解析出来是 null），就说明
  // 对应那路传感器掉线/没上报，保守起见立即全关。传感器和行为字段合并在同一条消息上报时
  // （MQTT_TOPICS.sensor === behavior），控制器的水泵/加热状态字段也必须齐全，缺了同样算掉线；
  // 两类字段分主题上报时纯传感器消息本就不带行为字段，不参与这条判断（避免每条传感器消息误触发）。
  // 这里只看"本条消息带没带齐字段"，跟 monitorOffline 靠定时器查"整台设备心跳超时、完全没
  // 消息"是互补的两条路径，共用同一个 sensor_offline id 和冷却：任一条先触发，30 秒内另一条
  // 就不会重复关。
  if (safetyConfig.sensorOffline) {
    const missingFields = Object.keys(SENSOR_FIELD_MAP || {})
      .filter((key) => sensors[key] == null)
    const topics = MQTT_TOPICS || {}
    if (topics.sensor && topics.sensor === topics.behavior) {
      if (states.pumpOn == null) missingFields.push('水泵状态')
      if (states.heatOn == null) missingFields.push('加热状态')
    }
    if (missingFields.length > 0) {
      triggers.push({
        id: 'sensor_offline',
        name: '传感器掉线（数据结构不完整）',
        detail: `本条上报缺少字段：${missingFields.join('、')}`,
      })
    }
  }

  // 7. 没打开水泵不能打开加热：水泵确认关闭时，加热却确认开启。只在两个开关状态都明确
  // 上报（不是 null/未知）时判断，避免消息里缺行为字段（如纯传感器消息）时误触发。
  if (safetyConfig.heaterWithoutPump && states.heatOn === true && states.pumpOn === false) {
    triggers.push({ id: 'heater_without_pump', name: '未开水泵却开启加热', detail: `水泵=关，加热=开` })
  }

  return triggers
}

/**
 * 消息驱动评估：在每条 MQTT 数据入库后调用（条件 1~5）。这是整个安全联锁模块唯一的
 * 外部入口，调用方（mqtt 消息处理流程）每收到一条设备上报就调一次本函数。
 * @param {Object} info - 已解析的设备上报数据
 * @returns {Array} 本次触发的安全联锁结果
 */
async function evaluateSafety(info) {
  const safetyConfig = CONFIG
  if (safetyConfig.enabled !== true) return []

  const deviceNo = await resolveDeviceNoStr(info)
  // 控制模式是指令中心里的一个持续状态值，不是靠某条 MQTT 消息触发的事件，所以这里
  // 用 lastMode 保存上一次读到的模式，跟这一次的模式对比，才能判断出"这一刻恰好
  // 发生了切换"，而不只是看到"当前是手动"。
  const mode = await getCurrentMode(deviceNo)
  const prevMode = lastMode.get(deviceNo)
  lastMode.set(deviceNo, mode)

  const results = []

  // 5. 进入手动模式：自动 -> 手动切换时安全关闭一次，供人工修复。
  if (safetyConfig.manualMode !== false && mode === 'manual' && prevMode === 'auto') {
    const r = await fire(
      { id: 'manual_mode', name: '进入手动模式（人工修复）', detail: '控制模式 自动->手动' },
      deviceNo, safetyConfig, { interlock: true }
    )
    if (r) results.push(r)
  }

  // 1~4：值条件。安全联锁在自动和手动模式下都强制关闭，不会因手动强制开启而失效。
  const valueTriggers = await evaluateValueConditions(info, deviceNo, safetyConfig)
  for (const trigger of valueTriggers) {
    const r = await fire(trigger, deviceNo, safetyConfig, { interlock: true })
    if (r) results.push(r)
  }

  if (results.length) {
    console.log(`[SafetyInterlock] 触发 ${results.length} 项安全联锁，设备 ${deviceNo || '全局'}，模式 ${mode}`)
  }
  return results
}

/* ============================ 掉线监测（条件 6） ============================ */

// 前面 1~5 条都是靠"收到一条 MQTT 消息"触发 evaluateSafety 来判断的，但设备掉线是
// "完全没有消息进来了"，没消息就不会调用 evaluateSafety。这里用一个独立的定时器，
// 主动去查"每个设备上次收到心跳是多久之前"，而不是等消息来了才检查。
async function monitorOffline() {
  const safetyConfig = CONFIG
  if (safetyConfig.enabled !== true || safetyConfig.sensorOffline === false) return

  let mqttClient
  try {
    mqttClient = require('../../mqtt')
  } catch (err) {
    return
  }
  const statuses = mqttClient.getAllDeviceStatus() || []
  for (const st of statuses) {
    if (!st.configured || st.online) continue
    const deviceNo = st.deviceNumber || st.deviceId
    await fire(
      { id: 'sensor_offline', name: '传感器掉线（无数据上报）', detail: `设备 ${deviceNo} 心跳超时` },
      deviceNo, safetyConfig, { interlock: true }
    )
  }
}

/** 启动掉线监测定时器（在服务启动时调用一次）。检测周期在启动时读取一次配置中心
 * SAFETY_INTERLOCK.monitorIntervalMs（默认 5000ms，没配置/小于 1000 时退回默认值），
 * 属于"保存后需要重启后端才生效"的一类配置，不是热更新。 */
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