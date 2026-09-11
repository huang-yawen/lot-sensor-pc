/**
 * 【文件职责】定温停机服务：出水温度达到阈值就执行停机动作。
 *
 * ★ 判断条件和停机后干什么，全写在下面的 evaluateTempShutdown 函数里 ★
 *   本文件只负责"什么时候去判、判中了怎么下发"的骨架，具体判据和动作直接写在函数体内。
 *
 * 与定量停机（quantityShutdown）对称：一个按温度、一个按流量，两条独立的停机保护。
 * 每条消息判一次，不累计、不积分。
 *
 * 启不启用是"控制模式(auto_control_enabled) + 定温停机开关(shutdown_temp_enabled)"
 * 两级门，跟 pidHeating.js 的 isPidEnabled 同一套判定方式：控制模式必须是自动、且
 * 定温停机开关也打开，才真正启用；定温停机开关没配置指令项时才退回 config.js 的
 * enabled 兜底（但控制模式明确是手动时，兜底也不生效）。停机阈值仍是 shutdown_temp，
 * 指令中心优先、config.js 的 shutdownTemp 兜底。触发一次后本设备会被锁定，不再
 * 重复下发，直到重启后端或重新启用。
 *
 * 【配置】见同目录 config.js。
 */

// ========== 赛场速改索引（要改什么 → 去哪） ==========
//  改判断条件 / 改停机动作   下面的 evaluateTempShutdown 函数，直接写 if + setSwitch
//  改停机温度(℃)            指令页面 shutdown_temp；兜底 config.js shutdownTemp
//  关掉定温停机             指令页面把定温停机开关关掉；或 config.js enabled=false
// ===================================================
const CONFIG = require('./config')
// 读指令项数值、读传感器、下发开关、解析设备号统一走 controlShared，不再本地重抄一份。
const { getNumberValue, readSensors, setSwitch, resolveDeviceNoStr } = require('../controlShared/controlHelpers')
// 控制模式 + 开关读取复用 pidHeating.js 已导出的 readSwitchOn，跟 quantityShutdown.js 同一个来源。
const { readSwitchOn } = require('../pidHeating/pidHeating')

/** 每个设备是否已触发过停机（避免反复下发关闭指令）。 */
const shutdownDone = new Map()
/** 每个设备上一次评估时是否处于启用状态（用于识别重新启用后复位）。 */
const lastEnabled = new Map()

/** 定温停机是否真正启用：控制模式必须是自动，且定温停机开关是开——两级门都要满足。
 * 定温停机开关（shutdown_temp_enabled）没配置指令项时才退回 config.js 的 enabled 兜底；
 * 控制模式明确是手动时，兜底也不生效。跟 pidHeating.js 的 isPidEnabled 逻辑一致。 */
async function isTempShutdownEnabled(deviceNo) {
  const master = await readSwitchOn('auto_control_enabled', deviceNo)
  const enabled = await readSwitchOn('shutdown_temp_enabled', deviceNo)
  if (enabled == null) {
    if (master === false) return false
    return CONFIG.enabled === true
  }
  return master === true && enabled === true
}

/* ============================================================
 * ★★★ 赛场改这里：定温停机的判断条件和动作 ★★★
 * ============================================================
 * 直接写 if 判断条件，命中之后直接调 setSwitch 下发动作。setSwitch 内部会发 MQTT、
 * 把 t_direct 的显示值改掉、记一条 source='temp_shutdown' 的操作历史。
 *
 * 参数说明：
 *   sensors —— 这一条上报解析出来的现场数据：
 *     sensors.temp1     进水温度     sensors.temp2     出水温度
 *     sensors.flow      流量         sensors.pressure  压力
 *
 *   target —— 当前生效的停机温度阈值（℃）。指令中心 shutdown_temp 优先，
 *             删掉指令项才退回 config.js 的 shutdownTemp 兜底值。
 *
 *   deviceNo —— 当前设备号。
 *
 * 换个判据的例子：
 *   进水温度到了就停            if (sensors.temp1 >= target) { ... }
 *   温度到了、而且水泵开着才停  if (sensors.temp2 >= target && sensors.flow > 0) { ... }
 *   反过来，低于阈值就停        if (sensors.temp2 <= target) { ... }
 * ============================================================ */

/**
 * 主评估：每条消息调一次。
 * @param {Object} info - 已解析的设备上报数据
 * @returns {Object|null} { deviceNo, tempOut, target, reached, shutdown }，
 *   未启用、阈值无效、已停机过、温度读不到时返回 null
 */
async function evaluateTempShutdown(info) {
  const deviceNo = await resolveDeviceNoStr(info)

  // 两级门：控制模式=自动 且 定温停机开关=开，才算启用。
  const enabled = await isTempShutdownEnabled(deviceNo)
  const wasEnabled = lastEnabled.get(deviceNo)
  lastEnabled.set(deviceNo, enabled)
  if (!enabled) {
    // 关闭时解除停机锁定，下次重新打开就是全新一轮监测，不会一开就因为
    // 上一轮的 shutdownDone=true 被直接跳过。
    if (wasEnabled === true) shutdownDone.set(deviceNo, false)
    return null
  }

  // 指令中心优先 → 配置中心兜底 → 0（<= 0 判定为无效阈值，等于没配置停机温度）
  const target = await getNumberValue('shutdown_temp', deviceNo, CONFIG.shutdownTemp, 0)
  if (!Number.isFinite(target) || target <= 0) return null

  // 刚从禁用变成启用：解除停机锁定，开始新一轮监测。
  if (wasEnabled !== true) {
    shutdownDone.set(deviceNo, false)
    console.log(`[TempShutdown] 设备 ${deviceNo || '全局'} 定温停机已启用，阈值 ${target}℃`)
  }
  // 已触发过停机，不再重复下发。
  if (shutdownDone.get(deviceNo)) return null

  const sensors = await readSensors(info)
  if (sensors.temp2 == null) return null

  const result = { deviceNo, tempOut: Number(sensors.temp2.toFixed(2)), target, reached: false }

  // 判断出水温度是否达到停机阈值
  if (sensors.temp2 >= target) {
    // 执行停机动作：关泵关热
    await setSwitch('pump', '水泵', 'off', deviceNo, 'temp_shutdown')
    await setSwitch('heater', '加热', 'off', deviceNo, 'temp_shutdown')
    shutdownDone.set(deviceNo, true)
    result.reached = true
    result.shutdown = true
    console.log(`[TempShutdown] 设备 ${deviceNo || '全局'} 出水温度 ${sensors.temp2.toFixed(2)}℃ ≥ 阈值 ${target}℃，执行停机`)
  }

  return result
}

module.exports = { evaluateTempShutdown }
