/**
 * 【文件职责】安全联锁服务：每收到一条设备上报，逐条判断安全联锁条件，命中就
 *   下发对应的动作，并往 t_error_msg 写一条记录（type='安全联锁'）。
 *
 * ★★ 赛场上要改安全联锁，改下面的 checkRules 函数就够了 ★★
 *   直接在里面写 if 条件 + return 对应的操作，加规则删规则都改这里。
 *
 * 整条链路只有两层：
 *   evaluateSafety（每条消息）──┐
 *                              ├─→ fire ─→ setSwitch（下发 MQTT + 落库 + 操作历史）
 *   monitorOffline（定时器）───┘
 *
 * 触发两条路径的区别：evaluateSafety 靠"收到消息"驱动，能判断消息里的数值；
 * monitorOffline 靠定时器主动查"整台设备心跳超时、完全没消息进来"——没消息就不会
 * 有人调 evaluateSafety，所以这条必须单独起定时器。两条路径共用同一份冷却，不会重复关。
 *
 * 模式语义：安全联锁在自动和手动模式下**全程生效**，不因手动强制开启而失效
 * （如手动开了加热但检测到无水流，仍会按规则强制关掉）。
 *
 * 【配置】见同目录 config.js（总开关、各条件开关、冷却时间、波动窗口等），改后需重启后端。
 */

// ========== 赛场速改索引（要改什么 → 去哪） ==========
//  改判断条件 / 加规则 / 删规则   下面的 checkRules 函数，直接写 if + return
//  临时停掉某一条               config.js 那条条件的开关 = false（注释掉/删掉也算关，只有写 true 才开）
//  关掉整个安全联锁             config.js enabled=false
//  只判只记录、不下发开关动作     config.js executeActions=false（记录和弹提示照常）
//  改阈值                       指令中心网页（温度上限/流量下限/压力上限…），不用重启
//  "开加热必须先开泵"           config.js requirePumpBeforeHeater=true（不受总开关约束）
//  掉线检测周期                 config.js monitorIntervalMs（改后重启）
//  水泵预热时长（规则2/3/6 用）   指令中心 pump_warmup_ms，没配才用 faultStatus/config.js 的
//                               pumpWarmupMs——跟故障状态机共用一份，改一处两边一起变
// ===================================================
const EventEmitter = require('events')
const CONFIG = require('./config')
// 水泵预热时长跟故障状态机共用一份：指令中心 pump_warmup_ms 优先，没配才退回
// FAULT_STATUS.pumpWarmupMs。这里只读它这一个兜底值，不读故障机的其它参数。
const FAULT_CONFIG = require('../faultStatus/config')
const { SENSOR_FIELD_MAP, SINGLE_DEVICE_MODE } = require('../../config/appSettings')
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
  formatSwitchChange,
  resolveDeviceNoStr,
} = require('../controlShared/controlHelpers')
const { createCooldown } = require('../controlShared/cooldown')
const { recordEvent } = require('../controlShared/recordEvent')
const { isAnyLocked, isLockedByFault } = require('../faultStatus/faultStatus')

/** 开关 preffix → 日志和告警里显示的中文名。没列到的直接用 preffix 本身，
 *  所以代码里写 { prefix: 'fan', value: 'on' } 也能用，不必回来改这张表。 */
const SWITCH_LABELS = { pump: '水泵', heater: '加热' }

/** 每个设备上一次的控制模式，用来识别"自动 -> 手动"这个切换瞬间。 */
const lastMode = new Map()
/** 触发冷却：同一个"设备+规则"在 alarmCooldownMs 内只处理一次。 */
const cooldown = createCooldown()
/** 每次真正触发时 emit 'safety'，app.js 转成 WebSocket 推给前端弹提示。 */
const events = new EventEmitter()
/** 每个设备最近若干个流量读数，用于算波动幅度。 */
const flowWindowMap = new Map()
/** 水泵启动预热计时：记录水泵"从关到开"的起始时间，水泵关闭则清空。
 *  跟故障状态机 faultStatus.js 里的 pumpStartStateMap 是同一个做法，但各记各的——
 *  两个模块各自收消息、各自复位，共用一份内存状态会互相清零。 */
const pumpStartStateMap = new Map()
/** 掉线监测定时器。 */
let monitorTimer = null

/**
 * 返回水泵已连续开启的时长（毫秒）；从未开启过时返回 null。写法照搬故障状态机的
 * trackPumpOnDuration：水泵每次从关变开时记一个起始时间戳，之后每次调用返回
 * "现在 - 起始时间"；水泵一关就把起始时间清掉，下次再开会重新计时。
 *
 * @param {boolean|null} pumpOn - 水泵开关的三态读数（见 controlHelpers.js 的
 *   readSwitchStates）：true=确认开，false=确认关，null=这条消息没能解析出水泵
 *   的行为上报（不知道，不代表关闭）。只有明确收到 false 才清空计时；null 时
 *   保留已有计时继续走，不能当成"关"处理——否则只要偶尔有一条消息解析不出
 *   水泵状态，预热计时就会被清零重来，预热时长配多久都攒不够，流量两条规则就永远不判。
 */
function trackPumpOnDuration(deviceNo, pumpOn) {
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

/** 追加一个流量读数到滑动窗口，超出窗口大小丢掉最早的。窗口没填满返回 null
 *  （数据不够不判断，避免设备刚上线就误报），填满后返回最大值-最小值。
 *
 *  pumpWarmedUp=false（水泵没开，或刚开还在预热）时不收这个读数，并把窗口整个清空：
 *  水泵启动时流量从 0 往上爬，这段爬升本身就是大幅"波动"，留在窗口里的话，预热一结束
 *  窗口里还同时有启动时的 0 和稳定后的读数，极差很大，会立刻误报"流量剧烈波动"。
 *  清空后要等预热完成、重新攒满 flowVolatilityWindow 个稳定读数才开始判。 */
function trackFlowVolatility(deviceNo, flow, pumpWarmedUp) {
  const size = Number.isInteger(Number(CONFIG.flowVolatilityWindow)) && Number(CONFIG.flowVolatilityWindow) >= 2
    ? Number(CONFIG.flowVolatilityWindow)
    : 10
  const key = deviceNo || 'global'
  if (!pumpWarmedUp) {
    flowWindowMap.delete(key)
    return null
  }
  if (!flowWindowMap.has(key)) flowWindowMap.set(key, [])
  const window = flowWindowMap.get(key)
  window.push(flow)
  if (window.length > size) window.shift()
  if (window.length < size) return null
  return Math.max(...window) - Math.min(...window)
}

/* ============================================================
 * ★★★ 赛场改这里：安全联锁的判定规则 ★★★
 * ============================================================
 * 一个规则命中后返回：{ id, name, detail, actions }
 *   id       规则编号（也作故障记录里的 code）
 *   name     规则名称（故障记录里显示）
 *   detail   原因说明（字符串，写进故障记录详情）
 *   actions  要下发的开关数组，每个 { prefix, value }：
 *            [{ prefix: 'pump', value: 'off' }, { prefix: 'heater', value: 'off' }]  两个都关
 *            [{ prefix: 'heater', value: 'off' }]   只关加热
 *            [{ prefix: 'pump', value: 'on' }]      也可以是"开"
 *            []                                       只记一笔，不动执行器
 *            prefix 是指令中心里的开关 preffix（pump / heater / ...）
 * 没命中返回 null。
 *
 * 参数说明：
 *   s —— 这一条上报解析出来的现场数据：
 *     s.flow             流量              s.pressure    压力
 *     s.temp1            进水温度          s.temp2       出水温度
 *     s.tempDiff         温差（两路温度缺一个就是 null）
 *     s.pumpOn           水泵开着吗（true / false / null=这条消息没带这个字段）
 *     s.heatOn           加热开着吗（同上）
 *     s.pumpOnDurationMs 水泵已连续开启多久（毫秒，没开是 null）
 *     s.pumpWarmedUp     水泵预热完成了吗（连续开满预热时长才是 true）
 *                        预热时长：指令中心 pump_warmup_ms 优先，没配用 FAULT_STATUS.pumpWarmupMs
 *     s.flowVolatility   最近 N 个流量读数的极差（没攒够点数、或水泵没预热完成是 null）
 *     s.missingFields    这条上报缺了哪些字段（数组，空数组 = 字段齐全）
 *     s.modeJustToManual 这一刻是不是刚从"自动"切到"手动"
 *     s.mode             当前控制模式 'auto' / 'manual'
 *
 *   ctx —— 读指令中心阈值才需要：
 *     await ctx.threshold('tempHigh')   温度上限，没配置返回 null
 *          可用槽位：tempHigh tempLow flowLow flowHigh pressureLow pressureHigh tempDiff
 *     await ctx.number('flow_volatility', 兜底值, 默认值)   按 preffix 读任意数值指令项
 *     ctx.abnormalMax    传感器异常哨兵值（读数 >= 它视为掉线/短路，默认 9999）
 *     ctx.deviceNo       当前设备号
 *     ctx.config         就是 config.js 这个对象（用来取兜底参数）
 *
 * s=null 表示定时器路径（设备完全没消息进来），返回固定动作即可。
 * ============================================================ */
async function checkRules(s, ctx) {
  const triggers = []
  // 每条规则的开关统一用 `=== true` 判断：config.js 里写了 true 才判，写 false、注释掉、
  // 删掉都算关。不要改成 `!== false`，那样注释掉一条反而等于打开。

  // ── 规则1：进入手动模式（人工修复） ──
  if (CONFIG.manualMode === true && s != null && s.modeJustToManual) {
    triggers.push({
      id: 'manual_mode',
      name: '进入手动模式（人工修复）',
      detail: '控制模式 自动->手动',
      actions: [{ prefix: 'pump', value: 'off' }, { prefix: 'heater', value: 'off' }],
    })
  }

  // ── 规则2：流量异常（低于下限/为0/掉线） ──
  // 水泵预热：水泵刚启动时流量还在从 0 往上爬，"流量=0""低于下限"这两种必须等水泵连续
  // 开满预热时长（s.pumpWarmedUp）才判，否则泵一开就被当场关掉，永远启动不起来。
  // "顶到异常哨兵值"不等预热：那是传感器掉线/短路，跟泵有没有转起来无关，照样立即关。
  if (CONFIG.flowLow === true && s != null && s.flow != null&&s.pumpOn==true) {
    const abnormalMax = ctx.abnormalMax
    let detail = null
    if (s.flow === 0) {
      if (s.pumpWarmedUp) detail = '流量=0'
    } else if (s.flow >= abnormalMax) detail = `流量=${s.flow}，顶到异常哨兵值 ${abnormalMax}`
    else if (s.pumpWarmedUp) {
      const min = await ctx.threshold('flowLow')
      if (min != null && s.flow < min) detail = `流量=${s.flow}，下限=${min}`
    }
    if (detail) {
      triggers.push({ id: 'flow_low', name: '流量异常（低于下限/为0/掉线）', detail, actions: [{ prefix: 'pump', value: 'off' }, { prefix: 'heater', value: 'off' }] })
    }
  }

  // ── 规则3：压力异常（高于上限/为0/掉线） ──
  // 水泵预热：跟规则2 同一个写法。泵刚启动时压力还没建立（=0）、或者启动瞬间有压力冲击
  // （高于上限），"压力=0""高于上限"这两种必须等水泵连续开满预热时长（s.pumpWarmedUp）才判；
  // s.pumpWarmedUp 隐含"泵开着"，所以泵关着时压力=0 也不再判。
  // "顶到异常哨兵值"不等预热：那是传感器掉线/短路，跟泵有没有转起来无关，照样立即关。
  if (CONFIG.pressureHigh === true && s != null && s.pressure != null) {
    const abnormalMax = ctx.abnormalMax
    let detail = null
    if (s.pressure === 0) {
      if (s.pumpWarmedUp) detail = '压力=0'
    } else if (s.pressure >= abnormalMax) detail = `压力=${s.pressure}，顶到异常哨兵值 ${abnormalMax}`
    else if (s.pumpWarmedUp) {
      const max = await ctx.threshold('pressureHigh')
      if (max != null && s.pressure > max) detail = `压力=${s.pressure}，上限=${max}`
    }
    if (detail) {
      triggers.push({ id: 'pressure_high', name: '压力异常（高于上限/为0/掉线）', detail, actions: [{ prefix: 'pump', value: 'off' }, { prefix: 'heater', value: 'off' }] })
    }
  }

  // ── 规则4：任一温度高于上限 ──
  if (CONFIG.tempHigh === true && s != null) {
    const max = await ctx.threshold('tempHigh')
    const abnormalMax = ctx.abnormalMax
    for (const [value, label] of [[s.temp1, '温度1（进水）'], [s.temp2, '温度2（出水）']]) {
      if (value == null) continue
      let detail = null
      if (value >= abnormalMax) detail = `${label}=${value}，顶到异常哨兵值 ${abnormalMax}`
      else if (max != null && value > max) detail = `${label}=${value}，上限=${max}`
      if (detail) {
        triggers.push({ id: 'temp_high', name: '任一温度高于上限', detail, actions: [{ prefix: 'pump', value: 'off' }, { prefix: 'heater', value: 'off' }] })
        break  // 有一个温度超限就够，不再判另一个
      }
    }
  }

  // ── 规则5：温差过大 ──
  // 温差阈值走安全联锁专用的指令项 safety_temp_diff_threshold，跟联动规则的
  // temp_diff_open、双温度融合的 dual_temp_diff、故障机的 temp_diff 各自独立，
  // 现场调参别调错了对应那一项。
  if (CONFIG.tempDiff === true && s != null && s.tempDiff != null) {
    const max = await ctx.number('safety_temp_diff_threshold', ctx.config.tempDiffThreshold, 10)
    if (s.tempDiff > max) {
      triggers.push({ id: 'temp_diff', name: '温差过大', detail: `温差=${s.tempDiff.toFixed(2)} > ${max}℃`, actions: [{ prefix: 'pump', value: 'off' }, { prefix: 'heater', value: 'off' }] })
    }
  }

  // ── 规则6：流量剧烈波动（疑似水锤/湍流） ──
  // 不是拿单次读数比阈值，而是要先攒够 flowVolatilityWindow 个读数才能算出波动幅度，
  // 所以哪怕这次读数本身正常，跟前几次差太多照样触发。
  // 水泵预热：水泵没开或还在预热时 trackFlowVolatility 不收读数并清空窗口，s.flowVolatility
  // 是 null；预热完成后要重新攒满窗口才开始判，启动时的流量爬升不会被当成波动。
  if (CONFIG.flowVolatility === true && s != null && s.pumpWarmedUp && s.flowVolatility != null) {
    const max = await ctx.number('flow_volatility', ctx.config.flowVolatilityThreshold, 20)
    if (s.flowVolatility > max) {
      triggers.push({ id: 'flow_volatility', name: '流量剧烈波动（疑似水锤/湍流）', detail: `最近${ctx.config.flowVolatilityWindow}个读数波动幅度=${s.flowVolatility.toFixed(2)} > ${max}`, actions: [{ prefix: 'pump', value: 'off' }, { prefix: 'heater', value: 'off' }] })
    }
  }

  // ── 规则7：传感器掉线 ──
  // 两条掉线路径共用这一条规则、共用同一份冷却：①本条消息缺字段（s 有值，看 s.missingFields）；
  // ②整台设备心跳超时、根本没消息进来（定时器路径，s=null）。任一条先触发，冷却期内另一条不会重复关。
  if (CONFIG.sensorOffline === true) {
    if (s == null) {
      // 定时器路径：设备完全没消息，返回固定动作
      triggers.push({ id: 'sensor_offline', name: '传感器掉线', detail: '', actions: [{ prefix: 'pump', value: 'off' }, { prefix: 'heater', value: 'off' }] })
    } else if (s.missingFields.length > 0) {
      triggers.push({ id: 'sensor_offline', name: '传感器掉线', detail: `本条上报缺少字段：${s.missingFields.join('、')}`, actions: [{ prefix: 'pump', value: 'off' }, { prefix: 'heater', value: 'off' }] })
    }
  }

  // ── 规则8：未开水泵却开启加热 ──
  // 只在两个开关状态都明确上报时才判，避免纯传感器消息（不带行为字段）误触发。
  if (CONFIG.heaterWithoutPump === true && s != null && s.heatOn === true && s.pumpOn === false) {
    triggers.push({ id: 'heater_without_pump', name: '未开水泵却开启加热', detail: '水泵=关，加热=开', actions: [{ prefix: 'pump', value: 'off' }, { prefix: 'heater', value: 'off' }] })
  }
  return triggers
}

/* ============================================================
 * 一条规则命中之后要做的全部事情：冷却判断 → 按 actions 下发动作 → 写故障记录 → 广播。
 * 冷却期内直接返回 null，不重复下发也不重复记录。
 * actions 里写了几个开关就下发几个，每个单独 try/catch，一个失败不影响另一个。
 *
 * 故障锁定期间（故障状态机触发后、人工复位前）：不下发任何开关（开、关都不发）、不改指令
 * 页面，只照常写记录和广播。故障机触发时已经断电，锁定期间整个系统约定"开关状态不再有
 * 任何变化"，复位时按故障前快照恢复——安全联锁这时再去改开关，页面会跟快照对不上，
 * 复位后执行器也可能不按故障前状态重启。跟告警联锁、继电器粘连重发的锁定处理一致。
 * ============================================================ */
async function fire(rule, deviceNo, detail, actions) {
  const cooldownKey = `${deviceNo || 'global'}:${rule.id}`
  const cooldownMs = Number(CONFIG.alarmCooldownMs) >= 0 ? Number(CONFIG.alarmCooldownMs) : 30000
  if (cooldown.withinCooldown(cooldownKey, cooldownMs)) return null
  cooldown.markFired(cooldownKey)

  // done 只收下发成功的开关（决定 interlocked）；changes 每个开关都收一段，拼进记录。
  const done = []
  const changes = []
  const locked = SINGLE_DEVICE_MODE ? isAnyLocked() : isLockedByFault(deviceNo)
  if (locked && (actions || []).length > 0) {
    console.warn(`[SafetyInterlock] ${rule.name}：系统处于故障锁定，跳过开关动作（只写记录），设备 ${deviceNo || '全局'}`)
  }
  // config.js 的 executeActions 没写 true：actions 一个都不下发（不发 MQTT、不改指令页面），只写记录和弹提示。
  const actionsOff = CONFIG.executeActions !== true
  if (!locked && actionsOff && (actions || []).length > 0) {
    console.warn(`[SafetyInterlock] ${rule.name}：executeActions 已关闭，跳过开关动作（只写记录），设备 ${deviceNo || '全局'}`)
  }
  for (const { prefix, value } of (locked || actionsOff) ? [] : (actions || [])) {
    const label = SWITCH_LABELS[prefix] || prefix
    try {
      const result = await setSwitch(prefix, label, value, deviceNo, 'interlock')
      if (result) {
        done.push(label)
        changes.push(formatSwitchChange(label, result.oldValue, value))
        console.log(`[SafetyInterlock] ${rule.name}：${label} -> ${value}，设备 ${deviceNo || '全局'}`)
      } else {
        // 指令页面上找不到这个开关（preffix 没配），跟下发抛异常一样记成失败。
        changes.push(`${label} 下发失败`)
      }
    } catch (err) {
      changes.push(`${label} 下发失败`)
      console.error(`[SafetyInterlock] ${label} -> ${value} 下发失败:`, err.message)
    }
  }

  // 配了动作就记成"安全联锁"，没配动作（actions 空）就是"只记录不动作"的安全告警。
  // 文案统一成"原因｜开关：调整前→调整后｜数据"三段，例：
  //   未开水泵却开启加热｜开关：水泵 关→关（未变），加热 开→关｜水泵=关，加热=开
  // 箭头左边是动作前指令页面上的开关状态，右边是本次下发的状态。
  const handled = (actions || []).length === 0
    ? '开关：未调整（仅记录）'
    : locked
      ? '开关：未调整（系统处于故障锁定，已跳过开关动作）'
      : actionsOff
        ? '开关：未调整（下发开关已关闭，只记录）'
        : `开关：${changes.join('，')}`
  await recordEvent({
    deviceNo,
    message: [rule.name, handled, detail].filter(Boolean).join('｜'),
    code: rule.id,
    type: (actions || []).length > 0 ? '安全联锁' : '安全告警',
  })

  const outcome = { id: rule.id, name: rule.name, detail: detail || '', interlocked: done.length > 0 }
  events.emit('safety', { ...outcome, deviceNo: deviceNo || null })
  return outcome
}

/**
 * 每条 MQTT 数据入库后调用，是本模块唯一的消息入口。
 * 先把这条消息能提供的现场数据整理成 s，再调 checkRules 逐条判，命中就 fire。
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

  // 水泵预热：跟故障状态机同一个做法、同一份预热时长（指令中心 pump_warmup_ms 优先，
  // 没配才用 FAULT_STATUS.pumpWarmupMs，两个都没有用 5000ms）。每条消息都要更新计时，
  // 不管流量规则开没开——否则规则中途打开时计时是断的。
  const pumpOnDurationMs = trackPumpOnDuration(deviceNo, states.pumpOn)
  const warmupMs = await getNumberValue('pump_warmup_ms', deviceNo, FAULT_CONFIG.pumpWarmupMs, 5000)
  const pumpWarmedUp = pumpOnDurationMs != null && pumpOnDurationMs >= warmupMs

  // 设备每条上报都带齐 SENSOR_FIELD_MAP 里的传感器字段是常态，缺了就说明那一路掉线。
  // 传感器和行为字段合并在同一条消息上报时，水泵/加热状态字段缺失同样算掉线；
  // 分主题上报时纯传感器消息本就不带行为字段，不参与这条判断，免得每条都误触发。
  const missingFields = Object.keys(SENSOR_FIELD_MAP || {}).filter((key) => sensors[key] == null)
  const topics = MQTT_TOPICS || {}
  if (topics.sensor && topics.sensor === topics.behavior) {
    if (states.pumpOn == null) missingFields.push('水泵状态')
    if (states.heatOn == null) missingFields.push('加热状态')
  }

  // 把现场数据打包成 s，给 checkRules 用
  const s = {
    flow: sensors.flow,
    pressure: sensors.pressure,
    temp1: sensors.temp1,
    temp2: sensors.temp2,
    tempDiff: getTempDiff(sensors),
    pumpOn: states.pumpOn,
    heatOn: states.heatOn,
    pumpOnDurationMs,
    pumpWarmedUp,
    flowVolatility: sensors.flow != null ? trackFlowVolatility(deviceNo, sensors.flow, pumpWarmedUp) : null,
    missingFields,
    modeJustToManual: mode === 'manual' && prevMode === 'auto',
    mode,
  }
  // ctx 封装读指令中心阈值的方法，赛场改阈值在网页上改，不用重启
  const ctx = {
    deviceNo,
    config: CONFIG,
    abnormalMax: getAbnormalMax(),
    threshold: (slot) => getThresholdValue(slot, deviceNo),
    number: (prefix, fallback, fallbackDefault) => getNumberValue(prefix, deviceNo, fallback, fallbackDefault),
  }

  // 调 checkRules 拿到本次命中的所有规则
  const triggers = await checkRules(s, ctx)

  const results = []
  for (const t of triggers) {
    const outcome = await fire({ id: t.id, name: t.name }, deviceNo, t.detail || '', t.actions || [])
    if (outcome) results.push(outcome)
  }

  if (results.length) {
    console.log(`[SafetyInterlock] 触发 ${results.length} 项安全联锁，设备 ${deviceNo || '全局'}，模式 ${mode}`)
  }
  return results
}

/* ============================ 掉线监测 ============================ */

/** 上面 evaluateSafety 靠"收到消息"驱动，但设备彻底掉线时根本没有消息进来，
 *  也就没人去调它。这里用独立定时器主动查每台设备的心跳，超时就调 checkRules(null)
 *  拿到掉线动作处理（跟"消息缺字段"共用同一份冷却）。 */
async function monitorOffline() {
  if (CONFIG.enabled !== true) return
  if (CONFIG.sensorOffline !== true) return

  let mqttClient
  try {
    mqttClient = require('../../mqtt')
  } catch (err) {
    return
  }
  for (const st of mqttClient.getAllDeviceStatus() || []) {
    if (!st.configured || st.online) continue
    const deviceNo = st.deviceNumber || st.deviceId
    // 定时器路径：没有消息数据 s，传 null 让 checkRules 返回掉线动作
    const triggers = await checkRules(null, { config: CONFIG })
    for (const t of triggers) {
      await fire({ id: t.id, name: t.name }, deviceNo, `设备 ${deviceNo} 心跳超时，无数据上报`, t.actions || [])
    }
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
