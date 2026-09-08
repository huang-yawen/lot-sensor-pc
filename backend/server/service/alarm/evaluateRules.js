/** 【文件职责】告警规则评估与自动联锁服务。故障状态触发、指令页面锁定期间，
 *   自动联锁动作会被跳过（告警记录仍照常写入），避免绕过锁定改写 t_direct。
 * 触发一条告警时会 emit 一个 'alarm' 事件（见文件底部 onAlarm），供 app.js 转成
 * WebSocket 广播（alarm_triggered），前端 AlarmNotifier.vue 订阅后弹出提示——
 * 这跟 faultStatus.js 的 onFault/fault_triggered 是完全对称的两套机制：那边是
 * 5 种系统级硬故障（严重、低频、需要手动复位，用模态弹窗），这边是本页面自由配置
 * 的普通阈值规则（可能频繁触发、只是提示，不需要用户处理，所以用非阻塞通知）。
 * 【配置】ALARM_RULES（enabled/autoInterlockEnabled/rules）见对应 config.js。 */
const promisePool = require('../../config/dbPool')
// 阈值告警自己的开关和规则数组在这里（enabled / autoInterlockEnabled / rules）。
const CONFIG = require('./config')
const { SINGLE_DEVICE_MODE } = require('../../config/appSettings')
const EventEmitter = require('events')
const { firstValue, getTopic, toWireValue, buildSwitchPayload } = require('../../utils/protocol')
const { resolveDeviceNo, resolveFieldAliases } = require('../../utils/mappedData')
const { saveDirectData, getDirectValue } = require('../directData/saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory')
const { formatLocalDateTime } = require('../../utils/helper')
const { isLockedByFault, isAnyLocked } = require('../faultStatus/faultStatus')

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

/** 告警规则里各种比较运算符对应的 JS 判断函数。 */
const OPERATORS = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
}

/**
 * 取一条规则（或它的 require 前置条件）要监控的物理字段候选名。
 * 优先用 source_table + source_field 从字段映射表动态解析——跟 CUMULATIVE_METRICS/
 * TIME_WINDOW_METRICS 认字段槽位的方式一致，字段映射表改了物理名会自动跟着变，不用
 * 同步改这里；仍兼容旧规则里直接写死的 field 别名数组。
 */

// ========== 赛场速改索引（要改什么 → 去哪） ==========
//  关掉阈值告警      config.js enabled=false
//  开/关自动联锁动作 config.js autoInterlockEnabled（默认关，开前必须实机测试）
//  加/改一条规则     config.js rules[]（id/source_field/operator/threshold/action/enabled）
//  规则评估逻辑      evaluateRules() 约 L88
// ===================================================
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
 * 评估一条设备上报消息，对照 ALARM_RULES.rules 里配置的每一条规则依次检查：
 *   1. 规则本身有没有启用，运算符是不是认识的（OPERATORS 里有对应实现）。
 *   2. 前置条件（require）满不满足，不满足直接跳过这条规则。
 *   3. 拿这条规则关心的字段的实际值跟阈值比较，比较结果不成立就跳过。
 *   4. 冷却判断：同一个"设备+规则"短时间内已经触发过就跳过，避免高频重复告警。
 * 命中的规则会记一条告警（写库 + emit 事件供前端弹窗），如果这条规则还配置了
 * 自动联锁动作（autoInterlockEnabled 且 rule.action.field 有值），还会尝试
 * 下发一次指令——这部分逻辑更复杂，在下面 for 循环里单独有详细说明。
 * @param {Object} info - 已解析的设备上报数据
 * @returns {Promise<Array>} 本次命中的告警列表
 */
async function evaluateRules(info) {
  if (!CONFIG.enabled) return []
  const deviceNo = String((await resolveDeviceNo(info)) || 'default')
  const state = { ...(latestState.get(deviceNo) || {}), ...info }
  latestState.set(deviceNo, state)
  const alarms = []
  for (const rule of CONFIG.rules || []) {
    if (!rule.enabled || !OPERATORS[rule.operator]) continue
    if (!(await requirementMet(state, rule.require))) continue
    const candidates = await resolveFieldNames(rule)
    const raw = firstValue(state, candidates)
    const actual = Number(raw)
    const threshold = Number(rule.threshold)
    if (!Number.isFinite(actual) || !Number.isFinite(threshold) || !OPERATORS[rule.operator](actual, threshold)) continue
    const cooldownKey = `${deviceNo}:${rule.id}`
    const cooldownMs = Number(rule.cooldownMs) || 30000
    if (Date.now() - (lastTriggered.get(cooldownKey) || 0) < cooldownMs) continue
    lastTriggered.set(cooldownKey, Date.now())
    const message = `${rule.name}：当前值 ${actual} ${rule.operator} 阈值 ${threshold}`
    // info.c_time 为设备上报时间（已本地格式化）；若为空则使用本地服务器时间，避免 UTC 时差
    const recordTime = formatLocalDateTime(info.c_time) || formatLocalDateTime(new Date())
    await promisePool.execute(
      'INSERT INTO t_error_msg (d_no, c_time, e_msg, e_no, type) VALUES (?, ?, ?, ?, ?)',
      [deviceNo === 'default' ? null : deviceNo, recordTime, message, rule.id, rule.name]
    )
    let interlock = null
    if (CONFIG.autoInterlockEnabled && rule.action?.field) {
      const targetDevice = deviceNo === 'default' ? null : deviceNo
      // 故障状态触发后，指令页面（含所有开关和参数）会被锁定为只读，故障前状态由
      // 快照保护、等用户手动复位后才恢复。这里的自动联锁跟前端提交走的是不同代码
      // 路径（直接调用 saveDirectData，不经过 HTTP 接口的锁定拦截），如果不额外检查
      // 会绕过锁定直接改写 t_direct，打破"故障期间页面显示保持故障前状态"这个约定。
      // 单设备模式下用 isAnyLocked()（避免设备号映射不一致导致查不到故障态），
      // 多设备模式下按 targetDevice 精确匹配，跟 updateDirectConfigAndPublish.js 同一套判断。
      const locked = SINGLE_DEVICE_MODE ? isAnyLocked() : isLockedByFault(targetDevice)
      if (locked) {
        console.warn(`[Alarm] 联锁动作被故障锁定跳过 (${rule.id})，设备=${targetDevice || '全局'}`)
        interlock = { success: false, error: '系统处于故障态，指令页面已锁定，跳过自动联锁动作' }
      } else {
        try {
          const mqttClient = require('../../mqtt')
          const [[directConfig]] = await promisePool.query(
            'SELECT id, t_name, f_type, preffix, wire_template, wire_on_payload, wire_off_payload FROM t_direct_config WHERE LOWER(preffix) = LOWER(?) LIMIT 1',
            [rule.action.field]
          )
          // 开关类联锁目标配置了 wire_template（如 Modbus 透传）时用整份报文下发，
          // 否则退回 { [字段名]: 线上值 }，跟手动下发和离线补发保持同一套逻辑。
          const payload = directConfig && String(directConfig.f_type) === '1'
            ? buildSwitchPayload(directConfig, rule.action.value)
            : { [rule.action.field]: toWireValue(rule.action.value) }
          if (!SINGLE_DEVICE_MODE && deviceNo !== 'default') payload.d_no = deviceNo
          const oldValue = directConfig
            ? await getDirectValue({ config_id: directConfig.id, d_no: targetDevice })
            : null
          await mqttClient.publish(getTopic('control'), payload, { qos: config.MQTT_QOS })
          if (directConfig) {
            await saveDirectData({ config_id: directConfig.id, value: rule.action.value, d_no: targetDevice })
          }
          const historyResult = await saveOperationHistory({
            d_no: targetDevice,
            config_id: directConfig?.id ?? null,
            old_value: oldValue,
            new_value: rule.action.value,
            source: 'interlock'
          })
          interlock = { success: true, payload, history: historyResult }
        } catch (error) {
          interlock = { success: false, error: error.message }
          console.error(`[Alarm] 联锁动作失败 (${rule.id}):`, error.message)
        }
      }
    }
    const alarm = { id: rule.id, name: rule.name, actual, threshold, message, interlock, deviceNo: deviceNo === 'default' ? null : deviceNo }
    alarms.push(alarm)
    // 立即广播，不等这条 MQTT 消息处理完（app.js 里的 onAlarm 会转成 WebSocket
    // 推给前端），跟故障触发的实时性要求一致：告警的意义就在于"马上让人看到"。
    events.emit('alarm', alarm)
  }
  return alarms
}

module.exports = {
  evaluateRules,
  onAlarm: (listener) => events.on('alarm', listener),
}
