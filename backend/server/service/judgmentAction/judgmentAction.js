/**
 * 【文件职责】智能判定联动：智能判定服务返回的结论文字里，如果命中 config.js 里
 *   某条规则的关键词，就按那条规则的 actions 关泵/关加热，并写一条故障记录。
 *
 * ★★ 赛场上要改判定逻辑（加/删/改规则），改同目录 config.js 的 RULES 就够了 ★★
 *   本文件的 checkRules 是通用循环，一般不需要改。
 *
 * 整条链路（写法照搬安全联锁 safetyInterlock.js）：
 *   intelligentJudgment.js 判定出结论 → evaluateJudgmentAction(结论, 记录)
 *        └─→ checkRules 按关键词匹配规则
 *              └─→ fire ─→ setSwitch（下发 MQTT + 落库 + 操作历史）+ recordEvent（写故障记录）
 *
 * 【配置】见同目录 config.js，改后需重启后端。
 */
const EventEmitter = require('events')
const CONFIG = require('./config')
const { SINGLE_DEVICE_MODE } = require('../../config/appSettings')
const { setSwitch, formatSwitchChange, resolveDeviceNoStr } = require('../controlShared/controlHelpers')
const { createCooldown } = require('../controlShared/cooldown')
const { recordEvent } = require('../controlShared/recordEvent')
const { isAnyLocked, isLockedByFault } = require('../faultStatus/faultStatus')

/** 开关 preffix → 中文名。没列到的直接用 preffix 本身。 */
const SWITCH_LABELS = { pump: '水泵', heater: '加热' }

/** 冷却：同一个"设备+规则"在 alarmCooldownMs 内只处理一次。 */
const cooldown = createCooldown()
/** 每次真正触发时 emit 'judgment_action'，app.js 转成 WebSocket 推给前端弹提示。 */
const events = new EventEmitter()

/* ============================================================
 * 复位功能（config.js 的 requireReset=true 时启用）：
 *   触发并真正下发了动作后，锁定该设备，复位前不再重复触发。
 *   写法模仿 faultStatus 的 deviceStateMap，但这是"轻量锁定"——只挡重复触发，
 *   不做快照恢复（动作已经执行了，复位只是解除锁定、允许下次再触发）。
 * ============================================================ */
const lockedMap = new Map()  // deviceNo 或 'global' -> { ruleId, name, detail, lockedAt }

/** 该设备当前是否被智能判定联动锁定（复位前不再重复触发）。 */
function isJudgmentActionLocked(deviceNo) {
  return lockedMap.has(deviceNo || 'global')
}
function isAnyJudgmentActionLocked() {
  return lockedMap.size > 0
}
/** 取某设备的锁定详情（给 GET /api/judgmentAction/state 查询用）。 */
function getJudgmentActionState(deviceNo) {
  return lockedMap.get(deviceNo || 'global') || null
}
/** 复位：解除锁定。用户人工确认处理完后调用（POST /api/judgmentAction/reset）。 */
function resetJudgmentAction(deviceNo) {
  const key = deviceNo || 'global'
  const had = lockedMap.delete(key)
  return { success: true, locked: had, message: had ? '复位成功' : '当前无锁定，无需复位' }
}

/* ============================================================
 * ★★★ 判定规则（通用循环，一般不用改；改规则去 config.js 的 RULES）★★★
 * ============================================================ */
function checkRules(conclusion) {
  const text = String(conclusion || '')
  const triggers = []
  for (const rule of CONFIG.RULES || []) {
    // 开关用 === true 判断：写了 true 才判，写 false、注释掉、删掉都算关。
    if (rule.enabled !== true) continue
    // 结论里包含 keywords 里任意一个关键词就算命中
    const hit = (rule.keywords || []).some((kw) => text.includes(String(kw)))
    if (!hit) continue
    triggers.push({
      id: rule.id,
      name: `智能判定-${rule.name}`,
      detail: `判定结论：${text}`,
      actions: rule.actions || [],
    })
  }
  return triggers
}

/* ============================ 执行动作（照搬安全联锁 fire） ============================ */
async function fire(rule, deviceNo, detail, actions) {
  const cooldownKey = `${deviceNo || 'global'}:${rule.id}`
  const cooldownMs = Number(CONFIG.alarmCooldownMs) >= 0 ? Number(CONFIG.alarmCooldownMs) : 30000
  if (cooldown.withinCooldown(cooldownKey, cooldownMs)) return null
  cooldown.markFired(cooldownKey)

  // 复位功能：requireReset=true 且该设备还锁着 → 复位前不再重复触发，直接跳过。
  const requireReset = CONFIG.requireReset === true
  if (requireReset && isJudgmentActionLocked(deviceNo)) {
    console.warn(`[JudgmentAction] ${rule.name}：该设备已锁定待复位，跳过本次触发，设备 ${deviceNo || '全局'}`)
    return null
  }

  // done 只收下发成功的开关；changes 每个开关都收一段，拼进记录。
  const done = []
  const changes = []
  const locked = SINGLE_DEVICE_MODE ? isAnyLocked() : isLockedByFault(deviceNo)
  if (locked && (actions || []).length > 0) {
    console.warn(`[JudgmentAction] ${rule.name}：系统处于故障锁定，跳过开关动作（只写记录），设备 ${deviceNo || '全局'}`)
  }
  // config.js 的 executeActions 没写 true：actions 一个都不下发，只写记录和弹提示。
  const actionsOff = CONFIG.executeActions !== true
  if (!locked && actionsOff && (actions || []).length > 0) {
    console.warn(`[JudgmentAction] ${rule.name}：executeActions 已关闭，跳过开关动作（只写记录），设备 ${deviceNo || '全局'}`)
  }
  for (const { prefix, value } of (locked || actionsOff) ? [] : (actions || [])) {
    const label = SWITCH_LABELS[prefix] || prefix
    try {
      const result = await setSwitch(prefix, label, value, deviceNo, 'interlock')
      if (result) {
        done.push(label)
        changes.push(formatSwitchChange(label, result.oldValue, value))
        console.log(`[JudgmentAction] ${rule.name}：${label} -> ${value}，设备 ${deviceNo || '全局'}`)
      } else {
        // 指令页面上找不到这个开关（preffix 没配），跟下发抛异常一样记成失败。
        changes.push(`${label} 下发失败`)
      }
    } catch (err) {
      changes.push(`${label} 下发失败`)
      console.error(`[JudgmentAction] ${label} -> ${value} 下发失败:`, err.message)
    }
  }

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
    type: '智能判定联动',
    source: 'system',
    errorType: rule.name,
  })

  // 复位功能：真正下发了动作（done 非空）且 requireReset=true 时锁定该设备，等用户点"复位"解除。
  const nowLocked = requireReset && done.length > 0
  if (nowLocked) {
    lockedMap.set(deviceNo || 'global', { ruleId: rule.id, name: rule.name, detail: detail || '', lockedAt: Date.now() })
    console.log(`[JudgmentAction] ${rule.name}：已锁定设备 ${deviceNo || '全局'}，等待人工复位`)
  }

  const outcome = { id: rule.id, name: rule.name, detail: detail || '', interlocked: done.length > 0, locked: nowLocked }
  events.emit('judgment_action', { ...outcome, deviceNo: deviceNo || null })
  return outcome
}

/**
 * 判定出结论后调用，是本模块唯一入口。
 * @param {string} conclusion 智能判定服务返回的结论文字（如"干烧""正常"）
 * @param {Object} record     判定用的记录（含设备号，用于定位设备）
 * @returns {Array} 本次触发的规则结果
 */
async function evaluateJudgmentAction(conclusion, record) {
  if (CONFIG.enabled !== true) return []
  const deviceNo = await resolveDeviceNoStr(record)
  const triggers = checkRules(conclusion)
  const results = []
  for (const t of triggers) {
    const outcome = await fire(t, deviceNo, t.detail, t.actions)
    if (outcome) results.push(outcome)
  }
  if (results.length) {
    console.log(`[JudgmentAction] 智能判定触发 ${results.length} 项联动，设备 ${deviceNo || '全局'}`)
  }
  return results
}

module.exports = {
  evaluateJudgmentAction,
  onJudgmentAction: (listener) => events.on('judgment_action', listener),
  resetJudgmentAction,          // routes 的 POST /api/judgmentAction/reset
  getJudgmentActionState,       // routes 的 GET /api/judgmentAction/state
  isAnyJudgmentActionLocked,    // routes 的 GET /api/judgmentAction/state
}
