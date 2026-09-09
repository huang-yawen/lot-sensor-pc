/**
 * 【文件职责】定温停机服务。
 *
 * 设定一个出水温度阈值（shutdownTemp，单位 ℃），当出水温度 >= 该阈值时，
 * 关闭水泵和加热，整套系统自动停机，完成定温换热。
 *
 * 与定量停机（quantityShutdown）对称：一个按温度、一个按流量，两条独立的停机保护。
 * 每条消息都读一次出水温度判断；不累计、不积分，达到阈值即刻停机。
 *
 * 指令中心没有独立的 shutdown_temp_enabled 开关，靠 shutdown_temp 值 > 0 自动启用。
 * 指令中心 preffix=shutdown_temp，删掉后退回配置中心兜底值。
 *
 * 【配置】TEMP_SHUTDOWN 见对应 config.js。
 */

// ========== 赛场速改索引（要改什么 → 去哪） ==========
//  关掉定温停机     指令页面把 shutdown_temp 设为 0 或空；或 config.js enabled=false
//  改停机温度(℃)   指令页面 shutdown_temp；兜底 config.js shutdownTemp
//  判定逻辑         evaluateTempShutdown() 约 L82
//  到温后关泵关热   shutDown() 约 L62
// ===================================================

const CONFIG = require('./config')
const { SINGLE_DEVICE_MODE } = require('../../config/appSettings')
const { MQTT_QOS } = require('../../config/mqtt')
const promisePool = require('../../config/dbPool')
const { firstValue, getTopic, buildSwitchPayload } = require('../../utils/protocol')
const { resolveDeviceNo, resolveFieldAliases } = require('../../utils/mappedData')
const { getDirectValue, saveDirectData } = require('../directData/saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory')
// 读指令中心 shutdown_temp 数值（指令项优先，配置中心兜底）。
const { getNumberValue } = require('../controlShared/controlHelpers')

/** 出水温度字段槽位（与 SENSOR_FIELD_MAP.temp2 对齐，即 field2）。 */
const TEMP_OUT_FIELD = 'field2'

/** 每个设备是否已因定温停机触发（避免反复发送关闭指令）。 */
const shutdownDone = new Map()

/** 每个设备上一次评估时是否处于停机锁定（用于识别外部复位后重新启用）。 */
const lastEnabled = new Map()

/** 把原始字符串/数字转成有限数字，转不出来统一返回 null。 */
async function toNumber(raw) {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** 按 preffix 精确查 t_direct_config 的 id，查不到返回 null。 */
async function resolveConfigIdByPrefix(prefix) {
  if (!prefix) return null
  const [rows] = await promisePool.query(
    "SELECT id FROM t_direct_config WHERE preffix IS NOT NULL AND preffix != '' AND LOWER(preffix) = LOWER(?) ORDER BY id ASC LIMIT 1",
    [prefix]
  )
  return rows[0]?.id ?? null
}

/** 按 preffix 找开关类（f_type=1）配置。 */
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

/** 从这条上报消息里读出出水温度（field2，单位 ℃）。 */
async function readTempOut(info) {
  const aliases = await resolveFieldAliases('t_sensor_data', TEMP_OUT_FIELD)
  const raw = firstValue(info, aliases)
  return toNumber(raw)
}

/** 关闭水泵和加热，并记录操作历史（temp_shutdown）。 */
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
      if (!SINGLE_DEVICE_MODE && deviceNo) payload.d_no = deviceNo
      await mqttClient.publish(getTopic('control'), payload, { qos: MQTT_QOS })
      const oldValue = await getDirectValue({ config_id: conf.id, d_no: deviceNo })
      await saveDirectData({ config_id: conf.id, value: 'off', d_no: deviceNo })
      await saveOperationHistory({ d_no: deviceNo, config_id: conf.id, old_value: oldValue, new_value: 'off', source: 'temp_shutdown' })
      published++
      console.log(`[TempShutdown] 定温停机关闭 ${conf.t_name}，设备 ${deviceNo || '全局'}`)
    } catch (err) {
      console.error(`[TempShutdown] 关闭 ${conf.t_name} 失败:`, err.message)
    }
  }
  return published > 0
}

/**
 * 主评估：读出水温度并判断是否达到定温停机阈值。
 *
 * 这是个简单的状态机，每个设备独立走自己的一份状态（shutdownDone 按 deviceNo 存）：
 *   ① 未启用：shutdown_temp 值无效（<=0 或未配置），什么都不做。
 *   ② 监测中：shutdown_temp > 0，每条消息读一次出水温度，与阈值比较。
 *   ③ 达标：出水温度 >= 阈值，关闭水泵和加热，shutdownDone 标记为 true——
 *      后续消息直接跳过，不会重复下发关闭指令。等用户把 shutdown_temp
 *      调到 <= 0 再调回去，或者复位故障状态后，shutdownDone 才会清除，
 *      重新回到②继续监测。
 *
 * @param {Object} info - 已解析的设备上报数据
 * @returns {Object|null} 本次评估结果（{deviceNo, tempOut, target, reached, shutdown}），
 *   未启用、阈值无效、温度读不到时返回 null
 */
async function evaluateTempShutdown(info) {
  const deviceNo = String((await resolveDeviceNo(info)) || '').trim() || null

  // 指令中心优先 → 配置中心兜底 → 0（0 会被下面判定为无效，等于不启用）
  const target = await getNumberValue('shutdown_temp', deviceNo, CONFIG.shutdownTemp, 0)
  if (!Number.isFinite(target) || target <= 0) return null

  const wasEnabled = lastEnabled.get(deviceNo)
  lastEnabled.set(deviceNo, true)

  // 刚从禁用变成启用：清除停机锁定，开始新一轮监测。
  if (wasEnabled !== true) {
    shutdownDone.set(deviceNo, false)
    console.log(`[TempShutdown] 设备 ${deviceNo || '全局'} 定温停机已启用，阈值 ${target}℃`)
  }

  // 已触发过停机，不再重复下发。
  if (shutdownDone.get(deviceNo)) return null

  const tempOut = await readTempOut(info)
  if (tempOut == null) return null

  const result = { deviceNo, tempOut: Number(tempOut.toFixed(2)), target, reached: false }

  if (tempOut >= target) {
    shutdownDone.set(deviceNo, true)
    result.reached = true
    result.shutdown = await shutDown(deviceNo)
    console.log(`[TempShutdown] 设备 ${deviceNo || '全局'} 出水温度 ${tempOut.toFixed(2)}℃ ≥ 阈值 ${target}℃，执行停机`)
  }

  return result
}

module.exports = { evaluateTempShutdown }
