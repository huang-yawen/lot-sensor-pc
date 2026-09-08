/**
 * 【文件职责】设备在线状态与离线指令队列管理器。
 * 
 * 职责：
 * 1. 从数据库 t_device 表加载所有设备编号（以 number 字段为唯一标识）
 * 2. 跟踪设备在线/离线状态（基于心跳，10秒无心跳判定离线）
 * 3. 设备离线时暂存指令，上线后自动发送
 *
 * 使用方式：
 *   const deviceManager = new DeviceManager(mqttClient)
 *   deviceManager.onHeartbeat('device001')  // 收到心跳时调用
 *   deviceManager.isOnline('device001')     // 检查设备是否在线
 *   deviceManager.addPendingCommand('device001', config_id, value)  // 暂存指令
 *   deviceManager.getAllDeviceStatus()      // 获取所有设备在线状态
 * 
 * 【配置】HEARTBEAT_TIMEOUT 决定离线阈值；MQTT_TOPICS.control、
 * CONTROL_VALUE_MAP 与 t_direct_config.preffix 决定补发消息内容；每次检查或发送
 * 都重新读取，因此保存配置中心后会立即影响后续行为。
 *
 * 设备编号说明：
 *   - MQTT 心跳/上报数据里的编号要跟 t_device.number 匹配才认得出是哪台设备
 *   - 但在线状态、暂存指令这些内部都用 t_device.d_no 记录（d_no 没填就用 number
 *     顶替），跟 t_sensor_data/t_behavior_data/t_direct 等业务表保持同一套编号
 *   - 如果 number 为 NULL 或空字符串，该设备不会被加载
 *   - 在设备管理页面添加设备时，必须填写设备编号
 *   - 只有数据库中已注册的设备才会被跟踪，测试数据不会显示
 */

const promisePool = require('../config/dbPool')
const { saveDirectData, getDirectValue } = require('../service/directData/saveDirectConfig')
const { saveOperationHistory } = require('../service/operationHistory/saveOperationHistory')
const { HEARTBEAT_TIMEOUT } = require('../config/mqtt')
const fs = require('fs')
const path = require('path')
const { getTopic, buildSwitchPayload } = require('../utils/protocol')

/** 设备多久没收到心跳判离线（毫秒），见 config/mqtt.js。 */
function getOfflineTimeout() {
  const timeout = Number(HEARTBEAT_TIMEOUT)
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

    /** @type {Map<string, {id: number|null, deviceName: string, deviceNumber: string, displayId: string, issue: string}>} 数据库设备元数据 */
    this._deviceMeta = new Map()

    /** @type {Map<string, NodeJS.Timeout>} 离线检测定时器 */
    this._offlineTimers = new Map()

    /** @type {Map<string, Array<{config_id: number, value: any}>>} 暂存指令队列 */
    this._pendingCommands = new Map()

    /** @type {Set<string>} 正在发送暂存指令的设备，避免心跳并发触发重复发送 */
    this._flushingDevices = new Set()

    // 暂存指令会写入这个文件，不只存内存里的 _pendingCommands。这样即使后端服务
    // 重启（更新代码、意外崩溃），下次启动时 _loadPendingCommands 也能把没发完的
    // 指令重新读回内存，继续等设备上线后发送。
    this._pendingFile = process.env.PENDING_COMMANDS_FILE
      ? path.resolve(process.env.PENDING_COMMANDS_FILE)
      : path.join(__dirname, '../data/pending-commands.json')

    this._loadPendingCommands()

    /** @type {boolean} 是否已从数据库加载设备列表 */
    this._loaded = false

    this._syncingDevices = false
    this._syncTimer = null

    // 启动时加载，并持续与 t_device 同步。数据库晚于后端启动时也能自动恢复。
    this.refreshDevicesFromDB()
    this._syncTimer = setInterval(() => this.refreshDevicesFromDB(), 15000)
    this._syncTimer.unref?.()
  }

  /**
   * 从数据库 t_device 表加载所有设备编号
   * 初始化所有设备为离线状态
   */
  async refreshDevicesFromDB() {
    if (this._syncingDevices) return
    this._syncingDevices = true
    try {
      const [rows] = await promisePool.query(
        `SELECT id, TRIM(number) AS number, TRIM(d_no) AS d_no, device_name
         FROM t_device
         ORDER BY id ASC`
      )

      const databaseKeys = new Set()
      const seenNumbers = new Set()
      const seenDNos = new Set()
      for (const row of rows || []) {
        const rowId = Number.isInteger(Number(row.id)) ? Number(row.id) : null
        const deviceNumber = String(row.number || '').trim()
        // d_no 没填时用 number 顶替，跟 utils/mappedData.js 的 resolveDNoByNumber
        // 用同一套兜底规则，两边才能算出同一个编号。
        const dNo = String(row.d_no || '').trim() || deviceNumber
        let trackingKey = dNo
        let displayId = dNo
        let issue = ''

        if (!deviceNumber) {
          trackingKey = `__missing_number__:${rowId ?? databaseKeys.size}`
          displayId = `未配置编号（ID: ${rowId ?? '?'}）`
          issue = 't_device.number 为空，无法匹配 MQTT 心跳'
          console.warn(`[DeviceManager] t_device.id=${rowId ?? '?'} 未配置 number，将显示为离线`)
        } else if (seenNumbers.has(deviceNumber)) {
          trackingKey = `__duplicate_number__:${rowId ?? databaseKeys.size}`
          displayId = `${deviceNumber}（重复，ID: ${rowId ?? '?'}）`
          issue = '设备编号重复，无法独立匹配 MQTT 心跳'
          console.warn(`[DeviceManager] t_device 存在重复设备编号: ${deviceNumber} (id=${rowId ?? '?'})`)
        } else if (seenDNos.has(dNo)) {
          trackingKey = `__duplicate_dno__:${rowId ?? databaseKeys.size}`
          displayId = `${dNo}（内部编号重复，ID: ${rowId ?? '?'}）`
          issue = '内部编号（d_no）重复，无法独立跟踪在线状态'
          console.warn(`[DeviceManager] t_device 存在重复内部编号: ${dNo} (id=${rowId ?? '?'})`)
          seenNumbers.add(deviceNumber)
        } else {
          seenNumbers.add(deviceNumber)
          seenDNos.add(dNo)
        }

        databaseKeys.add(trackingKey)
        if (!this._onlineStatus.has(trackingKey)) this._onlineStatus.set(trackingKey, false)
        this._deviceMeta.set(trackingKey, {
          id: rowId,
          deviceName: String(row.device_name || '').trim(),
          deviceNumber,
          dNo,
          displayId,
          issue,
        })
      }

      // 直接在数据库中删除的设备也要从在线状态中移除。
      for (const trackingKey of [...this._onlineStatus.keys()]) {
        if (!databaseKeys.has(trackingKey)) this.removeDevice(trackingKey)
      }

      if (databaseKeys.size > 0) {
        console.log(`[DeviceManager] 已从 t_device 同步 ${databaseKeys.size} 条设备记录`)
      } else {
        console.warn('[DeviceManager] 数据库 t_device 表中没有设备数据')
      }
      this._loaded = true
    } catch (err) {
      // 保留上一次成功同步的状态，下一轮自动重试。
      console.error('[DeviceManager] 同步设备列表失败，15 秒后重试:', err.message)
    } finally {
      this._syncingDevices = false
    }
  }

  /** 首次接口/WebSocket 响应前等待正在进行的 t_device 同步，避免短暂误报空列表。 */
  async waitForDeviceSync(timeoutMs = 15000) {
    if (!this._loaded && !this._syncingDevices) this.refreshDevicesFromDB()
    const deadline = Date.now() + timeoutMs
    while (this._syncingDevices && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return this._loaded
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

    // 设备从离线变为在线 -> 发送暂存指令
    if (wasOffline) {
      console.log(`[DeviceManager] 设备 ${deviceId} 上线`)
    }

    // 每次心跳都允许重试失败队列；并发保护会阻止重复发送。
    this._flushPendingCommands(deviceId)
  }

  // 每次收到心跳就重置这个设备对应的定时器；定时器到点自动触发，把设备标记为离线。
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
   * 直接用"当前时间 - 最后心跳时间"和超时阈值比较，不依赖 _onlineStatus 这个由
   * 定时器维护的标记。
   * @param {string} deviceId
   * @returns {boolean}
   */
  isOnline(deviceId) {
    deviceId = String(deviceId ?? '').trim()
    const lastBeat = this._lastHeartbeat.get(deviceId)
    if (!lastBeat) return false
    return (Date.now() - lastBeat) < getOfflineTimeout()
  }

  /**
   * 设备 CRUD 后同步内存注册表，无需重启服务。
   * @param {string} deviceId - 设备的 d_no（内存里的跟踪 key）
   * @param {Object} metadata - 可附带 deviceNumber（对应 t_device.number，MQTT 心跳识别用）
   */
  registerDevice(deviceId, metadata = {}) {
    const normalized = String(deviceId ?? '').trim()
    if (!normalized) return
    if (!this._onlineStatus.has(normalized)) {
      this._onlineStatus.set(normalized, false)
    }
    const existing = this._deviceMeta.get(normalized)
    this._deviceMeta.set(normalized, {
      id: Number.isInteger(Number(metadata.id)) ? Number(metadata.id) : (existing?.id ?? null),
      deviceName: String(metadata.deviceName ?? existing?.deviceName ?? '').trim(),
      deviceNumber: String(metadata.deviceNumber ?? existing?.deviceNumber ?? normalized).trim(),
      dNo: normalized,
      displayId: normalized,
      issue: '',
    })
    this._loaded = true
  }

  /**
   * 从跟踪表里彻底移除一个设备：数据库里被删掉的设备、或者重复编号产生的
   * 占位 key（见 refreshDevicesFromDB 里 __missing_number__/__duplicate_number__
   * 这类临时 key）需要清理时调用。清掉心跳记录、离线定时器、元数据、暂存
   * 指令，并把暂存指令的变化落盘，避免磁盘上残留一份指向已删除设备的指令。
   */
  removeDevice(deviceId) {
    const normalized = String(deviceId ?? '').trim()
    if (!normalized) return
    const timer = this._offlineTimers.get(normalized)
    if (timer) clearTimeout(timer)
    this._offlineTimers.delete(normalized)
    this._lastHeartbeat.delete(normalized)
    this._onlineStatus.delete(normalized)
    this._deviceMeta.delete(normalized)
    this._pendingCommands.delete(normalized)
    this._persistPendingCommands()
  }

  /**
   * 给设备改编号（比如设备管理页面修改了 d_no）：新旧编号相同就只是刷新一下
   * 元数据；不同的话要先彻底移除旧编号的跟踪记录，再用新编号重新注册——
   * 不能只改 key 不清理，否则内存里会同时留着新旧两份记录，造成状态混乱
   * （旧编号的心跳/离线定时器还在跑，但已经没有意义了）。
   */
  renameDevice(oldDeviceId, newDeviceId, metadata = {}) {
    const oldId = String(oldDeviceId ?? '').trim()
    const newId = String(newDeviceId ?? '').trim()
    if (oldId === newId) {
      this.registerDevice(newId, metadata)
      return
    }
    this.removeDevice(oldId)
    this.registerDevice(newId, metadata)
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

    return [...this._onlineStatus.keys()]
      .sort((left, right) => {
        const leftId = this._deviceMeta.get(left)?.id
        const rightId = this._deviceMeta.get(right)?.id
        if (leftId != null && rightId != null && leftId !== rightId) return leftId - rightId
        return left.localeCompare(right, 'zh-CN', { numeric: true })
      })
      .map((deviceId) => ({
        deviceId: this._deviceMeta.get(deviceId)?.displayId || deviceId,
        deviceNumber: this._deviceMeta.get(deviceId)?.deviceNumber || '',
        deviceName: this._deviceMeta.get(deviceId)?.deviceName || '',
        configured: !this._deviceMeta.get(deviceId)?.issue,
        issue: this._deviceMeta.get(deviceId)?.issue || '',
        online: !this._deviceMeta.get(deviceId)?.issue && this.isOnline(deviceId),
      }))
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
    // 同一配置只保留用户最后一次设置，避免设备上线后执行过期指令：比如设备离线期间
    // 用户先点了"开水泵"又改主意点了"关水泵"，暂存队列里不应该把这两条都存下来
    // 排队执行（那样上线后会先开再关，用户实际想要的只是最终状态"关"），
    // 所以新指令进来时把同一个 config_id 的旧指令直接顶替掉。
    const commands = this._pendingCommands.get(deviceId)
      .filter((item) => String(item.config_id) !== String(configId))
    commands.push({ config_id: configId, value })
    this._pendingCommands.set(deviceId, commands)
    this._persistPendingCommands()
    console.log(`[DeviceManager] 设备 ${deviceId} 指令暂存 (config_id=${configId})`)
  }

  /**
   * 服务启动时从磁盘读回上次没发完的暂存指令，接上继续等设备上线后发送
   * （对应构造函数里 this._loadPendingCommands() 的调用，文件头部有"为什么
   * 要落盘"的说明：后端重启不能让还没送达设备的指令凭空消失）。文件不存在
   * （第一次启动）或者解析失败都直接忽略，不影响正常启动流程。
   */
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

  /**
   * 把当前内存里的暂存指令整个写回磁盘。先写到一个 .tmp 临时文件，写成功后
   * 再用 rename 做原子替换——不直接覆盖正式文件，是为了防止"正好写到一半
   * 进程被杀掉"这种情况：如果直接写正式文件，半截的 JSON 在下次启动时会
   * 解析失败，暂存指令就全部丢了；先写临时文件再 rename，要么这次写入完全
   * 没发生（正式文件保持上一次的完整内容），要么完全生效，不会有"写一半"
   * 的中间状态。
   */
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
    // _flushingDevices 用来标记"这个设备正在发送暂存指令"：设备心跳可能一秒内
    // 连续上报好几次，每次都会调 _flushPendingCommands，有这个标记后，上一轮
    // 发送还没跑完时，新触发的调用会直接跳过，不会重复发送。
    if (!commands || commands.length === 0 || this._flushingDevices.has(deviceId)) return

    this._flushingDevices.add(deviceId)

    console.log(`[DeviceManager] 设备 ${deviceId} 上线，发送 ${commands.length} 条暂存指令（每条发送两次）`)
    try {
      for (const cmd of [...commands]) {
        const payload = await this._buildPayload(cmd.config_id, cmd.value)
        const oldValue = await getDirectValue({ config_id: cmd.config_id, d_no: deviceId })
        // payload 为 null 说明这条指令没配置 MQTT 字段（本地专用值），跳过下发直接保存。
        if (payload) {
          // 每条指令发送两次以确保设备可靠接收
          await this.mqttClient.publish(getTopic('control'), payload)
          await new Promise(resolve => setTimeout(resolve, 200))
          await this.mqttClient.publish(getTopic('control'), payload)
        }

        // 发送成功后保存到数据库
        await saveDirectData({ config_id: cmd.config_id, value: cmd.value, d_no: deviceId })
        const historyResult = await saveOperationHistory({
          d_no: deviceId,
          config_id: Number(cmd.config_id),
          old_value: oldValue,
          new_value: cmd.value,
          source: 'manual_queued'
        })
        if (!historyResult.success) {
          console.error(`[DeviceManager] 离线补发历史记录失败 (config_id=${cmd.config_id}):`, historyResult.error)
        }
        const remaining = (this._pendingCommands.get(deviceId) || []).filter(
          (item) => String(item.config_id) !== String(cmd.config_id)
        )
        if (remaining.length > 0) this._pendingCommands.set(deviceId, remaining)
        else this._pendingCommands.delete(deviceId)
        this._persistPendingCommands()
        console.log(`[DeviceManager] 暂存指令已发送并保存到数据库 (config_id=${cmd.config_id})`)
      }
      this.mqttClient.emit('pendingCommandsFlushed', {
        deviceId,
        count: commands.length,
      })
    } catch (err) {
      // 保留失败指令及其后的指令，等待下一次心跳或重连后重试。
      console.error(`[DeviceManager] 暂存指令处理失败，队列已保留:`, err.message)
    } finally {
      this._flushingDevices.delete(deviceId)
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
      'SELECT preffix, f_type, t_name, wire_template, wire_on_payload, wire_off_payload FROM t_direct_config WHERE id = ? LIMIT 1',
      [configId]
    )
    if (!rows.length) throw new Error(`指令配置 ID ${configId} 不存在`)

    const config = rows[0]

    // 开关类指令（f_type=1）配置了 wire_template 时整体下发那份自定义协议报文
    // （如 Modbus 透传），否则退回 { [preffix]: 线上值 }；见 utils/protocol.js。
    if (String(config.f_type) === '1') {
      return buildSwitchPayload(config, value)
    }

    const propertyName = String(config.preffix || '').trim()
    if (!propertyName) return null // 未配置 MQTT 字段，说明是本地专用值，不需要下发

    return { [propertyName]: String(value) }
  }

  /** 清理所有定时器 */
  cleanup() {
    if (this._syncTimer) clearInterval(this._syncTimer)
    this._syncTimer = null
    for (const timer of this._offlineTimers.values()) {
      clearTimeout(timer)
    }
    this._offlineTimers.clear()
    this._lastHeartbeat.clear()
    this._onlineStatus.clear()
    this._deviceMeta.clear()
    this._pendingCommands.clear()
    this._flushingDevices.clear()
  }
}

module.exports = DeviceManager
