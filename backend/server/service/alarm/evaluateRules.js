/** 【文件职责】告警规则评估与自动联锁服务。每收到一条设备上报，逐条判断阈值告警
 *   规则，命中就写一条告警记录（t_error_msg），可选下发自动联锁指令，并 emit 一个
 *   'alarm' 事件供 app.js 转成 WebSocket 广播（alarm_triggered），前端 AlarmNotifier.vue
 *   订阅后弹出提示——这跟 faultStatus.js 的 onFault/fault_triggered 是完全对称的两套机制：
 *   那边是 5 种系统级硬故障（严重、低频、需要手动复位，用模态弹窗），这边是本页面自由配置
 *   的普通阈值规则（可能频繁触发、只是提示，不需要用户处理，所以用非阻塞通知）。
 * 故障状态触发后，指令页面锁定期间，自动联锁动作会被跳过（告警记录仍照常写入），
 * 避免绕过锁定改写 t_direct。
 * 【配置】开关和参数（enabled/autoInterlockEnabled/各规则开关/阈值）见同目录 config.js；
 *   自动联锁下发指令用的 MQTT_QOS 见 config/mqtt.js。 */

const promisePool = require('../../config/dbPool')
// 阈值告警自己的开关和参数在这里（enabled / autoInterlockEnabled / 各规则开关 / 阈值）。
const CONFIG = require('./config')
const { SINGLE_DEVICE_MODE } = require('../../config/appSettings')
const { MQTT_QOS } = require('../../config/mqtt')
const EventEmitter = require('events')
const { firstValue, getTopic, toWireValue, buildSwitchPayload } = require('../../utils/protocol')
const { resolveDeviceNo, resolveFieldAliases } = require('../../utils/mappedData')
const { saveDirectData, getDirectValue } = require('../directData/saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory')
const { formatLocalDateTime } = require('../../utils/helper')
const { isLockedByFault, isAnyLocked } = require('../faultStatus/faultStatus')

// ========== 赛场速改索引（要改什么 → 去哪） ==========
//  关掉阈值告警      config.js enabled=false
//  开/关自动联锁动作 config.js autoInterlockEnabled（默认关，开前必须实机测试）
//  临时停某条规则   config.js 对应规则开关 = false（temperatureHigh / flowLow / pressureHigh）
//  改阈值           config.js 对应 threshold 参数
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

/* ============================================================
 * ★★★ 赛场改这里：阈值告警的判定规则 ★★★
 * ============================================================
 * 每条规则用一个 if 块写：开关开着 + 字段值越限 → push 一条 trigger。
 * 命中的 trigger 字段：
 *   id        规则编号（也作告警记录里的 e_no）
 *   name      规则名称（写进 t_error_msg 的 type 字段）
 *   actual    当前实际值
 *   threshold 阈值
 *   message   告警描述（写进 t_error_msg 的 e_msg 字段）
 *   action    自动联锁动作 { field: 指令中心开关 preffix, value: 目标值 }，
 *             只有 autoInterlockEnabled=true 时才实际下发；不需要动作就给 null
 * 没命中不 push。返回本次命中的所有 trigger，由下面 fire 统一处理
 * （冷却/写记录/联锁/广播）。
 * ============================================================ */
async function checkAlarms(state) {
  const triggers = []

  // ── 规则1：出水温度过高 ──
  if (CONFIG.temperatureHigh !== false) {
    const candidates = await resolveFieldNames({ source_table: 't_sensor_data', source_field: 'field2' })
    const actual = Number(firstValue(state, candidates))
    const threshold = Number(CONFIG.temperatureHighThreshold)
    if (Number.isFinite(actual) && Number.isFinite(threshold) && actual > threshold) {
      triggers.push({
        id: 'temperature_high',
        name: '出水温度过高',
        actual,
        threshold,
        message: `出水温度过高：当前值 ${actual} > 阈值 ${threshold}`,
        action: { field: 'heater', value: 'off' },
      })
    }
  }

  // ── 规则2：循环流量过低 ──
  // 只有水泵处于开启状态时，低流量才属于异常（避免水泵正常关闭时误报）。
  if (CONFIG.flowLow !== false) {
    const pumpOn = await requirementMet(state, {
      source_table: 't_behavior_data', source_field: 'field1', values: ['open', 'on', 1, true],
    })
    if (pumpOn) {
      const candidates = await resolveFieldNames({ source_table: 't_sensor_data', source_field: 'field3' })
      const actual = Number(firstValue(state, candidates))
      const threshold = Number(CONFIG.flowLowThreshold)
      if (Number.isFinite(actual) && Number.isFinite(threshold) && actual < threshold) {
        triggers.push({
          id: 'flow_low',
          name: '循环流量过低',
          actual,
          threshold,
          message: `循环流量过低：当前值 ${actual} < 阈值 ${threshold}`,
          action: { field: 'heater', value: 'off' },
        })
      }
    }
  }

  // ── 规则3：管路压力过高 ──
  if (CONFIG.pressureHigh !== false) {
    const candidates = await resolveFieldNames({ source_table: 't_sensor_data', source_field: 'field4' })
    const actual = Number(firstValue(state, candidates))
    const threshold = Number(CONFIG.pressureHighThreshold)
    if (Number.isFinite(actual) && Number.isFinite(threshold) && actual > threshold) {
      triggers.push({
        id: 'pressure_high',
        name: '管路压力过高',
        actual,
        threshold,
        message: `管路压力过高：当前值 ${actual} > 阈值 ${threshold}`,
        action: { field: 'pump', value: 'off' },
      })
    }
  }

  return triggers
}

/* ============================================================
 * 一条规则命中之后要做的全部事情：冷却判断 → 写告警记录 → 自动联锁下发 → 广播。
 * 冷却期内直接返回 null，不重复记录也不重复下发。
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

  let interlock = null
  if (CONFIG.autoInterlockEnabled && trigger.action?.field) {
    const targetDevice = deviceNo === 'default' ? null : deviceNo
    const locked = SINGLE_DEVICE_MODE ? isAnyLocked() : isLockedByFault(targetDevice)
    if (locked) {
      console.warn(`[Alarm] 联锁动作被故障锁定跳过 (${trigger.id})，设备=${targetDevice || '全局'}`)
      interlock = { success: false, error: '系统处于故障态，指令页面已锁定，跳过自动联锁动作' }
    } else {
      try {
        const mqttClient = require('../../mqtt')
        const [[directConfig]] = await promisePool.query(
          'SELECT id, t_name, f_type, preffix, wire_template, wire_on_payload, wire_off_payload FROM t_direct_config WHERE LOWER(preffix) = LOWER(?) LIMIT 1',
          [trigger.action.field]
        )
        // 开关类联锁目标配置了 wire_template（如 Modbus 透传）时用整份报文下发，
        // 否则退回 { [字段名]: 线上值 }，跟手动下发和离线补发保持同一套逻辑。
        const payload = directConfig && String(directConfig.f_type) === '1'
          ? buildSwitchPayload(directConfig, trigger.action.value)
          : { [trigger.action.field]: toWireValue(trigger.action.value) }
        if (!SINGLE_DEVICE_MODE && deviceNo !== 'default') payload.d_no = deviceNo
        const oldValue = directConfig
          ? await getDirectValue({ config_id: directConfig.id, d_no: targetDevice })
          : null
        await mqttClient.publish(getTopic('control'), payload, { qos: MQTT_QOS })
        if (directConfig) {
          await saveDirectData({ config_id: directConfig.id, value: trigger.action.value, d_no: targetDevice })
        }
        const historyResult = await saveOperationHistory({
          d_no: targetDevice,
          config_id: directConfig?.id ?? null,
          old_value: oldValue,
          new_value: trigger.action.value,
          source: 'interlock'
        })
        interlock = { success: true, payload, history: historyResult }
      } catch (error) {
        interlock = { success: false, error: error.message }
        console.error(`[Alarm] 联锁动作失败 (${trigger.id}):`, error.message)
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
 * 评估一条设备上报消息：把这条消息合并进历史快照，再调 checkAlarms 逐条判，
 * 命中的规则交给 fire 处理（冷却/写库/联锁/广播）。
 * @param {Object} info - 已解析的设备上报数据
 * @returns {Promise<Array>} 本次命中的告警列表
 */
async function evaluateRules(info) {
  if (!CONFIG.enabled) return []
  const deviceNo = String((await resolveDeviceNo(info)) || 'default')
  // 把这条消息合并进历史快照：同一条规则可能要同时看传感器字段和行为字段，
  // 而它们不一定在同一条消息里上报，靠 latestState 跨消息累积。
  const state = { ...(latestState.get(deviceNo) || {}), ...info }
  latestState.set(deviceNo, state)

  const triggers = await checkAlarms(state)
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
