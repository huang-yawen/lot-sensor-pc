/**
 * 【文件职责】定时开关（定时开泵/关泵、定时开加热/关加热）：每隔 tickIntervalMs 用
 * 本机本地时间自检一次，到达指令项 f_value 绑定的时刻就下发一次开关指令。
 * 触发判定是"已到点 + 宽限窗口内 + 当天还没触发过"，不要求当前时刻和设定时刻严格相等
 * （详见下方 TRIGGER_GRACE_MS 的说明），时间框精确到秒（HH:mm:ss）。
 * 【配置】同目录 config.js 决定总开关和自检周期；"几点做什么"不写在代码里，全部来自
 * 指令中心 t_direct_config 的时间框指令项（f_type='4'），换赛题只改数据库。
 * 【谁在读】app.js 启动时调 start()。
 *
 * 一条定时指令在 t_direct_config 里长这样（以"每天 8:00:00 开泵"为例）：
 *   t_name    = '水泵开启时间'
 *   f_type    = '4'             时间框，页面用 el-time-picker 渲染
 *   ref_id    = 1               依赖 id=1 的"控制模式"指令
 *   ref_value = 'on'            只有控制模式=自动时页面才显示、这里才执行
 *   f_value   = 'pump:on'       到点后把 preffix=pump 的开关置为 on
 *   preffix   = 'pump_on_time'  这个时间值本身下发给设备用的属性名
 *
 * 完整链路：用户在指令页选好时间 -> 走 /directData/update 存进 t_direct、同时把时间值
 * 本身下发给设备 -> 本服务从 t_direct 读回这个时间值，到点执行 f_value 绑定的动作。
 *
 * "自动模式才生效"是怎么保证的：直接复用 ref_id / ref_value —— 前端 DynamicNode 用它
 * 决定"显不显示"，这里用同一套条件决定"执不执行"。页面上看得见的，才是后端会执行的；
 * 切回手动模式后定时项从页面消失，后端也同步停止执行，不会出现界面和行为不一致。
 *
 * 到点判定怎么做：自检周期取 500ms，到达设定时刻后在 TRIGGER_GRACE_MS（默认 120 秒）
 * 宽限窗口内的第一次自检就触发，并按"设备 + 指令项 + 日期"去重保证当天只动作一次。
 * 不要求当前时刻与设定时刻严格相等——用户选时间到点保存有几秒延迟、某轮自检被慢
 * 查询跳过、服务短暂重启，都不会让设定时刻被永久错过；超过宽限窗口当天不再补触发，
 * 避免长时间停机后把很早以前的开/关动作在错误的时间补上。
 *
 * 为什么不用 node-cron：赛场断网，多一个依赖多一份打包风险；赛题只要求"每天固定时刻"，
 * 实现不到 200 行，现场好排查。
 *
 * 关闭方式：
 * - 临时关闭全部定时：本目录 config.js 的 enabled 改 false；
 * - 关闭单条定时：把控制模式切回手动，或清掉对应 t_direct_config 记录的 f_value。
 */

const promisePool = require('../../config/dbPool')
const CONFIG = require('./config')
const SAFETY_CONFIG = require('../safety/config')
const { SINGLE_DEVICE_MODE } = require('../../config/appSettings')
const { getDirectValue } = require('../directData/saveDirectConfig')
const { setSwitch, resolveConfigIdByPrefix } = require('../controlShared/controlHelpers')
const { getDefaultDeviceId } = require('../../utils/mappedData')
const { isAnyLocked, isLockedByFault } = require('../faultStatus/faultStatus')

/** 时间框的控件类型，与 t_direct_config.f_type 的约定一致。 */
const TIME_FIELD_TYPE = '4'

/** 操作历史来源标记，operationHistory.js 的来源 CASE 据此显示成"定时任务"。 */
const SOURCE = 'schedule'

let timer = null

/**
 * 上一轮自检是否还没跑完。500ms 一轮的频率下，如果某一轮的数据库查询变慢（故障期间
 * 并发压力大时会出现），下一轮会紧跟着进来、越堆越多，所以慢的时候直接跳过本轮。
 * 跳过不会漏触发：设定的那一秒还会被后续几轮反复检查到。
 */
let running = false

/**
 * 触发宽限窗口（毫秒）。定时项到达设定时刻后，在这段时间内第一次自检都会触发；
 * 超过窗口当天就不再补触发（等第二天）。用来兜住"严格按时刻相等判断必然错过"的情况：
 *   1. 用户从打开时间选择器（秒在那一刻就定了）到点保存完成，必然有几秒延迟，等值
 *      写进数据库，设定的那一秒已经过去，若要求"当前秒==设定秒"当天再也匹配不上；
 *   2. 某一轮 500ms 自检被慢查询/事件循环阻塞跳过；
 *   3. 后端在设定时刻后短暂重启。
 * 窗口不能开太大：否则晚上 23 点才把服务开起来，会把早上 8 点的"开泵"在深夜补执行。
 */
const TRIGGER_GRACE_MS = 120 * 1000

/**
 * 当天去重：key = `${设备号}:${指令项id}:${年-月-日}`，命中表示该定时项今天已触发过。
 * 按"天"而不是按"秒/分钟"去重：配合上面的"到点即触发 + 宽限窗口"，保证每条定时每天
 * 只动作一次。只存内存（量极小，进程重启即清空），开关水泵/加热本身是幂等动作。
 */
const lastRunDay = new Map()

/**
 * 已经警告过的配置错误，避免每 500ms 刷一次屏。f_value 格式写错、目标开关被删这类
 * 问题会一直命中，只在第一次打日志提醒，之后静默跳过。
 */
const warnedKeys = new Set()

function warnOnce(key, message) {
  if (warnedKeys.has(key)) return
  warnedKeys.add(key)
  console.warn(message)
}

/**
 * 解析 f_value 里的动作绑定，格式 '目标preffix:目标值'，如 'pump:on'。
 * @param {string} fValue
 * @returns {{field: string, value: string}|null} 格式不合法时返回 null
 */
function parseBinding(fValue) {
  const raw = String(fValue || '').trim()
  if (!raw) return null
  const parts = raw.split(':')
  if (parts.length !== 2) return null
  const field = parts[0].trim()
  const value = parts[1].trim()
  if (!field || !value) return null
  return { field, value }
}

/**
 * 把指令里存的时间值规整成 'HH:mm:ss'。时间框保存的就是 HH:mm:ss，秒参与比对。
 * 没填秒的历史数据（如 '8:00' 或 '08:00'）按第 0 秒处理，不会因为格式短一截就失效。
 * @param {*} value
 * @returns {string|null} 不是合法时间时返回 null
 */
function normalizeHhmmss(value) {
  const raw = String(value || '').trim()
  const matched = raw.match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/)
  if (!matched) return null
  const hour = Number(matched[1])
  if (hour > 23) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(hour)}:${matched[2]}:${matched[3] ?? '00'}`
}

/**
 * 取本机本地时间的当前秒。hhmmss 用来和用户设定的时刻比对，full 带上日期用于去重。
 * @param {Date} now
 */
function currentSecond(now) {
  const pad = (n) => String(n).padStart(2, '0')
  const hhmmss = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  return {
    hhmmss,
    full: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${hhmmss}`,
  }
}

/**
 * 判断一条指令的显示/执行条件是否满足，规则与前端 DynamicNode 的 match() 保持一致：
 * - 没有 ref_id：顶层指令，无条件成立；
 * - ref_value 为 'off&on'：父指令取任意值都成立；
 * - 其余情况：父指令当前值必须等于 ref_value（用 & 分隔可以列多个可接受的值）。
 * @param {Object} node t_direct_config 行
 * @param {string|null} deviceNo 设备编号
 * @returns {Promise<boolean>}
 */
async function isConditionMet(node, deviceNo) {
  if (node.ref_id === null || node.ref_id === undefined) return true
  const expected = String(node.ref_value || '').trim()
  if (!expected || expected === 'off&on') return true
  const current = await getDirectValue({ config_id: node.ref_id, d_no: deviceNo })
  return expected.split('&').map(item => item.trim()).includes(String(current))
}

/** 把指令值统一判断成"开"，取值约定与 controlHelpers / faultSnapshot 一致。 */
function isOnValue(value) {
  return ['on', 'open', '1', 'true'].includes(String(value).trim().toLowerCase())
}

/**
 * 故障锁定期间不执行定时动作。手动入口（updateDirectConfigAndPublish.js）在故障态会
 * 直接拒绝改开关，定时任务如果照发就等于绕过了这层锁定，页面显示和硬件行为会不一致。
 * @param {string|null} deviceNo
 */
function isFaultLocked(deviceNo) {
  return SINGLE_DEVICE_MODE ? isAnyLocked() : isLockedByFault(deviceNo)
}

/**
 * 定时要开加热时，检查水泵是否已经开着。是否启用由 SAFETY_INTERLOCK.requirePumpBeforeHeater
 * 控制，跟手动下发入口用的是同一个开关、同一套口径，不另设一份配置。
 * @returns {Promise<boolean>} true=允许执行
 */
async function canTurnOnHeater(binding, deviceNo) {
  if (SAFETY_CONFIG.requirePumpBeforeHeater === false) return true
  if (binding.field.toLowerCase() !== 'heater' || !isOnValue(binding.value)) return true
  const pumpConfigId = await resolveConfigIdByPrefix('pump')
  if (pumpConfigId == null) return true
  const pumpValue = await getDirectValue({ config_id: pumpConfigId, d_no: deviceNo })
  return isOnValue(pumpValue)
}

/**
 * 一次自检：找出已到点（在 TRIGGER_GRACE_MS 宽限窗口内）、条件满足且今天还没执行过
 * 的定时指令并执行。
 */
async function tick() {
  if (CONFIG.enabled !== true) return

  const now = new Date()
  const { hhmmss } = currentSecond(now)

  try {
    // 只取时间框类型、且配了动作绑定的指令项。没配 f_value 的时间框只是把时间值下发给
    // 设备、由下位机自己处理，上位机不管。
    const [nodes] = await promisePool.query(
      "SELECT id, t_name, ref_id, ref_value, f_value, preffix FROM t_direct_config WHERE f_type = ? AND f_value IS NOT NULL AND f_value <> ''",
      [TIME_FIELD_TYPE]
    )
    if (nodes.length === 0) return

    // 单设备模式取默认设备。多设备模式下 t_direct 是按 d_no 分别存值的，这里仍以默认
    // 设备为准，现场真要多设备定时需要按 d_no 展开这一层循环。
    const deviceNo = await getDefaultDeviceId()

    if (isFaultLocked(deviceNo)) return

    for (const node of nodes) {
      const binding = parseBinding(node.f_value)
      if (!binding) {
        warnOnce(`binding:${node.id}`,
          `[Schedule] 指令「${node.t_name}」的 f_value=${node.f_value} 不是 '目标preffix:目标值' 格式，已跳过`)
        continue
      }

      // 控制模式等前置条件必须满足（通常是"自动"），否则不执行
      if (!await isConditionMet(node, deviceNo)) continue

      // 读用户在指令页设定的时刻（HH:mm:ss）
      const scheduled = normalizeHhmmss(await getDirectValue({ config_id: node.id, d_no: deviceNo }))
      if (!scheduled) continue

      // 计算"今天的设定时刻"，判断是否到点。不要求当前时刻和设定时刻严格相等：
      // 用户从选时间到保存有几秒延迟、某轮自检被慢查询跳过、服务短暂重启，都会让
      // "严格相等"错过那一秒、当天再也不触发（要傻等第二天）。改成"已到点 + 宽限窗口
      // 内 + 今天还没执行过"才触发；超过宽限窗口当天不补，等第二天（避免深夜启动把
      // 早上的开泵在半夜补上）。
      const [setH, setM, setS] = scheduled.split(':').map(Number)
      const scheduledToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), setH, setM, setS, 0)
      const elapsedMs = now.getTime() - scheduledToday.getTime()
      if (elapsedMs < 0) continue                        // 还没到点
      if (elapsedMs > TRIGGER_GRACE_MS) continue         // 已过宽限窗口，今天不补

      // 每条定时项每天只触发一次（按"设备 + 指令项 + 日期"去重）
      const dayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
      const dedupeKey = `${deviceNo || 'global'}:${node.id}:${dayKey}`
      if (lastRunDay.has(dedupeKey)) continue
      lastRunDay.set(dedupeKey, true)

      if (!await canTurnOnHeater(binding, deviceNo)) {
        console.warn(`[Schedule] ${hhmmss} 「${node.t_name}」未执行：水泵未开启，不允许打开加热`)
        continue
      }

      // 目标开关被从数据库删掉时只提醒一次，不影响其它定时项继续工作
      const done = await setSwitch(binding.field, node.t_name, binding.value, deviceNo, SOURCE)
      if (done) {
        console.log(`[Schedule] ${hhmmss} 触发「${node.t_name}」-> ${binding.field}=${binding.value}`)
      } else {
        warnOnce(`target:${node.id}:${binding.field}`,
          `[Schedule] 找不到 preffix=${binding.field} 的开关类指令项，「${node.t_name}」未执行`)
      }
    }
  } catch (error) {
    console.error('[Schedule] 自检失败:', error.message)
  }
}

/** 启动定时自检。重复调用安全（已启动就直接返回）。 */
function start() {
  if (timer) return
  const configured = Number(CONFIG.tickIntervalMs)
  // 触发精度是秒级，周期必须小于 1000ms，否则可能整秒跳过、漏掉设定的时刻；
  // 配错了退回 500ms。下限 50ms 是防止填成 0 或负数把事件循环打满。
  const intervalMs = Number.isFinite(configured) && configured >= 50 && configured < 1000
    ? configured
    : 500
  timer = setInterval(() => {
    // 上一轮还没跑完就跳过本轮，避免慢查询时堆积
    if (running) return
    running = true
    tick().finally(() => { running = false })
  }, intervalMs)
  timer.unref?.()
  console.log(`[Schedule] 定时开关已启动（秒级精度），自检间隔 ${intervalMs} 毫秒`)
}

/** 停止定时自检。 */
function stop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  running = false
}

module.exports = { start, stop, tick, parseBinding, normalizeHhmmss }
