/**
 * 【文件职责】数据质量板块的规则三：逆温差 / 传感器装反检测。
 * 跟同目录 spikeFilter.js（规则一）、relayStuck.js（规则二）同属"数据质量"板块，
 * 共用同一份 config.js、同一个 t_error_msg 里的 type='数据质量'、同一张记录表格。
 *
 * 【解决什么问题】进水（T1）和出水（T2）两路温度传感器装反了位置，或者两根信号线接反，
 * 是现场接线最容易犯、又最难自查的错误——两路读数都在合理范围内，任何单值阈值都发现
 * 不了。但它有一个物理上无法成立的特征：**加热开着的时候，出水一定比进水热**。
 * 如果加热开了好几分钟，出水反而比进水冷一大截，那只可能是两路接反了。
 *
 * 【为什么必须暂停恒温控制】PID 恒温的被控量是 T2 出水温度。两路接反时，PID 读到的
 * "出水温度"其实是进水温度——水越热，它读到的值反而越低，于是判断"还不够热"、继续加大
 * 加热功率，形成正反馈，会一路冲到超温。这不是控制精度问题，是控制方向反了，
 * 必须停下来等人工改接线，不能靠调参数救。
 *
 * 【判定口径】三个条件同时成立：
 *   ① 出水温度 < 进水温度
 *   ② 进水 − 出水 > tempDiffThreshold（默认 2℃，躲开传感器本身的测量误差）
 *   ③ 加热模块已开启超过 heatingMinMs（默认 3 分钟）——刚开加热时水还没热起来，
 *      出水比进水冷是正常的，必须等加热足够久、温差本该建立起来了才判。
 *
 * 【加热时长怎么算】PID 恒温是时间比例控制（模拟 PWM），加热开关会被高频通断，
 * 如果"一关就把计时清零"，这个 3 分钟永远攒不满、规则等于失效。所以只有加热**连续**
 * 关闭超过 heatingOffResetMs（默认 30 秒）才认为"这一轮加热结束了"、把计时清零；
 * PID 占空比造成的短暂通断不打断计时。
 *
 * 【怎么处置】
 *   1. 记一条"传感器逻辑配置异常"记录（写库 + 广播），前端弹提示建议检查硬件拓扑。
 *   2. 暂停自动恒温控制：pidHeating.js 每轮开头调 isThermostatSuspended() 早退。
 *      只停 PID 恒温这一个执行环节，不关水泵、不切控制模式、不动安全联锁和故障状态机。
 *   3. 逆温差症状消失（两路读数恢复正常关系）后自动解除暂停并广播恢复通知。
 *      注意这里判"恢复"只看温差本身、不看加热时长——否则一暂停加热、3 分钟计时清零，
 *      条件③不再成立就会立刻自动恢复，变成开-停-开的反复横跳。
 *
 * 【配置】DATA_QUALITY.sensorInverted 见同目录 config.js，改后需重启后端。
 */

// ========== 赛场速改索引（要改什么 -> 去哪） ==========
//  关掉本规则            config.js sensorInverted.enabled=false
//  只报警但不停恒温      config.js sensorInverted.suspendThermostat=false
//  改温差阈值            config.js sensorInverted.tempDiffThreshold
//  改"加热开启多久才判"  config.js sensorInverted.heatingMinMs
//  PID 通断打断计时      config.js sensorInverted.heatingOffResetMs 调大
//  判定主流程            evaluateSensorInverted() 约 L110
//  恒温暂停查询入口      isThermostatSuspended()（pidHeating.js 在调）
// ===================================================
const EventEmitter = require('events')
const CONFIG = require('./config')
const { readSensors, readSwitchStates, resolveDeviceNoStr } = require('../controlShared/controlHelpers')
const { recordEvent } = require('../controlShared/recordEvent')
const { formatLocalDateTime } = require('../../utils/helper')

/** 跟规则一、规则二写同一个 type，三条规则的记录一起归到"数据质量记录"表格。 */
const ERROR_TYPE = '数据质量'

/** 本规则的告警类型清单，供 errorHistory.js 把 e_no 翻成中文名。 */
const INVERTED_TYPES = [
  { id: 'sensor_inverted', name: '逆温差（传感器装反或两路信号接反）' },
]

/** 每个设备一份跟踪状态。 */
const stateMap = new Map()
const events = new EventEmitter()

function initialState() {
  return {
    heatingSince: null,   // 本轮加热的起始时间戳（毫秒），null = 当前没在加热
    heatOffSince: null,   // 加热转为关闭的时间戳，用于判断"是不是真的停了"而非 PID 占空比通断
    warned: false,        // 本轮异常是否已经报过（一轮只报一次，症状消失才复位）
    suspended: false,     // 是否正在暂停恒温控制
  }
}

function getState(deviceNo) {
  const key = deviceNo || 'global'
  if (!stateMap.has(key)) stateMap.set(key, initialState())
  return stateMap.get(key)
}

/**
 * 恒温控制当前是不是被本规则暂停了。pidHeating.js 每轮评估开头调用它做早退判断。
 * 用同步函数（不是 async）：PID 每条消息都要问一次，这里只读内存状态、不查库，
 * 保持同步可以让调用方那行早退判断写起来最轻。
 * @param {string|null} deviceNo
 */
function isThermostatSuspended(deviceNo) {
  if (!CONFIG.enabled || !CONFIG.sensorInverted?.enabled) return false
  if (!CONFIG.sensorInverted.suspendThermostat) return false
  return getState(deviceNo).suspended === true
}

/**
 * 维护"加热已经连续开了多久"。
 * heatOn 三态：true=确认开、false=确认关、null=这条消息没带开关字段（分开上报模式下的
 * 纯传感器消息）。null 时保持计时不变——没有信息不等于加热停了，清零会让 3 分钟永远攒不满。
 * @returns {number} 本轮加热已持续的毫秒数；没在加热返回 0
 */
function trackHeating(state, heatOn, nowMs, resetMs) {
  if (heatOn === true) {
    if (state.heatingSince == null) state.heatingSince = nowMs
    state.heatOffSince = null
  } else if (heatOn === false && state.heatingSince != null) {
    if (state.heatOffSince == null) {
      state.heatOffSince = nowMs
    } else if (nowMs - state.heatOffSince >= resetMs) {
      // 加热确实连续关够久了，本轮加热结束，计时清零。
      state.heatingSince = null
      state.heatOffSince = null
    }
  }
  return state.heatingSince == null ? 0 : nowMs - state.heatingSince
}

/**
 * 评估一条上报消息。
 * @param {Object} info 已解析并补好 c_time 的上报数据
 * @returns {Promise<Array>} 本次新产生的触发记录（0~1 条）
 */
async function evaluateSensorInverted(info) {
  if (!CONFIG.enabled || !CONFIG.sensorInverted?.enabled) return []
  const rule = CONFIG.sensorInverted
  const deviceNo = await resolveDeviceNoStr(info)
  const state = getState(deviceNo)
  const nowMs = Date.now()

  const { temp1, temp2 } = await readSensors(info)
  const { heatOn } = await readSwitchStates(info)
  const heatingMs = trackHeating(state, heatOn, nowMs, rule.heatingOffResetMs)

  if (temp1 == null || temp2 == null) return []

  // 逆温差本身是否成立：出水比进水冷，且冷得超过测量误差能解释的范围。
  const inverted = temp2 < temp1 && (temp1 - temp2) > rule.tempDiffThreshold

  // 温差关系恢复正常 -> 解除暂停、复位。只看温差、不看加热时长，理由见文件头第 3 条。
  if (!inverted) {
    if (state.suspended || state.warned) {
      console.log(`[SensorInverted] 进出水温差已恢复正常，解除恒温控制暂停（设备=${deviceNo || '全局'}）`)
      events.emit('sensorInverted', {
        id: 'sensor_inverted',
        level: 'recovered',
        message: '进出水温差已恢复正常，自动恒温控制已重新启用',
        deviceNo: deviceNo || null,
      })
    }
    state.warned = false
    state.suspended = false
    return []
  }

  // 加热还没开够久：刚开加热时出水比进水冷是正常的，不判。
  if (heatingMs <= rule.heatingMinMs) return []
  // 本轮已经报过了，不重复刷记录（暂停状态继续保持）。
  if (state.warned) return []

  state.warned = true
  state.suspended = rule.suspendThermostat

  const minutes = (heatingMs / 60000).toFixed(1)
  // 文案统一成"原因｜处置｜数据"三段
  const message = `进出水温度疑似接反｜${state.suspended ? '已暂停自动恒温控制，' : ''}请检查硬件接线`
    + `｜加热 ${minutes} 分钟后出水 ${temp2}℃ < 进水 ${temp1}℃（温差 ${(temp1 - temp2).toFixed(2)}℃ > ${rule.tempDiffThreshold}℃）`
  await recordEvent({
    deviceNo,
    message,
    code: 'sensor_inverted',
    type: ERROR_TYPE,
    time: formatLocalDateTime(info.c_time) || undefined,
  })
  console.warn(`[SensorInverted] ${message}（设备=${deviceNo || '全局'}）`)

  const trigger = {
    id: 'sensor_inverted',
    level: 'warning',
    temp1,
    temp2,
    heatingMinutes: Number(minutes),
    suspended: state.suspended,
    message,
    deviceNo: deviceNo || null,
  }
  events.emit('sensorInverted', trigger)
  return [trigger]
}

module.exports = {
  evaluateSensorInverted,
  isThermostatSuspended,
  onSensorInverted: (listener) => events.on('sensorInverted', listener),
  INVERTED_TYPES,
}
