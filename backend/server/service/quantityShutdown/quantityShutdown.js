/**
 * 【文件职责】定量停机服务：本轮累计流量达到目标就执行停机动作，完成定量换热。
 *
 * ★★ 赛场上要改定量停机，改下面的 evaluateQuantityShutdown 函数里的 if 判断和
 *   setSwitch 调用就够了 ★★
 *
 * 与定温停机（tempShutdown）对称：一个按流量、一个按温度，两条独立的停机保护。
 * 总流量只做累计统计，不参与水泵/加热的实时调节，仅用于停机判定。
 *
 * 计量周期是个四阶段状态机，每个设备各走一份（几个 Map 都按 deviceNo 存）：
 *   ① 关闭：开关是关的，什么都不做，只在"刚从开变关"那一刻清零累计、解除锁定。
 *   ② 开启：开关从关变开的那一刻，清零累计、解除锁定，开始新一轮计量。
 *   ③ 累计中：开关一直开着、还没到量，每条消息按真实时间差把瞬时流量积分进累计值。
 *   ④ 达标：累计到目标，执行停机动作并锁定——后续消息在③直接跳过，不会因为
 *      泵关了流量归零就重新计量，也不会每来一条消息就重复下发一次，直到开关关掉再打开。
 *
 * 【配置】见同目录 config.js。
 */

// ========== 赛场速改索引（要改什么 → 去哪） ==========
//  改判断条件 / 停机动作   下面的 evaluateQuantityShutdown 函数，直接改 if 和 setSwitch
//  改定量值(L)             指令页面 total_flow_target；兜底 config.js totalFlowTarget
//  关掉定量停机            指令页面 quantity_shutdown_enabled；或 config.js enabled=false
//  累计/积分逻辑           evaluateQuantityShutdown() 里的 dtSec 那几行
// ===================================================
const CONFIG = require('./config')
// 读指令项数值、读传感器、下发开关、解析设备号统一走 controlShared，不再本地重抄一份。
const { getNumberValue, readSensors, setSwitch, resolveDeviceNoStr } = require('../controlShared/controlHelpers')
// 总开关同样是"指令中心优先、配置中心兜底"，直接复用 pidHeating 导出的 readSwitchOn。
const { readSwitchOn } = require('../pidHeating/pidHeating')

/** 每个设备的本轮累计流量（L）。 */
const flowAccumulator = new Map()
/** 每个设备是否已触发过停机（避免反复下发）。 */
const shutdownDone = new Map()
/** 每个设备上一次评估时总开关是否开着（用于识别开关切换、重置计量周期）。 */
const lastEnabled = new Map()
/** 每个设备上一条参与累加的消息时间戳（毫秒），配合算真实 Δt。 */
const lastTimestamp = new Map()
/** 相邻两条消息的秒差上限：超过视为设备离线间隙，积分时只按上限计，避免离线期间
 *  被当成一直在流。跟 computedMetrics.js / cumulativeService.js 的 clamp 保持一致。 */
const MAX_GAP_SEC = 10

/**
 * 主评估：累计流量并判断是否该停机。
 * @param {Object} info - 已解析的设备上报数据
 * @param {number} [timestampMs] - 这条消息的时间戳（毫秒），用于按真实时间差积分流量
 * @returns {Object|null} { deviceNo, accumulated, target, reached, shutdown }，
 *   开关关闭、目标值无效、已停机过时返回 null
 */
async function evaluateQuantityShutdown(info, timestampMs = Date.now()) {
  const deviceNo = await resolveDeviceNoStr(info)

  // 总开关：指令中心 quantity_shutdown_enabled 优先，没配过（null）才退回 config.js。
  const switchOn = await readSwitchOn('quantity_shutdown_enabled', deviceNo)
  const enabled = switchOn != null ? switchOn : CONFIG.enabled === true

  const wasEnabled = lastEnabled.get(deviceNo)
  lastEnabled.set(deviceNo, enabled)

  // ① 关闭定量停机：重置计量周期。
  if (enabled !== true) {
    if (wasEnabled === true) {
      flowAccumulator.set(deviceNo, 0)
      shutdownDone.set(deviceNo, false)
      lastTimestamp.delete(deviceNo)
      console.log(`[QuantityShutdown] 设备 ${deviceNo || '全局'} 定量停机已关闭，计量周期重置`)
    }
    return null
  }

  // 指令中心优先 → 配置中心兜底 → 0（<= 0 判定为无效，等于不启用）
  const target = await getNumberValue('total_flow_target', deviceNo, CONFIG.totalFlowTarget, 0)
  if (!Number.isFinite(target) || target <= 0) return null

  // ② 打开定量停机：开始新的计量周期。
  if (wasEnabled !== true) {
    flowAccumulator.set(deviceNo, 0)
    shutdownDone.set(deviceNo, false)
    lastTimestamp.delete(deviceNo)
    console.log(`[QuantityShutdown] 设备 ${deviceNo || '全局'} 定量停机已开启，开始计量`)
  }

  // ④ 已触发过停机，不再累计也不再下发。
  if (shutdownDone.get(deviceNo)) return null

  // ③ 累计中：流量按 L/min 上报，按跟上一条消息的真实时间差积分（clamp 到 MAX_GAP_SEC，
  // 避免离线间隙被当成一直在流）；本轮第一条消息按 1 秒算，跟 computedMetrics.js 一致。
  const sensors = await readSensors(info)
  const prevTs = lastTimestamp.get(deviceNo)
  const dtSec = prevTs != null ? Math.max(0, Math.min(MAX_GAP_SEC, (timestampMs - prevTs) / 1000)) : 1
  lastTimestamp.set(deviceNo, timestampMs)
  if (sensors.flow != null && sensors.flow >= 0) {
    const prev = flowAccumulator.get(deviceNo) || 0
    flowAccumulator.set(deviceNo, prev + (sensors.flow / 60) * dtSec)
  }
  const accumulated = flowAccumulator.get(deviceNo) || 0

  const result = { deviceNo, accumulated: Number(accumulated.toFixed(2)), target, reached: false }

  // 判断是否达到停机条件
  if (accumulated >= target) {
    // 执行停机动作：关泵关热
    await setSwitch('pump', '水泵', 'off', deviceNo, 'quantity_shutdown')
    await setSwitch('heater', '加热', 'off', deviceNo, 'quantity_shutdown')
    shutdownDone.set(deviceNo, true)
    result.reached = true
    result.shutdown = true
    console.log(`[QuantityShutdown] 设备 ${deviceNo || '全局'} 累计流量 ${accumulated.toFixed(2)}L ≥ 目标 ${target}L，执行停机`)
  }

  return result
}

module.exports = { evaluateQuantityShutdown }
