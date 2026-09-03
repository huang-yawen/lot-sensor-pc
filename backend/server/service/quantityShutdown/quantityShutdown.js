/**
 * 【文件职责】定量停机服务。
 *
 * 设定一个定量值（QUANTITY_SHUTDOWN.totalFlowTarget，单位 L），在自动模式下持续累计流量；
 * 当本次计量周期的累计流量 >= 目标值时，关闭水泵和加热，整套系统自动停机，完成定量换热。
 *
 * 总流量只做累计统计，不参与水泵/加热的实时调节，仅用于停机判定。
 * 每次打开“定量停机”开关会开启新的计量周期；关闭开关则重置计量周期
 * （项目里已经没有独立的设备“自动/手动模式”概念，改为直接跟着本模块自己的
 * enabled 开关走）。
 * 【配置中心关联】QUANTITY_SHUTDOWN 每次评估动态读取。
 */
const systemConfig = require('../../config/systemConfig')
const promisePool = require('../../config/dbPool')
const { firstValue, getTopic, buildSwitchPayload } = require('../../utils/protocol')
const { resolveDeviceNo, resolveFieldAliases } = require('../../utils/mappedData')
const { getDirectValue, saveDirectData } = require('../directData/saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory/saveOperationHistory')
// 定量值支持现场在指令中心调（preffix=total_flow_target），指令项删掉就退回配置中心。
const { getNumberValue } = require('../controlShared/controlHelpers')

/** 流量字段槽位（与字段映射表 field3 对齐）。 */
const FLOW_FIELD = 'field3'

/** 每个设备的累计流量（单位 L）。 */
const flowAccumulator = new Map()
/** 每个设备是否已因定量停机触发（避免反复发送关闭指令）。 */
const shutdownDone = new Map()
/** 每个设备上一次评估时“定量停机”开关是否启用（用于识别开关切换，重置计量周期）。 */
const lastEnabled = new Map()

/** 按 preffix 精确查 t_direct_config 的 id，查不到返回 null。 */
async function resolveConfigIdByPrefix(prefix) {
  if (!prefix) return null
  const [rows] = await promisePool.query(
    "SELECT id FROM t_direct_config WHERE preffix IS NOT NULL AND preffix != '' AND LOWER(preffix) = LOWER(?) ORDER BY id ASC LIMIT 1",
    [prefix]
  )
  return rows[0]?.id ?? null
}

/** 把原始字符串/数字转成有限数字，转不出来统一返回 null，不会把 NaN 带进后面的累加计算。 */
async function toNumber(raw) {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** 按 preffix 找开关类（f_type=1）配置。所有开关都有 preffix，不再需要 t_name LIKE 兜底。 */
async function findSwitchConfig(prefix) {
  const configId = await resolveConfigIdByPrefix(prefix)
  if (configId == null) return null
  const [rows] = await promisePool.query(
    `SELECT id, t_name, preffix, wire_template, wire_on_payload, wire_off_payload, f_type FROM t_direct_config
     WHERE id = ? AND f_type = '1' LIMIT 1`,
    [configId]
  )
  return rows[0] || null
}

/** 从这条上报消息里读出瞬时流量（field3，单位 L/min）。 */
async function readFlow(info) {
  const aliases = await resolveFieldAliases('t_sensor_data', FLOW_FIELD)
  const raw = firstValue(info, aliases)
  return toNumber(raw)
}

/** 关闭水泵和加热，并记录操作历史（quantity_shutdown）。 */
async function shutDown(deviceNo) {
  const mqttClient = require('../../mqtt')
  const targets = await Promise.all([
    findSwitchConfig('pump'),
    findSwitchConfig('heater'),
  ])
  let published = 0
  for (const conf of targets.filter(Boolean)) {
    try {
      const payload = buildSwitchPayload(conf, 'off')
      if (!systemConfig.getConfig().SINGLE_DEVICE_MODE && deviceNo) payload.d_no = deviceNo
      await mqttClient.publish(getTopic('control'), payload, { qos: systemConfig.getConfig().MQTT_QOS })
      const oldValue = await getDirectValue({ config_id: conf.id, d_no: deviceNo })
      await saveDirectData({ config_id: conf.id, value: 'off', d_no: deviceNo })
      await saveOperationHistory({ d_no: deviceNo, config_id: conf.id, old_value: oldValue, new_value: 'off', source: 'quantity_shutdown' })
      published++
      console.log(`[QuantityShutdown] 定量停机关闭 ${conf.t_name}，设备 ${deviceNo || '全局'}`)
    } catch (err) {
      console.error(`[QuantityShutdown] 关闭 ${conf.t_name} 失败:`, err.message)
    }
  }
  return published > 0
}

/**
 * 主评估：累计流量并判断是否定量停机。这是个简单的四阶段状态机，每个设备
 * 独立走自己的一份状态（flowAccumulator/shutdownDone/lastEnabled 三个 Map
 * 都按 deviceNo 存）：
 *   ① 关闭：定量停机开关是关的，什么都不做，只在"刚从开变成关"那一刻清零
 *      累计流量、解除停机锁定，为下次重新打开做准备。
 *   ② 开启：开关从关变成开的那一刻，清零累计流量、解除锁定，开始新一轮计量。
 *   ③ 累计中：开关一直开着、还没达到目标，每条消息读一次瞬时流量，按时间
 *      累加进 flowAccumulator。
 *   ④ 达标：累计流量到达目标值，关闭水泵和加热，并且把 shutdownDone 标记为
 *      true——这个标记会让后续所有消息在③直接被跳过，不会因为水泵关了、
 *      流量归零又重新开始计量，也不会来一条消息就重复下发一次关闭指令，
 *      直到用户把开关关掉再打开，才会回到②重新开始一轮。
 * @param {Object} info - 已解析的设备上报数据
 * @returns {Object|null} 本次评估结果（{deviceNo, accumulated, target, reached,
 *   shutdown?}），开关关闭、目标值无效时返回 null（代表这次不参与判断）
 */
async function evaluateQuantityShutdown(info) {
  const config = systemConfig.getConfig().QUANTITY_SHUTDOWN || {}
  const deviceNo = String((await resolveDeviceNo(info)) || '').trim() || null

  const wasEnabled = lastEnabled.get(deviceNo)
  lastEnabled.set(deviceNo, config.enabled === true)

  // 关闭定量停机：重置计量周期。
  if (config.enabled !== true) {
    if (wasEnabled === true) {
      flowAccumulator.set(deviceNo, 0)
      shutdownDone.set(deviceNo, false)
      console.log(`[QuantityShutdown] 设备 ${deviceNo || '全局'} 定量停机已关闭，计量周期重置`)
    }
    return null
  }

  // 指令中心优先 → 配置中心兜底 → 0（0 会被下面判定为无效，等于不启用定量停机）
  const target = await getNumberValue('total_flow_target', deviceNo, config.totalFlowTarget, 0)
  if (!Number.isFinite(target) || target <= 0) return null

  // 打开定量停机：开始新的计量周期。
  if (wasEnabled !== true) {
    flowAccumulator.set(deviceNo, 0)
    shutdownDone.set(deviceNo, false)
    console.log(`[QuantityShutdown] 设备 ${deviceNo || '全局'} 定量停机已开启，开始计量`)
  }

  // 已触发过停机，不再累计和重复下发。
  if (shutdownDone.get(deviceNo)) return null

  const flow = await readFlow(info)
  // 流量按 L/min 上报，近似按 1 秒采样间隔累加。
  if (flow != null && flow >= 0) {
    const prev = flowAccumulator.get(deviceNo) || 0
    flowAccumulator.set(deviceNo, prev + flow / 60)
  }

  const accumulated = flowAccumulator.get(deviceNo) || 0
  const result = { deviceNo, accumulated: Number(accumulated.toFixed(2)), target, reached: false }

  if (accumulated >= target) {
    shutdownDone.set(deviceNo, true)
    result.reached = true
    result.shutdown = await shutDown(deviceNo)
    console.log(`[QuantityShutdown] 设备 ${deviceNo || '全局'} 累计流量 ${accumulated.toFixed(2)}L ≥ 目标 ${target}L，执行停机`)
  }

  return result
}

module.exports = { evaluateQuantityShutdown }