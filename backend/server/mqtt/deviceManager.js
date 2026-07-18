/**
 * 设备管理器
 * 
 * 职责：
 * 1. 从数据库 t_device 表加载所有设备编号（以 number 字段为唯一标识）
 * 2. 跟踪设备在线/离线状态（基于心跳，10秒无心跳判定离线）
 * 3. 设备离线时暂存指令，上线后自动发送
 * 4. 设备上线时自动发送时间校准
 * 
 * 使用方式：
 *   const deviceManager = new DeviceManager(mqttClient)
 *   deviceManager.onHeartbeat('device001')  // 收到心跳时调用
 *   deviceManager.isOnline('device001')     // 检查设备是否在线
 *   deviceManager.addPendingCommand('device001', config_id, value)  // 暂存指令
 *   deviceManager.getAllDeviceStatus()      // 获取所有设备在线状态
 * 
 * 设备编号说明：
 *   - 设备以 t_device 表的 number 字段作为唯一标识
 *   - 如果 number 为 NULL 或空字符串，该设备不会被加载
 *   - 在设备管理页面添加设备时，必须填写设备编号
 *   - 只有数据库中已注册的设备才会被跟踪，测试数据不会显示
 */

const promisePool = require('../config/dbPool')
const { saveDirectData } = require('../service/directData/saveDirectConfig')
const systemConfig = require('../config/systemConfig')
const fs = require('fs')
const path = require('path')

const configIdMapping = {
  0: 'mode', 1: 'air', 2: 'fan', 3: 'speed_fan', 4: 'acMode',
  5: 'power_air', 6: 'TG', 7: 'TinDH', 8: 'TinDL', 9: 'led',
  10: 'LXD', 11: 'bright_led', 12: 'TBegin', 13: 'TEnd', 14: 'calibrate'
}

/** 动态读取超时配置，确保热更新立即生效。 */
function getOfflineTimeout() {
  const timeout = Number(systemConfig.getConfig().HEARTBEAT_TIMEOUT)
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 10000
}

class DeviceManager {
  /**
   * @param {Object} mqttClient - MqttClient 实例，用于发送指令
   */
  constructor(mqttClient) {
    this.mqttClient = mqttClient

    /** @type {Map<string, number>} 设备最后心跳时间戳 */
    this._lastHeartbeat = new Map()

    /** @type {Map<string, boolean>} 设备在线状态 */
    this._onlineStatus = new Map()

    /** @type {Map<string, NodeJS.Timeout>} 离线检测定时器 */
    this._offlineTimers = new Map()

    /** @type {Map<string, Array<{config_id: number, value: any}>>} 暂存指令队列 */
    this._pendingCommands = new Map()

    /** @type {Set<string>} 正在发送暂存指令的设备，避免心跳并发触发重复发送 */
    this._flushingDevices = new Set()

    this._pendingFile = process.env.PENDING_COMMANDS_FILE
      ? path.resolve(process.env.PENDING_COMMANDS_FILE)
      : path.join(__dirname, '../data/pending-commands.json')

    this._loadPendingCommands()

    /** @type {boolean} 是否已从数据库加载设备列表 */
    this._loaded = false

    // 启动时从数据库加载设备列表
    this._loadDevicesFromDB()
  }

  /**
   * 从数据库 t_device 表加载所有设备编号
   * 初始化所有设备为离线状态
   */
  async _loadDevicesFromDB() {
    try {
      const [rows] = await promisePool.query(
        'SELECT number FROM t_device WHERE number IS NOT NULL AND number != ""'
      )
      if (rows && rows.length > 0) {
        for (const row of rows) {
          const deviceId = String(row.number).trim()
          // 初始化设备为离线状态
          this._onlineStatus.set(deviceId, false)
        }
        console.log(`[DeviceManager] 从数据库加载了 ${rows.length} 个设备:`, rows.map(r => r.number).join(', '))
      } else {
        console.warn('[DeviceManager] 数据库 t_device 表中没有设备数据')
      }
      this._loaded = true
    } catch (err) {
      console.error('[DeviceManager] 从数据库加载设备列表失败:', err.message)
      this._loaded = true // 即使失败也标记为已加载，避免阻塞
    }
  }

  // ==================== 心跳与在线状态 ====================

  /**
   * 收到设备心跳时调用
   * 只有数据库中已注册的设备（t_device.number）才会被跟踪
   * @param {string} deviceId - 设备编号
   */
  onHeartbeat(deviceId) {
    if (!deviceId) return
    deviceId = String(deviceId).trim()

    // 只跟踪数据库中已注册的设备
    if (!this._onlineStatus.has(deviceId)) {
      return
    }

    const wasOffline = !this._onlineStatus.get(deviceId)
    const now = Date.now()

    // 更新心跳时间和在线状态
    this._lastHeartbeat.set(deviceId, now)
    this._onlineStatus.set(deviceId, true)

    // 重置离线检测定时器
    this._resetOfflineTimer(deviceId)

    // 设备从离线变为在线 -> 发送暂存指令和时间校准
    if (wasOffline) {
      console.log(`[DeviceManager] 设备 ${deviceId} 上线`)
      this._sendTimeCalibration(deviceId)
    }

    // 每次心跳都允许重试失败队列；并发保护会阻止重复发送。
    this._flushPendingCommands(deviceId)
  }

  /** 重置设备的离线检测定时器 */
  _resetOfflineTimer(deviceId) {
    if (this._offlineTimers.has(deviceId)) {
      clearTimeout(this._offlineTimers.get(deviceId))
    }
    this._offlineTimers.set(deviceId, setTimeout(() => {
      this._onlineStatus.set(deviceId, false)
      console.log(`[DeviceManager] 设备 ${deviceId} 离线（${getOfflineTimeout()/1000}秒无心跳）`)
      this._offlineTimers.delete(deviceId)
    }, getOfflineTimeout()))
  }

  /**
   * 检查设备是否在线
   * 基于最后心跳时间判断，不依赖定时器状态
   * @param {string} deviceId
   * @returns {boolean}
   */
  isOnline(deviceId) {
    deviceId = String(deviceId ?? '').trim()
    const lastBeat = this._lastHeartbeat.get(deviceId)
    if (!lastBeat) return false
    return (Date.now() - lastBeat) < getOfflineTimeout()
  }

  /** 设备 CRUD 后同步内存注册表，无需重启服务。 */
  registerDevice(deviceId) {
    const normalized = String(deviceId ?? '').trim()
    if (!normalized) return
    if (!this._onlineStatus.has(normalized)) {
      this._onlineStatus.set(normalized, false)
    }
  }

  removeDevice(deviceId) {
    const normalized = String(deviceId ?? '').trim()
    if (!normalized) return
    const timer = this._offlineTimers.get(normalized)
    if (timer) clearTimeout(timer)
    this._offlineTimers.delete(normalized)
    this._lastHeartbeat.delete(normalized)
    this._onlineStatus.delete(normalized)
    this._pendingCommands.delete(normalized)
    this._persistPendingCommands()
  }

  renameDevice(oldDeviceId, newDeviceId) {
    const oldId = String(oldDeviceId ?? '').trim()
    const newId = String(newDeviceId ?? '').trim()
    if (oldId === newId) {
      this.registerDevice(newId)
      return
    }
    this.removeDevice(oldId)
    this.registerDevice(newId)
  }

  /**
   * 获取所有已知设备的在线状态
   * 如果数据库尚未加载完成，返回空数组
   * @returns {Array<{deviceId: string, online: boolean}>}
   */
  getAllDeviceStatus() {
    // 数据库尚未加载完成时返回空数组
    if (!this._loaded) {
      return []
    }

    const statusList = []
    for (const [deviceId] of this._onlineStatus) {
      statusList.push({
        deviceId,
        online: this.isOnline(deviceId)
      })
    }
    return statusList
  }

  // ==================== 暂存指令 ====================

  /**
   * 设备离线时暂存指令，上线后自动发送
   * @param {string} deviceId
   * @param {number} configId
   * @param {*} value
   */
  addPendingCommand(deviceId, configId, value) {
    deviceId = String(deviceId ?? '').trim()
    if (!deviceId || deviceId === 'null') return

    if (!this._pendingCommands.has(deviceId)) {
      this._pendingCommands.set(deviceId, [])
    }
    // 同一配置只保留用户最后一次设置，避免设备上线后执行过期指令。
    const commands = this._pendingCommands.get(deviceId)
      .filter((item) => String(item.config_id) !== String(configId))
    commands.push({ config_id: configId, value })
    this._pendingCommands.set(deviceId, commands)
    this._persistPendingCommands()
    console.log(`[DeviceManager] 设备 ${deviceId} 指令暂存 (config_id=${configId})`)
  }

  _loadPendingCommands() {
    try {
      if (!fs.existsSync(this._pendingFile)) return
      const saved = JSON.parse(fs.readFileSync(this._pendingFile, 'utf8'))
      for (const [deviceId, commands] of Object.entries(saved)) {
        if (Array.isArray(commands) && commands.length > 0) {
          this._pendingCommands.set(deviceId, commands)
        }
      }
      console.log(`[DeviceManager] 已恢复 ${this._pendingCommands.size} 个设备的暂存指令`)
    } catch (err) {
      console.error('[DeviceManager] 恢复暂存指令失败:', err.message)
    }
  }

  _persistPendingCommands() {
    try {
      const content = Object.fromEntries(this._pendingCommands)
      fs.mkdirSync(path.dirname(this._pendingFile), { recursive: true })
      const tempFile = `${this._pendingFile}.tmp`
      fs.writeFileSync(tempFile, JSON.stringify(content, null, 2), 'utf8')
      fs.renameSync(tempFile, this._pendingFile)
    } catch (err) {
      console.error('[DeviceManager] 保存暂存指令失败:', err.message)
    }
  }

  /** 设备上线时发送所有暂存指令，发送成功后保存到数据库 */
  async _flushPendingCommands(deviceId) {
    const commands = this._pendingCommands.get(deviceId)
    if (!commands || commands.length === 0 || this._flushingDevices.has(deviceId)) return

    this._flushingDevices.add(deviceId)

    console.log(`[DeviceManager] 设备 ${deviceId} 上线，发送 ${commands.length} 条暂存指令（每条发送两次）`)
    try {
      for (const cmd of [...commands]) {
        const payload = await this._buildPayload(cmd.config_id, cmd.value)
        if (payload) {
          // 每条指令发送两次以确保设备可靠接收
          await this.mqttClient.publish('control', payload)
          await new Promise(resolve => setTimeout(resolve, 200))
          await this.mqttClient.publish('control', payload)

          // 发送成功后保存到数据库
          await saveDirectData({ config_id: cmd.config_id, value: cmd.value, d_no: deviceId })
          const remaining = (this._pendingCommands.get(deviceId) || []).filter(
            (item) => String(item.config_id) !== String(cmd.config_id)
          )
          if (remaining.length > 0) this._pendingCommands.set(deviceId, remaining)
          else this._pendingCommands.delete(deviceId)
          this._persistPendingCommands()
          console.log(`[DeviceManager] 暂存指令已发送并保存到数据库 (config_id=${cmd.config_id})`)
        }
      }
    } catch (err) {
      // 保留失败指令及其后的指令，等待下一次心跳或重连后重试。
      console.error(`[DeviceManager] 暂存指令处理失败，队列已保留:`, err.message)
    } finally {
      this._flushingDevices.delete(deviceId)
    }
  }

  // ==================== 时间校准 ====================

  /** 设备上线时发送当前北京时间校准 */
  async _sendTimeCalibration(deviceId) {
    const now = new Date()
    const bjOffset = 8 * 60
    const localOffset = now.getTimezoneOffset()
    const bjTime = new Date(now.getTime() + (bjOffset + localOffset) * 60000)

    const dayOfWeek = bjTime.getDay() === 0 ? 7 : bjTime.getDay()
    const y = bjTime.getFullYear()
    const m = String(bjTime.getMonth() + 1).padStart(2, '0')
    const d = String(bjTime.getDate()).padStart(2, '0')
    const h = String(bjTime.getHours()).padStart(2, '0')
    const min = String(bjTime.getMinutes()).padStart(2, '0')
    const s = String(bjTime.getSeconds()).padStart(2, '0')

    const timeStr = `${y}-${m}-${d}-${dayOfWeek} ${h}:${min}:${s}`
    const payload = { real: timeStr }

    try {
      // 时间校准发送两次以确保设备可靠接收
      await this.mqttClient.publish('control', payload)
      await new Promise(resolve => setTimeout(resolve, 200))
      await this.mqttClient.publish('control', payload)
      console.log(`[DeviceManager] 设备 ${deviceId} 时间校准已发送（两次）`)
    } catch (err) {
      console.error(`[DeviceManager] 时间校准发送失败:`, err.message)
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 根据 config_id 和 value 构建 MQTT 消息 payload
   * 所有值统一转为字符串，确保整体为 JSON 格式
   * @param {number} configId
   * @param {*} value
   * @returns {Object|null}
   */
  async _buildPayload(configId, value) {
    const [rows] = await promisePool.query(
      'SELECT preffix, f_type FROM t_direct_config WHERE id = ? LIMIT 1',
      [configId]
    )
    const propertyName = String(rows[0]?.preffix || '').trim() || configIdMapping[configId] || `unknown_${configId}`

    // 校准时间特殊处理
    if (Number(configId) === 14) {
      try {
        return typeof value === 'string' ? JSON.parse(value) : value
      } catch {
        return { [propertyName]: String(value) }
      }
    }

    // 开关类型值映射（on->open, off->close）
    const SWITCH_TYPES = [0, 1, 2, 4, 9]
    const VALUE_MAP = { on: 'open', off: 'close' }
    const isSwitch = String(rows[0]?.f_type) === '1' || SWITCH_TYPES.includes(Number(configId))
    const mappedValue = isSwitch && VALUE_MAP[value]
      ? VALUE_MAP[value]
      : String(value)

    return { [propertyName]: mappedValue }
  }

  /** 清理所有定时器 */
  cleanup() {
    for (const timer of this._offlineTimers.values()) {
      clearTimeout(timer)
    }
    this._offlineTimers.clear()
    this._lastHeartbeat.clear()
    this._onlineStatus.clear()
    this._pendingCommands.clear()
    this._flushingDevices.clear()
  }
}

module.exports = DeviceManager
