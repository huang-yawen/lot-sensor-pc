/** 【文件职责】告警规则评估与自动联锁服务。故障状态触发、指令页面锁定期间，
 *   自动联锁动作会被跳过（告警记录仍照常写入），避免绕过锁定改写 t_direct。
 * 【配置中心关联】ALARM_RULES、ENABLE_LOCAL_ALARM、ENABLE_AUTO_INTERLOCK 每次评估读取。 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')
const { firstValue, getTopic, toWireValue, buildSwitchPayload } = require('../../utils/protocol')
const { resolveDeviceNo, resolveFieldAliases } = require('../../utils/mappedData')
const { saveDirectData, getDirectValue } = require('../directData/saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory/saveOperationHistory')
const { formatLocalDateTime } = require('../../utils/helper')
const { isLockedByFault, isAnyLocked } = require('../faultStatus/faultStatus')

const lastTriggered = new Map()
const latestState = new Map()

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
async function resolveFieldNames(spec) {
  if (!spec) return []
  if (spec.source_table && spec.source_field) {
    return resolveFieldAliases(spec.source_table, spec.source_field)
  }
  if (Array.isArray(spec.field)) return spec.field
  return spec.field ? [spec.field] : []
}

async function requirementMet(info, requirement) {
  if (!requirement) return true
  const candidates = await resolveFieldNames(requirement)
  const actual = firstValue(info, candidates)
  return (requirement.values || []).some(value => String(value).toLowerCase() === String(actual).toLowerCase())
}

async function evaluateRules(info) {
  const config = systemConfig.getConfig()
  if (!config.ENABLE_LOCAL_ALARM) return []
  const deviceNo = String((await resolveDeviceNo(info)) || 'default')
  const state = { ...(latestState.get(deviceNo) || {}), ...info }
  latestState.set(deviceNo, state)
  const alarms = []
  for (const rule of config.ALARM_RULES || []) {
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
    if (config.ENABLE_AUTO_INTERLOCK && rule.action?.field) {
      const targetDevice = deviceNo === 'default' ? null : deviceNo
      // 故障状态触发后，指令页面（含所有开关和参数）会被锁定为只读，故障前状态由
      // 快照保护、等用户手动复位后才恢复。这里的自动联锁跟前端提交走的是不同代码
      // 路径（直接调用 saveDirectData，不经过 HTTP 接口的锁定拦截），如果不额外检查
      // 会绕过锁定直接改写 t_direct，打破"故障期间页面显示保持故障前状态"这个约定。
      // 单设备模式下用 isAnyLocked()（避免设备号映射不一致导致查不到故障态），
      // 多设备模式下按 targetDevice 精确匹配，跟 updateDirectConfigAndPublish.js 同一套判断。
      const locked = config.SINGLE_DEVICE_MODE ? isAnyLocked() : isLockedByFault(targetDevice)
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
          if (!config.SINGLE_DEVICE_MODE && deviceNo !== 'default') payload.d_no = deviceNo
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
    alarms.push({ id: rule.id, name: rule.name, actual, threshold, message, interlock })
  }
  return alarms
}

module.exports = { evaluateRules }
/** 【文件职责】告警规则计算与可选自动联锁服务。
 * 【配置中心关联】ALARM_RULES、ENABLE_LOCAL_ALARM、ENABLE_AUTO_INTERLOCK、CONTROL_VALUE_MAP；
 * 每次评估都读取最新配置，自动联锁默认应保持关闭。 */
