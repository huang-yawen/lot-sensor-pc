/**
 * 【文件职责】数据质量板块的规则二：继电器触点粘连 / 控制失效检测与自动恢复。
 * 跟同目录 spikeFilter.js（规则一：数值跳变/毛刺）同属"数据质量"板块，
 * 共用同一份 config.js、同一个 t_error_msg 里的 type='数据质量'、同一张记录表格。
 *
 * 【解决什么问题】继电器触点粘连、驱动电路损坏、控制线脱落时，系统下发了"关闭"，
 * 指令中心 t_direct 里也确实记成了"关"，页面上看开关是关的——但硬件其实一直通着电。
 * 这种故障只看"指令"和"设备上报的开关状态"都发现不了（两边都说是关的），只能靠
 * **传感器数据反推物理世界**：加热真关了出水温度就不该持续上升，水泵真关了流量就该归零。
 *
 * 【判定口径】指令为"关" + 传感器显示仍在工作，且持续超过观察期：
 *   · 加热器：以"指令转关那一刻"的出水温度为基准，上升超过 heaterRiseC 就算还在加热。
 *     观察期 heaterConfirmMs 是为了躲开余热——加热丝断电后热量还会继续传给水，
 *     温度短时间内继续爬升是正常物理现象，不是故障。
 *   · 水泵：流量 >= pumpFlowMin 就算还在转。观察期 pumpConfirmMs 躲开管路里的惯性余流。
 *
 * 【怎么处置】三级递进，对应任务书三条：
 *   1. 确认不符 -> 记一条"实际状态与控制指令不符"告警，广播给前端弹警告。
 *   2. 自动重试 -> 每隔 retryIntervalMs 朝硬件重发一次"关闭"报文，最多 retryCount 次，
 *      试图把粘住的触点打开。重发用 setSwitch(..., skipPersist=true)：只发 MQTT 报文，
 *      不再改写 t_direct、不再记操作历史——指令本来就已经是"关"，我们只是重新喊一遍，
 *      不是一次新的人为操作，写进去会把操作历史刷满重复行。
 *   3. 重试全部无效 -> 判定硬件故障，写一条"需断电检修"的记录并广播，之后停止重试
 *      （继续刷指令既没用又会掩盖故障），等人工处理。症状消失后状态自动复位。
 *
 * 【为什么不自动关掉别的执行器】本规则只重发自己那一路的关闭指令，不做联锁停机——
 * 真正的"异常就停机"是安全联锁（safety/）和故障状态机（faultStatus/）的职责，
 * 它们各有自己的判定和复位流程，这里越权动手会和那两块打架。
 *
 * 【配置】DATA_QUALITY.relayStuck 见同目录 config.js，改后需重启后端。
 */

// ========== 赛场速改索引（要改什么 -> 去哪） ==========
//  关掉本规则          config.js relayStuck.enabled=false
//  只测加热/只测水泵    config.js relayStuck.heater / relayStuck.pump
//  余热误报太多        config.js relayStuck.heaterConfirmMs 调大 或 heaterRiseC 调大
//  改重试次数/间隔      config.js relayStuck.retryCount / retryIntervalMs
//  判定与重试主流程     evaluateRelayStuck() 约 L150
// ===================================================
const EventEmitter = require('events')
const CONFIG = require('./config')
const { SINGLE_DEVICE_MODE } = require('../../config/appSettings')
const { readSensors, resolveDeviceNoStr, findSwitchConfig, setSwitch } = require('../controlShared/controlHelpers')
const { getDirectValue } = require('../directData/saveDirectConfig')
const { getDefaultDeviceId } = require('../../utils/mappedData')
const { recordEvent } = require('../controlShared/recordEvent')
const { formatLocalDateTime } = require('../../utils/helper')
const { isLockedByFault, isAnyLocked } = require('../faultStatus/faultStatus')

/** 跟规则一写同一个 type，两条规则的记录一起归到"数据质量记录"表格。 */
const ERROR_TYPE = '数据质量'

/**
 * 两路被监控的执行器。
 *   prefix    - t_direct_config 里的 preffix，findSwitchConfig/setSwitch 靠它认开关
 *   sensorKey - 用哪个传感器语义槽位反推"是不是还在工作"（SENSOR_FIELD_MAP 的 key）
 *   warnId / faultId - 写进 t_error_msg 的 e_no，分别对应"不符告警"和"判定硬件故障"
 */
const ACTUATORS = [
  {
    key: 'heater', prefix: 'heater', label: '加热器', sensorKey: 'temp2',
    warnId: 'relay_stuck_heater', faultId: 'relay_fault_heater',
  },
  {
    key: 'pump', prefix: 'pump', label: '水泵', sensorKey: 'flow',
    warnId: 'relay_stuck_pump', faultId: 'relay_fault_pump',
  },
]

/** 本规则的告警类型清单，供 errorHistory.js 把 e_no 翻成中文名（跟 SPIKE_TYPES 同一套用法）。 */
const RELAY_TYPES = [
  { id: 'relay_stuck_heater', name: '加热器实际状态与控制指令不符' },
  { id: 'relay_stuck_pump', name: '水泵实际状态与控制指令不符' },
  { id: 'relay_fault_heater', name: '加热器继电器触点粘连（硬件故障，需断电检修）' },
  { id: 'relay_fault_pump', name: '水泵继电器触点粘连（硬件故障，需断电检修）' },
]

/** 每个"设备 + 执行器"一份跟踪状态。key = `${deviceNo}:${actuator.key}`。 */
const stateMap = new Map()
const events = new EventEmitter()

function initialState() {
  return {
    since: null,       // 指令转为"关"之后，开始观察的时间戳（毫秒）
    base: null,        // 观察起点的传感器读数（加热器用它当温度基准）
    warned: false,     // "实际状态与控制指令不符"是否已经报过（一轮只报一次）
    retries: 0,        // 已经重发了几次关闭指令
    lastRetryMs: 0,    // 上次重发的时间戳，用于按 retryIntervalMs 间隔重试
    faulted: false,    // 是否已判定为硬件故障（判定后停止重试，等人工处理）
  }
}

function getState(deviceNo, actuatorKey) {
  const key = `${deviceNo || 'global'}:${actuatorKey}`
  if (!stateMap.has(key)) stateMap.set(key, initialState())
  return stateMap.get(key)
}

function resetState(deviceNo, actuatorKey) {
  stateMap.set(`${deviceNo || 'global'}:${actuatorKey}`, initialState())
}

/** 指令值是不是"开"。取值约定跟 updateDirectConfigAndPublish.js / scheduleService.js 一致。 */
function isOnValue(value) {
  return ['on', 'open', '1', 'true'].includes(String(value).trim().toLowerCase())
}

/** 故障锁定期间不重发指令：手动入口在故障态会被拒绝，这里照发就等于绕过了那层锁定。 */
function isFaultLocked(deviceNo) {
  return SINGLE_DEVICE_MODE ? isAnyLocked() : isLockedByFault(deviceNo)
}

/**
 * 读一路开关"当前下发的指令值"（不是设备上报的状态）。
 * 单设备模式下开关值存在真实设备号那一行、不是 d_no IS NULL 的全局行，传 null 永远查不到，
 * 所以要用 getDefaultDeviceId() 兜——跟 updateDirectConfigAndPublish.js 里查水泵状态同一个坑。
 * @returns {Promise<string|null>} 原始指令值；开关没配置或没值时返回 null（本轮跳过判定）
 */
async function readCommandedValue(prefix, deviceNo) {
  const conf = await findSwitchConfig(prefix)
  if (!conf) return null
  const queryDNo = SINGLE_DEVICE_MODE ? await getDefaultDeviceId() : deviceNo
  const value = await getDirectValue({ config_id: conf.id, d_no: queryDNo })
  return value == null || value === '' ? null : value
}

/** 写一条记录 + 广播事件。level 用于前端区分提示样式：warning=黄色警告，fault=红色需处理。 */
async function fire(deviceNo, actuator, level, code, message, info) {
  await recordEvent({
    deviceNo,
    message,
    code,
    type: ERROR_TYPE,
    time: formatLocalDateTime(info.c_time) || undefined,
  })
  const trigger = { id: code, actuator: actuator.key, label: actuator.label, level, message, deviceNo: deviceNo || null }
  events.emit('relayStuck', trigger)
  return trigger
}

/**
 * 判断一路执行器"指令已关但实际还在工作"，并按需重发关闭指令 / 判定硬件故障。
 * @returns {Promise<Array>} 本次新产生的触发记录（0~1 条）
 */
async function evaluateOne(info, values, deviceNo, actuator, nowMs) {
  const rule = CONFIG.relayStuck
  if (rule[actuator.key] === false) return []

  const commanded = await readCommandedValue(actuator.prefix, deviceNo)
  // 开关没配指令项、或从没下发过值：无从判断"指令是关的"，跳过。
  if (commanded == null) return []
  // 指令本来就是"开"，设备在工作是理所当然的，不判。
  if (isOnValue(commanded)) {
    resetState(deviceNo, actuator.key)
    return []
  }

  const reading = values[actuator.sensorKey]
  if (reading == null) return []

  const state = getState(deviceNo, actuator.key)
  // 指令刚转为"关"（或上一轮刚复位）：以这一刻为观察起点，先记基准值，不判。
  if (state.since == null) {
    state.since = nowMs
    state.base = reading
    return []
  }

  const confirmMs = actuator.key === 'heater' ? rule.heaterConfirmMs : rule.pumpConfirmMs
  const stillWorking = actuator.key === 'heater'
    ? reading - state.base >= rule.heaterRiseC   // 出水温度相对断电基准还在往上爬
    : reading >= rule.pumpFlowMin                // 流量还没归零

  if (!stillWorking) {
    // 症状消失：可能是余热散完了、也可能是重发的关闭指令生效了、或者人工修好了。
    if (state.warned || state.faulted) {
      console.log(`[RelayStuck] ${actuator.label} 实际状态已与指令一致，跟踪状态复位（设备=${deviceNo || '全局'}）`)
    }
    resetState(deviceNo, actuator.key)
    return []
  }

  // 观察期内不判，躲开加热余热 / 管路余流这些正常的物理惯性。
  if (nowMs - state.since < confirmMs) return []

  const triggers = []

  // ① 界面显示"实际状态与控制指令不符"警告。一轮只报一次，症状消失复位后才会再报。
  if (!state.warned) {
    state.warned = true
    // 文案统一成"原因｜处置｜数据"三段
    const detail = actuator.key === 'heater'
      ? `出水温度 ${state.base}℃ → ${reading}℃（上升 ${(reading - state.base).toFixed(2)}℃）`
      : `瞬时流量仍为 ${reading} L/min`
    triggers.push(await fire(
      deviceNo, actuator, 'warning', actuator.warnId,
      `${actuator.label}状态与指令不符｜开始自动重发关闭指令（最多 ${rule.retryCount} 次）｜已下发关闭，但${detail}`,
      info,
    ))
  }

  // 已判定硬件故障：停止重试，等人工断电检修。
  if (state.faulted) return triggers
  // 重试间隔没到，本轮不动作。
  if (nowMs - state.lastRetryMs < rule.retryIntervalMs) return triggers

  // ② 自动连续重发关闭指令尝试恢复。
  if (state.retries < rule.retryCount) {
    state.retries += 1
    state.lastRetryMs = nowMs
    if (isFaultLocked(deviceNo)) {
      console.warn(`[RelayStuck] 系统处于故障锁定态，跳过第 ${state.retries} 次重发（${actuator.label}）`)
      return triggers
    }
    try {
      // skipPersist=true：只朝硬件重发报文，不改 t_direct、不记操作历史（指令本来就是"关"）。
      await setSwitch(actuator.prefix, actuator.label, 'off', deviceNo, 'relay_recovery', true)
      console.warn(`[RelayStuck] ${actuator.label} 第 ${state.retries}/${rule.retryCount} 次重发关闭指令（设备=${deviceNo || '全局'}）`)
    } catch (err) {
      console.error(`[RelayStuck] ${actuator.label} 第 ${state.retries} 次重发失败:`, err.message)
    }
    return triggers
  }

  // ③ 重试次数用完仍未恢复：判定硬件故障，记录并提示人工断电检修，之后不再重试。
  state.faulted = true
  triggers.push(await fire(
    deviceNo, actuator, 'fault', actuator.faultId,
    `${actuator.label}继电器粘连/控制失效｜已停止重试，请人工断电检修｜连续 ${rule.retryCount} 次重发关闭指令均无效`,
    info,
  ))
  return triggers
}

/**
 * 评估一条上报消息里的两路执行器。
 * @param {Object} info 已解析并补好 c_time 的上报数据
 * @returns {Promise<Array>} 本次新产生的触发记录，供调用方挂到 info 上
 */
async function evaluateRelayStuck(info) {
  if (!CONFIG.enabled || !CONFIG.relayStuck?.enabled) return []
  const deviceNo = await resolveDeviceNoStr(info)
  const values = await readSensors(info)
  const nowMs = Date.now()
  const triggers = []
  for (const actuator of ACTUATORS) {
    // 一路出错不影响另一路，跟安全联锁 closePumpHeater 逐个 try/catch 的处理方式一致。
    try {
      triggers.push(...await evaluateOne(info, values, deviceNo, actuator, nowMs))
    } catch (err) {
      console.error(`[RelayStuck] ${actuator.label} 评估失败:`, err.message)
    }
  }
  return triggers
}

module.exports = {
  evaluateRelayStuck,
  onRelayStuck: (listener) => events.on('relayStuck', listener),
  RELAY_TYPES,
}
