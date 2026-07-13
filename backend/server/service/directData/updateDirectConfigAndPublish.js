/**
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
const { saveDirectData } = require('./saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory/saveOperationHistory')

// ============================================================
// 【模式切换变量】SINGLE_DEVICE_MODE
// ============================================================
// 从 .env 环境变量读取，修改 server/.env 中的 SINGLE_DEVICE_MODE 即可全局生效
// true  - 单设备模式（默认）
// false - 多设备模式
// ============================================================
const SINGLE_DEVICE_MODE = process.env.SINGLE_DEVICE_MODE === 'true'

/** 单设备模式下的默认设备编号（从 t_device 表获取的第一个设备） */
const DEFAULT_DEVICE_ID = null // 将在启动时从数据库加载

/** config_id 到 MQTT 属性名的映射 */
const CONFIG_MAP = {
  0: 'mode', 1: 'air', 2: 'fan', 3: 'speed_fan', 4: 'acMode',
  5: 'power_air', 6: 'TG', 7: 'TinDH', 8: 'TinDL', 9: 'led',
  10: 'LXD', 11: 'bright_led', 12: 'TBegin', 13: 'TEnd', 14: 'calibrate'
}

/** 开关类型的 config_id 列表（值需要映射 on->open, off->close） */
const SWITCH_IDS = [0, 1, 2, 4, 9]

/** 开关值映射 */
const SWITCH_MAP = { on: 'open', off: 'close' }

/**
 * 构建 MQTT 消息 payload
 * 所有值统一转为字符串，确保整体为 JSON 格式
 * @param {number} configId
 * @param {*} value
 * @returns {Object}
 */
function buildPayload(configId, value) {
  const key = CONFIG_MAP[configId] || `unknown_${configId}`

  // 校准时间特殊处理：value 是 JSON 字符串
  if (Number(configId) === 14) {
    try {
      return typeof value === 'string' ? JSON.parse(value) : value
    } catch {
      return { [key]: String(value) }
    }
  }

  // 开关类型值映射（on->open, off->close）
  const mappedValue = SWITCH_IDS.includes(Number(configId)) && SWITCH_MAP[value]
    ? SWITCH_MAP[value]
    : String(value)

  return { [key]: mappedValue }
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

    console.log('[DirectUpdate] 收到指令:', { config_id, value, d_no, mode: SINGLE_DEVICE_MODE ? '单设备' : '多设备' })

    // 1. 构建 MQTT 消息
    const payload = buildPayload(config_id, value)

    // 2. 确定目标设备编号
    let deviceId = null

    if (SINGLE_DEVICE_MODE) {
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
      payload.d_no = deviceId
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
      await mqttClient.publish('control', payload)
      console.log('[DirectUpdate] MQTT 第一次发送成功')

      // 第二次发送（间隔 200ms，确保设备可靠接收）
      await new Promise(resolve => setTimeout(resolve, 200))
      await mqttClient.publish('control', payload)
      console.log('[DirectUpdate] MQTT 第二次发送成功')

      // 5. 发送成功后再保存到数据库
      // 单设备模式：保存时传入设备号，保存为设备专属配置
      // 多设备模式：保存时传入原始 d_no（null=全局，设备号=设备专属）
      const saveDNo = SINGLE_DEVICE_MODE ? deviceId : d_no
      const saveResult = await saveDirectData({ config_id, value, d_no: saveDNo })
      console.log('[DirectUpdate] 数据库保存成功:', saveResult)

      // 记录操作历史（手动指令下发）
      // 只存 config_id + new_value，操作名称和值含义通过 JOIN t_direct_config 获取
      await saveOperationHistory({
        d_no: deviceId || saveDNo,
        config_id: Number(config_id),
        new_value: String(value),
        source: 'manual'
      })

      return res.json({
        success: true,
        message: '指令已发送并保存到数据库（已发送两次以确保接收）',
        data: { db: saveResult, status: 'published' }
      })
    } catch (err) {
      console.error('[DirectUpdate] MQTT 发送失败:', err.message)
      return res.json({
        success: true,
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
