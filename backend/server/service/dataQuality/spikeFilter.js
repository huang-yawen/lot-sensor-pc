/**
 * 【文件职责】数据质量板块：传感器数值跳变/毛刺的检测、防抖过滤与轻微告警。
 * 与「安全联锁」（safety/）「故障状态」（faultStatus/）平级的独立板块——独立总开关、
 * 独立配置（同目录 config.js）、独立告警类型（t_error_msg 里 type='数据质量'）、
 * 独立事件总线（onSpike -> app.js 转 WebSocket 'spike_triggered' -> 前端弹黄色提示）。
 *
 * 【解决什么问题】传感器受电磁干扰、接触不良、瞬间短路时，读数会在一个采集周期内突然
 * 跳到离谱的值（比如 0.1 秒内水温从 45℃ 跳到 90℃），下一条又跳回来。这种"毛刺"直接
 * 入库的后果：①历史曲线上出现一根尖刺，把 y 轴量程撑大，正常波动被压成一条直线；
 * ②派生指标（温度变化率、加热速度、换热效率）跟着乱跳；③阈值告警被误触发。
 *
 * 【判定口径】跳变 = |本次值 − 上次已确认值| / |上次已确认值| > ratio（默认 0.5，即 ±50%）。
 * 上次已确认值的绝对值小于 minBase 时**不判**——比例在 0 附近没有物理意义（0.1 → 0.2
 * 是 +100%，实际只差 0.1），而且上次值为 0 时除法直接是 Infinity。
 *
 * 【怎么处置】不是检测到就丢弃，而是"连续 confirmCount 次确认"：
 *   1. 检测到跳变 -> 这一条**不入库**，放进内存缓冲区，同时发一条轻微告警（黄色提示）。
 *   2. 后续每条消息都跟缓冲区第一条（可疑新水位）比：
 *      · 一直稳定在新水位 -> 攒够 confirmCount 条 -> 判定是真实阶跃（比如真开了加热、
 *        真关了水泵），把缓冲的这几条按原顺序补写进库，一条不丢、时间戳不变。
 *      · 中途又跳回去了 -> 判定缓冲的那几条是毛刺，整批丢弃，永不入库。
 *   3. 缓冲区滞留超过 maxPendingMs（设备停发/采集变慢）-> 强制放行补写，
 *      避免数据永久卡在内存里。
 * 所以真实阶跃只是**延迟 confirmCount 个采集周期入库**，不会丢数据；只有真毛刺才被丢弃。
 *
 * 【副作用边界】本板块只管"要不要写 t_sensor_data"。告警规则、安全联锁、故障状态机、
 * PID、联动这些下游评估仍然拿到原始值——它们各自有滤波/冷却/持续时长判定，不能因为
 * 数据质量板块缓冲了几条就停摆：真烧干时温度飙升同样会被判成跳变，这时候干烧保护必须
 * 照常工作，不能等 3 条确认完再动手。
 *
 * 【前端曲线图为什么不用再改】毛刺根本没进 t_sensor_data，实时页和历史图表都是从库里
 * 查数据画图，自然就不会显示这个点，不需要在图表组件里再做一次剔除。
 */

// ========== 赛场速改索引（要改什么 -> 去哪） ==========
//  只关毛刺过滤这一条  config.js spikeFilter.enabled=false（规则二、三照常）
//  关掉整个板块        config.js enabled=false（三条规则全关）
//  改 ±50% 这个比例    config.js spikeFilter.ratio
//  改"连续几次确认"    config.js spikeFilter.confirmCount
//  某个字段不监控      config.js spikeFilter.fields.<temp1|temp2|flow|pressure>=false
//  零点附近误判太多    config.js spikeFilter.minBase 调大
//  跳变判定逻辑        detectJumps() 约 L80
//  缓冲/确认/丢弃流程  evaluateSpikeFilter() 约 L120
// ===================================================
const EventEmitter = require('events')
// 本板块自己的开关和参数都在这里：CONFIG.enabled 是板块总开关，
// 本规则的开关和比例、确认次数、逐字段开关等在 CONFIG.spikeFilter 子对象里
// （跟 relayStuck.js、sensorInverted.js 各读自己那个子对象是同一个结构）。
const CONFIG = require('./config')
const RULE = CONFIG.spikeFilter
// 读传感器语义槽位、解析设备号——统一走 controlShared，跟安全联锁/故障机同一份实现。
const { readSensors, resolveDeviceNoStr } = require('../controlShared/controlHelpers')
const { createCooldown } = require('../controlShared/cooldown')
const { recordEvent } = require('../controlShared/recordEvent')
const { formatLocalDateTime } = require('../../utils/helper')

/** 写进 t_error_msg 的 type，"故障记录"页按它把本板块的记录归到"数据质量记录"表格。 */
const ERROR_TYPE = '数据质量'

/**
 * 本板块的告警类型清单。id 写进 t_error_msg.e_no，name 供"故障记录"页显示
 * （errorHistory.js 直接引用这张表，不再重抄一份中文名）。
 * key 对应 SENSOR_FIELD_MAP 的语义槽位，也就是 controlHelpers.readSensors() 的返回键。
 * unit 只用于拼告警文案，不参与任何计算。
 */
const SPIKE_TYPES = [
  { id: 'spike_temp1', key: 'temp1', name: '进水温度跳变（疑似毛刺）', unit: '℃' },
  { id: 'spike_temp2', key: 'temp2', name: '出水温度跳变（疑似毛刺）', unit: '℃' },
  { id: 'spike_flow', key: 'flow', name: '瞬时流量跳变（疑似毛刺）', unit: 'L/min' },
  { id: 'spike_pressure', key: 'pressure', name: '瞬时压力跳变（疑似毛刺）', unit: 'kPa' },
]

/** 每个设备的滚动状态：lastAccepted 是上一批已确认入库的读数（判定的参照系），
 * pending 是还没确认、暂不入库的缓冲区（[{ info, values, atMs }]，按到达顺序）。 */
const stateMap = new Map()
/** 告警冷却：跟安全联锁、故障状态机同一份实现，各自持有独立计时状态。 */
const cooldown = createCooldown()
/** 跳变事件总线，用法跟 evaluateRules.js 的 onAlarm、faultStatus.js 的 onFault 一致。 */
const events = new EventEmitter()

function getState(deviceNo) {
  if (!stateMap.has(deviceNo)) stateMap.set(deviceNo, { lastAccepted: null, pending: [] })
  return stateMap.get(deviceNo)
}

/** 当前启用监控的字段（config.js fields 里没显式写 false 的都算启用）。 */
function monitoredTypes() {
  return SPIKE_TYPES.filter(type => RULE.fields?.[type.key] !== false)
}

/**
 * 逐字段比较两组读数，返回发生跳变的字段列表。
 * @param {Object} base    参照读数（上次已确认值，或缓冲区第一条的可疑新水位）
 * @param {Object} current 本次读数
 * @returns {Array} [{ type, prev, now, delta }]，delta 是变化比例（0.5 = 50%）
 *
 * 跳过判定的三种情况：①这一条没带这个字段（now 为 null）；②参照系里还没有这个字段
 * （prev 为 null，比如刚启动）；③参照值太接近 0（见 config.js minBase 的说明）。
 */
function detectJumps(base, current) {
  const jumps = []
  for (const type of monitoredTypes()) {
    const prev = base?.[type.key]
    const now = current?.[type.key]
    if (prev == null || now == null) continue
    if (Math.abs(prev) < RULE.minBase) continue
    const delta = Math.abs(now - prev) / Math.abs(prev)
    if (delta > RULE.ratio) jumps.push({ type, prev, now, delta })
  }
  return jumps
}

/**
 * 把本次读数并进参照系。只覆盖本次真的带了值的字段——纯传感器消息和合并上报消息
 * 带的字段可能不一样，直接整个替换会把没带的字段清成 null，下一条就失去参照、
 * 判不出跳变了。
 */
function mergeAccepted(base, values) {
  const merged = { ...(base || {}) }
  for (const [key, value] of Object.entries(values)) {
    if (value != null) merged[key] = value
  }
  return merged
}

/**
 * 写告警记录 + 广播事件。同一个字段在 alarmCooldownMs 内只记一次，避免持续跳变时
 * 把"故障记录"页刷屏（过滤本身不受冷却影响，照常拦截）。
 */
async function recordSpikes(deviceNo, jumps, info) {
  const triggers = []
  for (const jump of jumps) {
    const key = `${deviceNo || 'global'}:${jump.type.id}`
    if (cooldown.withinCooldown(key, RULE.alarmCooldownMs)) continue
    cooldown.markFired(key)
    const percent = Number((jump.delta * 100).toFixed(1))
    // 文案统一成"原因｜处置｜数据"三段
    const message = `${jump.type.name}｜已暂缓入库，待连续 ${RULE.confirmCount} 次确认`
      + `｜${jump.prev}${jump.type.unit} → ${jump.now}${jump.type.unit}，变化 ${percent}%（限 ±${RULE.ratio * 100}%）`
    await recordEvent({
      deviceNo,
      message,
      code: jump.type.id,
      type: ERROR_TYPE,
      // 用设备上报时间，跟这条被拦下的数据对得上；取不到再退回服务器本地时间。
      time: formatLocalDateTime(info.c_time) || undefined,
    })
    const trigger = {
      id: jump.type.id,
      name: jump.type.name,
      prev: jump.prev,
      now: jump.now,
      percent,
      message,
      deviceNo: deviceNo || null,
    }
    triggers.push(trigger)
    // 立即广播，不等这条 MQTT 消息处理完，跟告警/故障两块的实时性要求一致。
    events.emit('spike', trigger)
  }
  return triggers
}

/**
 * 评估一条上报消息，决定这一轮到底该往 t_sensor_data 写哪几条。
 * 调用方（mqtt handler）只需要照着返回的 flush 依次 saveSensorData 即可。
 *
 * @param {Object} info 已解析并补好 c_time 的上报数据
 * @returns {Promise<{flush: Array, blocked: boolean, triggers: Array}>}
 *   flush    - 本轮真正要落库的数据行，按原始到达顺序。正常情况就是 [info]；
 *              确认阶跃时是缓冲的 confirmCount 条；本条被拦下时是空数组。
 *   blocked  - 当前这条是不是被拦下了（没进 flush）。仅供调用方打日志/调试。
 *   triggers - 本次新产生的跳变告警（已过冷却），供调用方挂到 info 上。
 */
async function evaluateSpikeFilter(info) {
  // 板块总开关或本规则开关任一关着：原样放行入库，不检测、不缓冲、不告警。
  if (!CONFIG.enabled || !RULE?.enabled) return { flush: [info], blocked: false, triggers: [] }

  const deviceNo = await resolveDeviceNoStr(info)
  const state = getState(deviceNo || 'global')
  const values = await readSensors(info)
  const nowMs = Date.now()
  const flush = []

  // ① 缓冲区里已经攒着待确认的数据：本条的作用是裁决"那个可疑新水位站不站得住"。
  if (state.pending.length) {
    const head = state.pending[0]
    if (nowMs - head.atMs >= RULE.maxPendingMs) {
      // 超时兜底：设备停发或采集间隔突然变长，不能让这几条永远卡在内存里不入库。
      flush.push(...state.pending.map(item => item.info))
      state.lastAccepted = mergeAccepted(state.lastAccepted, state.pending[state.pending.length - 1].values)
      console.warn(`[SpikeFilter] 缓冲超时，放行 ${state.pending.length} 条待确认数据（设备=${deviceNo || '全局'}）`)
      state.pending = []
      // 参照系已经换成刚放行的那批，本条继续走下面 ② 的常规判定。
    } else if (detectJumps(head.values, values).length === 0) {
      // 本条稳定在新水位上，攒进缓冲区。
      state.pending.push({ info, values, atMs: nowMs })
      if (state.pending.length < RULE.confirmCount) {
        return { flush: [], blocked: true, triggers: [] }
      }
      // 攒够 confirmCount 条：判定是真实阶跃，按原顺序补写，一条不丢。
      const confirmed = state.pending.map(item => item.info)
      state.lastAccepted = mergeAccepted(state.lastAccepted, values)
      state.pending = []
      console.log(`[SpikeFilter] 连续 ${confirmed.length} 次确认为真实变化，补写入库（设备=${deviceNo || '全局'}）`)
      return { flush: confirmed, blocked: false, triggers: [] }
    } else {
      // 本条又跳回去了：缓冲的那几条判定为毛刺，整批丢弃，永不入库。
      console.warn(`[SpikeFilter] 判定为毛刺，丢弃 ${state.pending.length} 条不入库（设备=${deviceNo || '全局'}）`)
      state.pending = []
      // 参照系保持不变（还是毛刺发生之前的值），本条继续走下面 ② 的常规判定。
    }
  }

  // ② 常规判定：跟上一批已确认入库的读数比。
  if (!state.lastAccepted) {
    // 后端刚启动、这个设备的第一条数据，没有参照系，只能先收下当基准。
    state.lastAccepted = mergeAccepted(null, values)
    flush.push(info)
    return { flush, blocked: false, triggers: [] }
  }

  const jumps = detectJumps(state.lastAccepted, values)
  if (!jumps.length) {
    state.lastAccepted = mergeAccepted(state.lastAccepted, values)
    flush.push(info)
    return { flush, blocked: false, triggers: [] }
  }

  // 检测到跳变：本条不入库，进缓冲区等后续确认，同时发一条轻微告警。
  state.pending = [{ info, values, atMs: nowMs }]
  const triggers = await recordSpikes(deviceNo, jumps, info)
  return { flush, blocked: true, triggers }
}

module.exports = {
  evaluateSpikeFilter,
  onSpike: (listener) => events.on('spike', listener),
  SPIKE_TYPES,
  ERROR_TYPE,
}
