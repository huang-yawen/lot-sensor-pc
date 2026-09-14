/** 【文件职责】告警规则评估与自动联锁服务。每收到一条设备上报，逐条判断阈值告警
 *   规则，命中就写一条告警记录（t_error_msg），可选下发自动联锁指令，并 emit 一个
 *   'alarm' 事件供 app.js 转成 WebSocket 广播（alarm_triggered），前端 AlarmNotifier.vue
 *   订阅后弹出提示——这跟 faultStatus.js 的 onFault/fault_triggered 是完全对称的两套机制：
 *   那边是 5 种系统级硬故障（严重、低频、需要手动复位，用模态弹窗），这边是本页面自由配置
 *   的普通阈值规则（可能频繁触发、只是提示，不需要用户处理，所以用非阻塞通知）。
 * 故障状态触发后，指令页面锁定期间，自动联锁动作会被跳过（告警记录仍照常写入），
 * 避免绕过锁定改写 t_direct。
 *
 * ★★ 赛场上要改告警，改下面的 checkAlarms 函数就够了 ★★
 *   写法跟安全联锁 safetyInterlock.js 的 checkRules 一样：直接写 if 条件 + push，
 *   现场数据从 s 里读（s.temp1 / s.flow / s.pumpOn ...），阈值从 ctx.threshold('槽位') 读，
 *   要动的开关写进 actions 数组（可以同时放水泵和加热）。
 *
 * 整条链路：
 *   evaluateRules（每条消息）─→ 整理出 s 和 ctx ─→ checkAlarms(s, ctx) ─→ 命中的逐条 fire
 *   fire ─→ 冷却判断 ─→ 写告警记录 ─→ actions 里的开关逐个下发 ─→ 广播
 *
 * 【配置】六条规则的阈值是"指令页面优先、config.js 兜底"（跟 PID 恒温、定量停机、
 *   定温停机取参数同一套模式）：指令页面 t_direct 配了就用页面上的值，改完即时生效
 *   不用重启；指令项被删掉或没填值，才退回同目录 config.js 的兜底值。
 *   总开关 enabled、各规则开关、autoInterlockEnabled、cooldownMs 只在 config.js
 *   （跟安全联锁的逐条条件开关、联动的九条规则开关一致），改完要重启后端——
 *   指令页面上**没有**告警的开关项，config.js 里开了就能用。
 *   自动联锁下发指令用的 MQTT_QOS 见 config/mqtt.js。
 *
 * 【为什么没直接用安全联锁那几个共用函数】安全联锁读开关用 controlHelpers.readSwitchStates、
 *   下发用 controlHelpers.setSwitch，本文件结构照着它写，但开关状态和下发仍是自己的实现，
 *   因为有三处行为不一样，换过去会悄悄改变告警结果：
 *   ① 开关状态：本文件不去空格、没上报过算 false（" on " 算关）；readSwitchStates 先去空格
 *      （" on " 算开）、没上报过是 null。"流量过低"只在泵开着时判，换过去触发条件就变了。
 *   ② 下发：指令页面找不到这个开关、或者它不是开关类指令项时，本文件仍按 { 字段名: 线上值 }
 *      发 MQTT；setSwitch 这两种情况都直接不发。
 *   ③ 数据来源：本文件判的是跨消息累积的 latestState（传感器、行为分开上报也能凑齐），
 *      安全联锁只看当前这一条消息。 */

const promisePool = require('../../config/dbPool')
// 阈值告警自己的兜底开关和参数在这里（enabled / autoInterlockEnabled / 各规则开关 / 阈值）。
const CONFIG = require('./config')
// SENSOR_FIELD_MAP：哪个 field 是温度1/温度2/流量/压力。规则里不写死 'field2'，
// 跟着这份槽位配置走，赛场换字段只改 config/appSettings.js 一处。
const { SINGLE_DEVICE_MODE, SENSOR_FIELD_MAP } = require('../../config/appSettings')
const { MQTT_QOS } = require('../../config/mqtt')
const EventEmitter = require('events')
const { firstValue, getTopic, toWireValue, buildSwitchPayload } = require('../../utils/protocol')
const { resolveDeviceNo, resolveFieldAliases } = require('../../utils/mappedData')
const { saveDirectData, getDirectValue } = require('../directData/saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory')
const { formatLocalDateTime } = require('../../utils/helper')
const { isLockedByFault, isAnyLocked } = require('../faultStatus/faultStatus')
// 六个阈值槽位（temp_high / temp_low / flow_low / flow_high / pressure_low / pressure_high）
// 从指令页面 t_direct 实时读，统一走 controlShared 这一份，跟安全联锁、故障机、联动同源。
const { getThresholdValue } = require('../controlShared/controlHelpers')

// ========== 赛场速改索引（要改什么 → 去哪） ==========
//  关掉阈值告警      config.js enabled=false（指令页面上没有告警开关，就看这一处）
//  改阈值           指令页面对应指令项（即时生效，不用重启）：
//                   温度上限 temp_high    温度下限 temp_low
//                   流量上限 flow_high    流量下限 flow_low
//                   压力上限 pressure_high 压力下限 pressure_low
//                   指令项删掉/没填值，才退回 config.js 的 xxxThreshold 兜底
//  ★ 这六个槽位跟安全联锁、故障状态机、联动规则是同一份值，在页面上调一个，那几处
//    的判定会跟着一起变。要让告警用独立阈值，就把 evaluateRules 里 readThreshold 的
//    第一个参数换成告警专属的 preffix（记得先在 t_direct_config 里建好指令项）。
//  开/关自动联锁动作 config.js autoInterlockEnabled（开前必须实机测试）
//  临时停某条规则   config.js 对应规则开关 = false（temperatureHigh / temperatureLow /
//                   flowHigh / flowLow / pressureHigh / pressureLow）
//  某条规则要同时关水泵和加热  checkAlarms 里那条规则的 actions 写两项：
//                   actions: [{ prefix: 'pump', value: 'off' }, { prefix: 'heater', value: 'off' }]
//  换温度/流量/压力是哪个字段  config/appSettings.js 的 SENSOR_FIELD_MAP
//  加/改判定逻辑     下面 checkAlarms 函数（直接写 if + push）
// ===================================================

/** 每个设备+规则最近一次触发的时间，用来做冷却判断（同 key 短时间内只触发一次）。 */
const lastTriggered = new Map()
/** 每个设备最近看到过的完整字段快照，跨消息累积合并（不是每次替换）。
 * 用途：一条规则可能要求"字段 A 满足前置条件才检查字段 B"，但 A、B 不一定
 * 出现在同一条 MQTT 消息里（比如分开上报模式下，一条是传感器消息一条是
 * 行为消息）——latestState 把历史上收到过的所有字段值都合并存一份，
 * requirementMet 判断前置条件时不会因为"这条消息恰好没带那个字段"就误判
 * 条件不满足。 */
const latestState = new Map()
/** 告警事件总线，跟 faultStatus.js 里 fault 事件的用法一致，见文件底部 onAlarm。 */
const events = new EventEmitter()

/**
 * 取一条规则（或它的 require 前置条件）要监控的物理字段候选名。
 * 优先用 source_table + source_field 从字段映射表动态解析——跟 CUMULATIVE_METRICS/
 * TIME_WINDOW_METRICS 认字段槽位的方式一致，字段映射表改了物理名会自动跟着变，不用
 * 同步改这里；仍兼容旧规则里直接写死的 field 别名数组。
 */
async function resolveFieldNames(spec) {
  if (!spec) return []
  if (spec.source_table && spec.source_field) {
    return resolveFieldAliases(spec.source_table, spec.source_field)
  }
  if (Array.isArray(spec.field)) return spec.field
  return spec.field ? [spec.field] : []
}

/**
 * 判断一条规则的前置条件（require）是否满足：前置条件本身也是"某个字段的值
 * 要落在允许的列表里"，没配置前置条件（requirement 为 null/undefined）视为
 * 直接满足，不用额外检查。
 */
async function requirementMet(info, requirement) {
  if (!requirement) return true
  const candidates = await resolveFieldNames(requirement)
  const actual = firstValue(info, candidates)
  return (requirement.values || []).some(value => String(value).toLowerCase() === String(actual).toLowerCase())
}

/**
 * 读一个阈值，两层兜底，跟 PID 的 Kp/Ki/Kd、定量停机的目标流量是同一套取法：
 *   1) 指令页面 t_direct 里这个槽位的当前值——现场在网页上改，改完即时生效不用重启；
 *   2) 指令项被删掉、或者从没填过值时，退回 config.js 里的兜底值。
 * 两层都没有有效数值就返回 null，对应那条规则本轮整条跳过。这里绝不能返回 NaN：
 * `NaN > 阈值` 永远是 false，规则会看起来在跑、实际悄悄失效，最难排查。
 * @param {string} slot - controlHelpers 里 THRESHOLD_SLOTS 的槽位名（tempHigh/flowLow/...）
 * @param {*} fallback - config.js 里对应的兜底值
 * @param {string|null} deviceNo - 设备号，指令项支持按设备单独配置
 * @returns {Promise<number|null>}
 */
async function readThreshold(slot, fallback, deviceNo) {
  const fromDirect = await getThresholdValue(slot, deviceNo)
  if (fromDirect != null) return fromDirect
  const fb = Number(fallback)
  return Number.isFinite(fb) ? fb : null
}

/* ============================================================
 * ★★★ 赛场改这里：阈值告警的判定规则 ★★★
 * ============================================================
 * 一个规则命中后 push 一条：{ id, name, actual, threshold, message, actions }
 *   id        规则编号（也作告警记录里的 e_no）
 *   name      规则名称（写进 t_error_msg 的 type 字段）
 *   actual    当前实际值
 *   threshold 本轮实际生效的阈值（指令页面优先、config.js 兜底）
 *   message   告警描述（写进 t_error_msg 的 e_msg 字段）
 *   actions   自动联锁要下发的开关数组，每个 { prefix, value }，跟安全联锁同一种写法：
 *             [{ prefix: 'pump', value: 'off' }, { prefix: 'heater', value: 'off' }]  两个都关
 *             [{ prefix: 'heater', value: 'off' }]   只关加热
 *             [{ prefix: 'pump', value: 'on' }]      也可以是"开"
 *             []                                       只记录，不动执行器
 *             prefix 是指令中心里的开关 preffix（pump / heater / ...）。
 *             只有 config.js autoInterlockEnabled=true 时才实际下发。
 * 没命中不 push。返回本次命中的所有 trigger，由下面 fire 统一处理
 * （冷却/写记录/联锁/广播）。
 *
 * 参数说明：
 *   s —— 这个设备跨消息累积后的现场数据（见 evaluateRules 里 latestState 的说明）：
 *     s.temp1     进水温度          s.temp2     出水温度
 *     s.flow      流量              s.pressure  压力
 *       四路读数读不出数值（字段没上报 / 空值 / 不是数字）统一是 null，
 *       规则里用 `== null` 跳过，不能拿 NaN 去比阈值。
 *     s.pumpOn    水泵开着吗（true / false）
 *     s.heatOn    加热开着吗（true / false）
 *       注意跟安全联锁的 s.pumpOn 不一样：这里没上报过就是 false，不是 null。
 *
 *   ctx —— 读阈值等参数：
 *     ctx.threshold('tempHigh')   阈值，指令页面优先、config.js 兜底，都没有是 null
 *          可用槽位：tempHigh tempLow flowHigh flowLow pressureHigh pressureLow
 *     ctx.deviceNo                当前设备号（null = 全局/单设备）
 *     ctx.config                  就是 config.js 这个对象
 *
 * 六条规则，三对上下限：温度过高/过低、流量过高/过低、压力过高/过低。
 * 每条都是独立的 if 块，删一条就整块删掉，加一条照着抄一块改改就行。
 * ============================================================ */
async function checkAlarms(s, ctx) {
  const triggers = []

  // ── 规则1：温度过高 ──
  // 进水、出水两路任意一路超上限就报，跟安全联锁"任一温度高于上限"同一个口径。
  // 报一条就 break：两路都超限时重复报同一个 id 没意义，冷却也会把第二条挡掉。
  if (CONFIG.temperatureHigh !== false) {
    const tempHigh = ctx.threshold('tempHigh')
    for (const [actual, label] of [[s.temp1, '进水温度'], [s.temp2, '出水温度']]) {
      if (actual == null || tempHigh == null || actual <= tempHigh) continue
      triggers.push({
        id: 'temperature_high',
        name: '温度过高',
        actual,
        threshold: tempHigh,
        message: `${label} ${actual} > 上限 ${tempHigh}`,
        actions: [{ prefix: 'heater', value: 'off' }],
      })
      break
    }
  }

  // ── 规则2：温度过低 ──
  // 动作留空（actions: []）= 只记录不动手。温度低的正确动作是"开加热"，但开加热前
  // 必须先确认水泵在转，否则就是干烧；这个前后顺序由联动规则 / PID 恒温统一管，
  // 告警这边不越权去开执行器，只负责把"温度掉下去了"提示出来。
  if (CONFIG.temperatureLow !== false) {
    const tempLow = ctx.threshold('tempLow')
    for (const [actual, label] of [[s.temp1, '进水温度'], [s.temp2, '出水温度']]) {
      if (actual == null || tempLow == null || actual >= tempLow) continue
      triggers.push({
        id: 'temperature_low',
        name: '温度过低',
        actual,
        threshold: tempLow,
        message: `${label} ${actual} < 下限 ${tempLow}`,
        actions: [],
      })
      break
    }
  }

  // ── 规则3：循环流量过高 ──
  // 流量冲过上限通常是泵开得太猛，或者管路漏了阻力变小，先把泵关掉。
  if (CONFIG.flowHigh !== false) {
    const flowHigh = ctx.threshold('flowHigh')
    if (s.flow != null && flowHigh != null && s.flow > flowHigh) {
      triggers.push({
        id: 'flow_high',
        name: '循环流量过高',
        actual: s.flow,
        threshold: flowHigh,
        message: `流量 ${s.flow} > 上限 ${flowHigh}`,
        actions: [{ prefix: 'pump', value: 'off' }],
      })
    }
  }

  // ── 规则4：循环流量过低 ──
  // 只有水泵处于开启状态时，低流量才属于异常（避免水泵正常关闭时误报）。
  if (CONFIG.flowLow !== false && s.pumpOn) {
    const flowLow = ctx.threshold('flowLow')
    if (s.flow != null && flowLow != null && s.flow < flowLow) {
      triggers.push({
        id: 'flow_low',
        name: '循环流量过低',
        actual: s.flow,
        threshold: flowLow,
        message: `流量 ${s.flow} < 下限 ${flowLow}`,
        actions: [{ prefix: 'heater', value: 'off' }],
      })
    }
  }

  // ── 规则5：管路压力过高 ──
  if (CONFIG.pressureHigh !== false) {
    const pressureHigh = ctx.threshold('pressureHigh')
    if (s.pressure != null && pressureHigh != null && s.pressure > pressureHigh) {
      triggers.push({
        id: 'pressure_high',
        name: '管路压力过高',
        actual: s.pressure,
        threshold: pressureHigh,
        message: `压力 ${s.pressure} > 上限 ${pressureHigh}`,
        actions: [{ prefix: 'pump', value: 'off' }],
      })
    }
  }

  // ── 规则6：管路压力过低 ──
  // 同样只在泵开着时判。动作留空（actions: []）= 只记录不动手：压力低可能是漏水，
  // 也可能只是泵没使上劲，这两种情况该做的事相反（前者要停、后者要加压），
  // 光看压力一个值分不出来，真正的漏水判定交给故障状态机⑥，这里只提示。
  // 泵关着时管路压力天然接近 0，不加 s.pumpOn 会一停泵就刷一条"压力过低"。
  if (CONFIG.pressureLow !== false && s.pumpOn) {
    const pressureLow = ctx.threshold('pressureLow')
    if (s.pressure != null && pressureLow != null && s.pressure < pressureLow) {
      triggers.push({
        id: 'pressure_low',
        name: '管路压力过低',
        actual: s.pressure,
        threshold: pressureLow,
        message: `压力 ${s.pressure} < 下限 ${pressureLow}`,
        actions: [],
      })
    }
  }

  return triggers
}

/**
 * 下发 actions 里的一个开关。每个开关单独调一次，一个失败不影响下一个（fire 里逐个 try/catch）。
 * 返回 { prefix, value, success: true, payload, history }，失败时抛异常由 fire 接住。
 *
 * 指令页面找不到这个 preffix 时不报错，仍按 { [preffix]: 线上值 } 发一条 MQTT，
 * 只是不改 t_direct 显示值——这是告警联锁原有的行为，跟 setSwitch"找不到就不发"不同，保持不变。
 */
async function sendAction(action, deviceNo) {
  const targetDevice = deviceNo === 'default' ? null : deviceNo
  const mqttClient = require('../../mqtt')
  const [[directConfig]] = await promisePool.query(
    'SELECT id, t_name, f_type, preffix, wire_template, wire_on_payload, wire_off_payload FROM t_direct_config WHERE LOWER(preffix) = LOWER(?) LIMIT 1',
    [action.prefix]
  )
  // 开关类联锁目标配置了 wire_template（如 Modbus 透传）时用整份报文下发，
  // 否则退回 { [字段名]: 线上值 }，跟手动下发和离线补发保持同一套逻辑。
  const payload = directConfig && String(directConfig.f_type) === '1'
    ? buildSwitchPayload(directConfig, action.value)
    : { [action.prefix]: toWireValue(action.value) }
  if (!SINGLE_DEVICE_MODE && deviceNo !== 'default') payload.d_no = deviceNo
  const oldValue = directConfig
    ? await getDirectValue({ config_id: directConfig.id, d_no: targetDevice })
    : null
  await mqttClient.publish(getTopic('control'), payload, { qos: MQTT_QOS })
  if (directConfig) {
    await saveDirectData({ config_id: directConfig.id, value: action.value, d_no: targetDevice })
  }
  const historyResult = await saveOperationHistory({
    d_no: targetDevice,
    config_id: directConfig?.id ?? null,
    old_value: oldValue,
    new_value: action.value,
    source: 'interlock'
  })
  return { prefix: action.prefix, value: action.value, success: true, payload, history: historyResult }
}

/* ============================================================
 * 一条规则命中之后要做的全部事情：冷却判断 → 写告警记录 → 自动联锁下发 → 广播。
 * 冷却期内直接返回 null，不重复记录也不重复下发。
 * actions 里写了几个开关就下发几个，按数组顺序一个一个来，每个单独 try/catch，
 * 一个失败不影响另一个（跟安全联锁 fire 同样的处理）。
 * 故障状态触发后，指令页面（含所有开关和参数）会被锁定为只读，故障前状态由
 * 快照保护、等用户手动复位后才恢复。这里的自动联锁跟前端提交走的是不同代码
 * 路径（直接调用 saveDirectData，不经过 HTTP 接口的锁定拦截），如果不额外检查
 * 会绕过锁定直接改写 t_direct，打破"故障期间页面显示保持故障前状态"这个约定。
 * 单设备模式下用 isAnyLocked()（避免设备号映射不一致导致查不到故障态），
 * 多设备模式下按 targetDevice 精确匹配，跟 updateDirectConfigAndPublish.js 同一套判断。
 * ============================================================ */
async function fire(trigger, deviceNo, state) {
  const cooldownKey = `${deviceNo}:${trigger.id}`
  const cooldownMs = Number(CONFIG.cooldownMs) || 30000
  if (Date.now() - (lastTriggered.get(cooldownKey) || 0) < cooldownMs) return null
  lastTriggered.set(cooldownKey, Date.now())

  // state.c_time 为设备上报时间（已本地格式化）；若为空则使用本地服务器时间，避免 UTC 时差
  const recordTime = formatLocalDateTime(state.c_time) || formatLocalDateTime(new Date())
  await promisePool.execute(
    'INSERT INTO t_error_msg (d_no, c_time, e_msg, e_no, type) VALUES (?, ?, ?, ?, ?)',
    [deviceNo === 'default' ? null : deviceNo, recordTime, trigger.message, trigger.id, trigger.name]
  )

  // interlock：没打算下发（autoInterlockEnabled 关着 / actions 为空）是 null；
  // 打算下发时是数组，actions 里每个开关一项 { prefix, value, success, payload?, history?, error? }。
  // prefix 为空的项直接忽略，跟原来 action 没写 field 就不下发一致。
  const actions = (trigger.actions || []).filter(action => action?.prefix)
  let interlock = null
  if (CONFIG.autoInterlockEnabled && actions.length > 0) {
    const targetDevice = deviceNo === 'default' ? null : deviceNo
    const locked = SINGLE_DEVICE_MODE ? isAnyLocked() : isLockedByFault(targetDevice)
    if (locked) {
      console.warn(`[Alarm] 联锁动作被故障锁定跳过 (${trigger.id})，设备=${targetDevice || '全局'}`)
      interlock = actions.map(action => ({
        prefix: action.prefix,
        value: action.value,
        success: false,
        error: '系统处于故障态，指令页面已锁定，跳过自动联锁动作',
      }))
    } else {
      interlock = []
      for (const action of actions) {
        try {
          interlock.push(await sendAction(action, deviceNo))
        } catch (error) {
          interlock.push({ prefix: action.prefix, value: action.value, success: false, error: error.message })
          console.error(`[Alarm] 联锁动作失败 (${trigger.id}，${action.prefix} -> ${action.value}):`, error.message)
        }
      }
    }
  }

  const alarm = {
    id: trigger.id,
    name: trigger.name,
    actual: trigger.actual,
    threshold: trigger.threshold,
    message: trigger.message,
    interlock,
    deviceNo: deviceNo === 'default' ? null : deviceNo,
  }
  // 立即广播，不等这条 MQTT 消息处理完（app.js 里的 onAlarm 会转成 WebSocket
  // 推给前端），跟故障触发的实时性要求一致：告警的意义就在于"马上让人看到"。
  events.emit('alarm', alarm)
  return alarm
}

/**
 * 每条 MQTT 数据入库后调用，是本模块唯一的消息入口。
 * 先把这条消息并进历史快照，整理成 s 和 ctx，再调 checkAlarms 逐条判，
 * 命中的规则交给 fire 处理（冷却/写库/联锁/广播）。
 * @param {Object} info - 已解析的设备上报数据
 * @returns {Promise<Array>} 本次命中的告警列表
 */
async function evaluateRules(info) {
  // 总开关只看 config.js，指令页面上没有对应的开关项：告警在这里一关就整个不跑，
  // 也就不用为每条上报去查一次数据库。开着的时候才往下走，具体阈值再读指令页面。
  if (!CONFIG.enabled) return []

  const deviceNo = String((await resolveDeviceNo(info)) || 'default')
  // 'default' 只是 latestState/冷却 Map 内部代表"设备号为空"的 key 名，不是真实设备号。
  // 查指令页面、写库都要传 null（代表全局/单设备），别把字符串 'default' 传下去。
  const directDeviceNo = deviceNo === 'default' ? null : deviceNo

  // 把这条消息合并进历史快照：同一条规则可能要同时看传感器字段和行为字段，
  // 而它们不一定在同一条消息里上报，靠 latestState 跨消息累积。
  const state = { ...(latestState.get(deviceNo) || {}), ...info }
  latestState.set(deviceNo, state)

  // 四路传感器读数。读不出数值（字段没上报 / 空值 / 不是数字）统一是 null，规则里用
  // `== null` 跳过，不能拿 NaN 去比阈值——NaN 跟谁比都是 false，规则会看起来在跑、实际悄悄失效。
  // 空字符串必须在 Number() 之前挡掉：Number('') 是 0 不是 NaN，漏掉这一步的话，
  // 某一路传感器上报空值就会被当成"读数=0"，直接误报一条温度过低/压力过低。
  const readSensor = async (slot) => {
    const candidates = await resolveFieldNames({ source_table: 't_sensor_data', source_field: SENSOR_FIELD_MAP[slot] })
    const raw = firstValue(state, candidates)
    if (raw == null || String(raw).trim() === '') return null
    const num = Number(raw)
    return Number.isFinite(num) ? num : null
  }
  // 水泵 / 加热开着吗（行为数据 field1=水泵，field2=加热）。认 open/on/1/true，其它值和没上报过都是 false。
  const readSwitch = (sourceField) => requirementMet(state, {
    source_table: 't_behavior_data', source_field: sourceField, values: ['open', 'on', 1, true],
  })

  // 读数、开关状态、六个阈值全部并发查完，不要一个一个串行查，
  // 免得每条上报都被十几次数据库往返拖慢。
  // 阈值：指令页面 t_direct 优先，指令项没配/没填值才退回 config.js。
  const [temp1, temp2, flow, pressure, pumpOn, heatOn,
    tempHigh, tempLow, flowHigh, flowLow, pressureHigh, pressureLow] = await Promise.all([
    readSensor('temp1'), readSensor('temp2'), readSensor('flow'), readSensor('pressure'),
    readSwitch('field1'), readSwitch('field2'),
    readThreshold('tempHigh', CONFIG.temperatureHighThreshold, directDeviceNo),
    readThreshold('tempLow', CONFIG.temperatureLowThreshold, directDeviceNo),
    readThreshold('flowHigh', CONFIG.flowHighThreshold, directDeviceNo),
    readThreshold('flowLow', CONFIG.flowLowThreshold, directDeviceNo),
    readThreshold('pressureHigh', CONFIG.pressureHighThreshold, directDeviceNo),
    readThreshold('pressureLow', CONFIG.pressureLowThreshold, directDeviceNo),
  ])

  // 把现场数据打包成 s，给 checkAlarms 用（字段含义见 checkAlarms 上方注释）
  const s = { temp1, temp2, flow, pressure, pumpOn, heatOn }
  // ctx：阈值已经在上面并发取好，规则里 ctx.threshold('槽位') 直接拿，不再查库
  const thresholds = { tempHigh, tempLow, flowHigh, flowLow, pressureHigh, pressureLow }
  const ctx = {
    deviceNo: directDeviceNo,
    config: CONFIG,
    threshold: (slot) => (slot in thresholds ? thresholds[slot] : null),
  }

  const triggers = await checkAlarms(s, ctx)
  const alarms = []
  for (const t of triggers) {
    const alarm = await fire(t, deviceNo, state)
    if (alarm) alarms.push(alarm)
  }
  return alarms
}

module.exports = {
  evaluateRules,
  onAlarm: (listener) => events.on('alarm', listener),
}
