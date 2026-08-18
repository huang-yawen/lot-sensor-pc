/**
 * 【文件职责】处理单条控制指令：保存当前值、记录操作历史，并向在线设备发布；离线时
 * 交由 DeviceManager 暂存，等心跳恢复后补发。
 * 【配置中心关联】SINGLE_DEVICE_MODE 决定设备选择；MQTT_TOPICS.control 决定主题；
 * CONTROL_VALUE_MAP 决定布尔/枚举线上值。字段名来自 t_direct_config.preffix，
 * 不能在业务代码写死。
 *
 * 直接指令更新服务
 * 
 * 流程：
 * 1. 先通过 MQTT 发送指令到设备（或暂存等待上线后发送）
 * 2. 发送成功后再保存到数据库
 * 3. 如果设备离线，暂存指令等待上线后发送，发送成功后再保存到数据库
 * 
 * 使用方式：
 *   POST /api/directData/update
 *   Body: { config_id, value, d_no }
 * 
 * 模式说明：
 *   SINGLE_DEVICE_MODE = true  （单设备模式）
 *     - 整个系统只有一套设备
 *     - 前端不传 d_no，后端自动使用默认设备号
 *     - MQTT 消息中不携带 d_no（不传给底层设备）
 *     - 仍检查在线状态，离线暂存
 *   
 *   SINGLE_DEVICE_MODE = false （多设备模式）
 *     - 有多套设备
 *     - 前端传 d_no：null 为全局指令，设备号为单设备指令
 *     - MQTT 消息中携带 d_no
 *     - 检查在线状态，离线暂存
 */

const promisePool = require('../../config/dbPool')
const mqttClient = require('../../mqtt')
const { saveDirectData, getDirectValue } = require('./saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory/saveOperationHistory')
const systemConfig = require('../../config/systemConfig')
const { getTopic, buildSwitchPayload } = require('../../utils/protocol')

// ============================================================
// 【模式切换变量】SINGLE_DEVICE_MODE
// ============================================================
// 从 .env 环境变量读取，修改 server/.env 中的 SINGLE_DEVICE_MODE 即可全局生效
// true  - 单设备模式（默认）
// false - 多设备模式
// ============================================================
const isSingleDeviceMode = () => systemConfig.getConfig().SINGLE_DEVICE_MODE === true

/** 单设备模式下的默认设备编号（从 t_device 表获取的第一个设备） */
const DEFAULT_DEVICE_ID = null // 将在启动时从数据库加载

/**
 * 构建 MQTT 消息 payload。
 * 开关类指令（f_type=1）走 buildSwitchPayload：配置了 wire_template 就整体下发那个
 * 自定义协议报文（如 Modbus 透传），只替换其中 crc 字段；没配置就退回
 * { [preffix]: 线上值 }。
 * 非开关指令如果没配置 preffix（比如流量/压力阈值这类只在本地使用的参考值），
 * 说明它不需要下发给设备，返回 null，调用方据此跳过 MQTT 发送、直接保存数据库。
 * @param {number} configId
 * @param {*} value
 * @returns {Object|null}
 */
async function buildPayload(configId, value) {
  const [rows] = await promisePool.query(
    'SELECT preffix, f_type, t_name, wire_template, wire_on_payload, wire_off_payload FROM t_direct_config WHERE id = ? LIMIT 1',
    [configId]
  )
  if (!rows.length) throw new Error(`指令配置 ID ${configId} 不存在`)

  const config = rows[0]

  // 只按数据库控件类型判断开关，不再使用旧项目的硬编码 ID。
  if (String(config.f_type) === '1') {
    return buildSwitchPayload(config, value)
  }

  const key = String(config.preffix || '').trim()
  if (!key) return null

  return { [key]: String(value) }
}

/**
 * 处理指令更新请求
 * POST /directData/update
 * 
 * 流程：先发消息（或暂存），成功后再保存到数据库
 */
/**
 * 获取单设备模式下的默认设备编号
 * 从 t_device 表查询第一个设备的 number
 */
async function getDefaultDeviceId() {
  try {
    const [rows] = await promisePool.query(
      'SELECT `number` FROM `t_device` ORDER BY `id` ASC LIMIT 1'
    )
    if (rows && rows.length > 0) {
      return String(rows[0].number).trim()
    }
  } catch (err) {
    console.error('[DirectUpdate] 查询默认设备编号失败:', err.message)
  }
  return null
}

module.exports = async (req, res) => {
  try {
    const { config_id, value, d_no } = req.body

    // 参数校验
    if (config_id === undefined || config_id === null || config_id === '') {
      return res.status(400).json({ success: false, message: 'config_id 必填' })
    }

    const singleDeviceMode = isSingleDeviceMode()
    console.log('[DirectUpdate] 收到指令:', { config_id, value, d_no, mode: singleDeviceMode ? '单设备' : '多设备' })

    // 1. 构建 MQTT 消息
    const payload = await buildPayload(config_id, value)

    // 2. 确定目标设备编号
    let deviceId = null

    if (singleDeviceMode) {
      // ========== 单设备模式 ==========
      // 从数据库获取默认设备编号
      deviceId = await getDefaultDeviceId()
      console.log(`[DirectUpdate] 单设备模式，默认设备编号: ${deviceId}`)
      // MQTT 消息中不携带 d_no（不传给底层设备）
    } else {
      // ========== 多设备模式 ==========
      deviceId = d_no && d_no !== 'null' && d_no !== 'undefined' ? String(d_no).trim() : null
      console.log(`[DirectUpdate] 多设备模式，设备编号: ${deviceId}`)
      // MQTT 消息中携带 d_no（传给底层设备）
      // 全局指令也传 d_no: null，让底层设备明确知道这是全局指令
      if (payload) payload.d_no = deviceId
    }

    // 2.5 没有配置 MQTT 字段的指令（如阈值类参考值）只在本地保存，不下发设备。
    if (payload === null) {
      const saveDNo = singleDeviceMode ? deviceId : d_no
      const oldValue = await getDirectValue({ config_id, d_no: saveDNo })
      const saveResult = await saveDirectData({ config_id, value, d_no: saveDNo })
      console.log('[DirectUpdate] 本地配置保存成功（未配置 MQTT 字段，不下发）:', saveResult)

      const historyResult = await saveOperationHistory({
        d_no: deviceId || saveDNo,
        config_id: Number(config_id),
        old_value: oldValue,
        new_value: String(value),
        source: 'manual'
      })

      return res.json({
        success: true,
        message: '本地配置已保存（未配置 MQTT 字段，不下发设备）',
        data: { db: saveResult, status: 'saved_local', history: historyResult }
      })
    }

    // 3. 检查设备在线状态
    if (deviceId) {
      const isAlive = mqttClient.checkIfAlive(deviceId)
      console.log(`[DirectUpdate] 设备 ${deviceId} 在线状态: ${isAlive}`)
      if (!isAlive) {
        // 设备离线 -> 暂存指令（不保存到数据库，等上线发送成功后再保存）
        console.log(`[DirectUpdate] 设备 ${deviceId} 离线，指令暂存`)
        mqttClient.addPendingCommand(deviceId, config_id, value)

        return res.json({
          success: true,
          message: '设备离线，指令已暂存，将在上线后自动发送并保存',
          data: { status: 'queued' }
        })
      }
    } else {
      // 无指定设备（全局配置）-> 直接发送，不检查在线状态
      console.log('[DirectUpdate] 全局配置，直接发送')
    }

    // 4. 设备在线 -> 先发送指令（发送两次以确保设备可靠接收）
    try {
      // 第一次发送
      const firstPublish = await mqttClient.publish(getTopic('control'), payload)
      if (firstPublish.status !== 'published') {
        throw new Error(`MQTT 第一次发送未成功: ${firstPublish.status}`)
      }
      console.log('[DirectUpdate] MQTT 第一次发送成功')

      // 第二次发送（间隔 200ms，确保设备可靠接收）
      await new Promise(resolve => setTimeout(resolve, 200))
      const secondPublish = await mqttClient.publish(getTopic('control'), payload)
      if (secondPublish.status !== 'published') {
        throw new Error(`MQTT 第二次发送未成功: ${secondPublish.status}`)
      }
      console.log('[DirectUpdate] MQTT 第二次发送成功')

      // 5. 发送成功后再保存到数据库
      // 单设备模式：保存时传入设备号，保存为设备专属配置
      // 多设备模式：保存时传入原始 d_no（null=全局，设备号=设备专属）
      const saveDNo = singleDeviceMode ? deviceId : d_no
      const oldValue = await getDirectValue({ config_id, d_no: saveDNo })
      const saveResult = await saveDirectData({ config_id, value, d_no: saveDNo })
      console.log('[DirectUpdate] 数据库保存成功:', saveResult)

      // 记录操作历史（手动指令下发）
      // 只存 config_id + new_value，操作名称和值含义通过 JOIN t_direct_config 获取
      const historyResult = await saveOperationHistory({
        d_no: deviceId || saveDNo,
        config_id: Number(config_id),
        old_value: oldValue,
        new_value: String(value),
        source: 'manual'
      })

      const historyMessage = historyResult.skipped
        ? '指令已发送并保存；当前配置不记录软件操作历史'
        : historyResult.success
          ? '指令已发送、保存并记录操作历史'
          : '指令已发送并保存，但操作历史记录失败'
      return res.json({
        success: true,
        message: historyMessage,
        data: { db: saveResult, status: 'published', history: historyResult }
      })
    } catch (err) {
      console.error('[DirectUpdate] MQTT 发送失败:', err.message)
      return res.status(503).json({
        success: false,
        message: 'MQTT 发送失败，指令未保存到数据库',
        data: { status: 'failed', error: err.message }
      })
    }

  } catch (err) {
    console.error('[DirectUpdate] 服务器错误:', err)
    return res.status(500).json({
      success: false,
      message: err.message || '处理指令失败'
    })
  }
}
