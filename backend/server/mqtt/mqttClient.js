/**
 * 【文件职责】MQTT.js 的连接、订阅、发布和重连封装。
 * 【配置】不直接读取配置；mqtt/index.js 将 MQTT_URL、认证、QoS、主题转为
 * 构造参数，在配置变更后调用 reconfigure，避免业务模块各自重连。
 *
 * MQTT 客户端核心模块
 * 
 * 职责：
 * 1. 建立和管理 MQTT 连接
 * 2. 提供消息发布功能
 * 3. 提供主题订阅功能
 * 4. 接收消息并交给路由器分发
 * 5. 重连次数超限后转为固定间隔慢重试，网络恢复即自愈，不会彻底放弃
 * 
 * 使用方式：
 *   const mqttClient = require('./mqtt')
 *   mqttClient.publish('topic', { key: 'value' })
 *   mqttClient.on('message', (topic, payload) => { ... })
 */

const mqtt = require('mqtt')
const EventEmitter = require('events')

/** 快重试次数用完后转入的固定重试间隔（毫秒）。网络恢复后靠它自愈，不再需要人工介入。 */
const SLOW_RETRY_MS = 30000

/**
 * 继承 EventEmitter，对外会发出这几种事件：
 *   'connected'        - 连接成功（含首次连接和每次重连成功）
 *   'message'          - 收到一条 MQTT 消息，参数 (topic, payload)，交给
 *                        messageRouter 按主题分发给具体的业务处理器
 *   'reconnect_failed' - 快重试次数用完了，已转入慢重试（每 30 秒一次，会一直重试
 *                        下去）。发出这个事件是为了提醒排查 Broker，不代表停止重连；
 *                        每次断连只发一次，连接恢复后重置
 */
class MqttClient extends EventEmitter {
  /**
   * @param {Object} config - MQTT 配置
   * @param {string} config.url - Broker 地址，如 'mqtt://localhost:1883'
   * @param {Object} config.options - MQTT 连接选项
   * @param {Array} config.subscribeTopics - 要订阅的主题列表 [{ topic, qos }]
   * @param {number} [config.maxReconnectAttempts=5] - 快重试（指数退避）次数，超过后转慢重试
   */
  constructor(config) {
    super()
    this.config = config
    this.isConnected = false
    this.client = null
    this._reconnectCount = 0
    this._maxReconnectAttempts = config.maxReconnectAttempts || 5
    this._reconnectStopped = false
    this._slowRetryNotified = false
    this._connect()
  }

  // ==================== 连接管理 ====================

  /** 创建并连接 MQTT */
  _connect() {
    this._reconnectStopped = false
    this._reconnectCount = 0

    this.client = mqtt.connect(this.config.url, {
      ...this.config.options,
      // reconnectPeriod: 0 关掉 mqtt.js 自带的固定间隔无限重连，改由下面的
      // _scheduleReconnect 接管：先按指数退避快重试，次数超过上限后转成固定
      // 间隔慢重试，一直重试下去。
      reconnectPeriod: 0
    })

    this.client.on('connect', () => {
      this.isConnected = true
      this._reconnectCount = 0
      this._slowRetryNotified = false
      console.log('[MQTT] 已连接')
      this._subscribeAll()
      this.emit('connected')
    })

    this.client.on('error', (err) => {
      console.error('[MQTT] 连接错误:', err.message)
      this.isConnected = false
    })

    // close 和 offline 都要重连，虽然触发场景不完全一样：close 是底层网络连接
    // 彻底断开（比如 Broker 主动踢掉、TCP 连接断了）；offline 是 mqtt.js 自己
    // 判定"一段时间没能保持住连接"，这时候库内部有可能还在尝试，但业务层面
    // 都算作"现在连不上"，两种情况都需要走同一套重连调度，不需要区分对待。
    this.client.on('close', () => {
      this.isConnected = false
      console.log('[MQTT] 连接已关闭')

      // 连接关闭后，如果还没停止重连，尝试重连
      if (!this._reconnectStopped) {
        this._scheduleReconnect()
      }
    })

    this.client.on('offline', () => {
      this.isConnected = false
      console.log('[MQTT] 离线')
      if (!this._reconnectStopped) {
        this._scheduleReconnect()
      }
    })

    // 收到消息 -> 触发事件，由 messageRouter 处理
    this.client.on('message', (topic, payload) => {
      this.emit('message', topic, payload)
    })
  }

  /** 安排一次重连 */
  _scheduleReconnect() {
    if (this._reconnectStopped) return

    this._reconnectCount++
    // 超过 maxReconnectAttempts 不再放弃，只是从"指数退避快重试"转成"固定间隔慢重试"：
    // 现场断网/Broker 重启/AP 切换都可能超过快重试那几十秒，一旦彻底停掉重连，后端就
    // 永久收不到数据了，页面还显示着旧值不报错，只能人工重启——这是设备现场最不能接受的
    // 失败方式。慢重试一直挂着，网络恢复后能自愈。
    const exceeded = this._reconnectCount > this._maxReconnectAttempts
    if (exceeded) {
      // reconnect_failed 只在刚跨过阈值时发一次，让上层（app.js）能记录、页面能展示，
      // 不会因为慢重试每 30 秒刷一条。连接成功后重置，下次断连仍会重新提醒。
      if (!this._slowRetryNotified) {
        this._slowRetryNotified = true
        console.warn(`[MQTT] 快重试已达 ${this._maxReconnectAttempts} 次，转为每 ${SLOW_RETRY_MS / 1000} 秒慢重试`)
        console.warn('[MQTT] 请检查 MQTT Broker (Mosquitto) 是否已启动')
        this.emit('reconnect_failed')
      }
      console.log(`[MQTT] 慢重试中... (累计第 ${this._reconnectCount} 次)`)
    } else {
      console.log(`[MQTT] 正在重连... (第 ${this._reconnectCount}/${this._maxReconnectAttempts} 次)`)
    }

    // 快重试阶段指数退避：1s, 2s, 4s, 8s, 16s，封顶 30 秒；之后固定 SLOW_RETRY_MS。
    const delay = exceeded
      ? SLOW_RETRY_MS
      : Math.min(1000 * Math.pow(2, this._reconnectCount - 1), 30000)
    setTimeout(() => {
      if (this._reconnectStopped) return
      if (this.client && !this.client.connected) {
        this.client.reconnect()
      }
    }, delay)
  }

  /** 手动触发重新连接（例如在用户启动 MQTT Broker 后可调用） */
  reconnect() {
    this._reconnectCount = 0
    this._reconnectStopped = false
    if (this.client) {
      this.client.end(true)
    }
    this._connect()
    console.log('[MQTT] 手动触发重新连接...')
  }

  /** 应用新的 Broker/主题配置并重连。 */
  reconfigure(config) {
    this.disconnect()
    this.config = config
    this._maxReconnectAttempts = config.maxReconnectAttempts || 5
    this._connect()
    console.log('[MQTT] 配置已热更新并重新连接')
  }

  /** 订阅所有配置的主题 */
  _subscribeAll() {
    const topics = {}
    for (const item of this.config.subscribeTopics) {
      topics[item.topic] = { qos: item.qos || 0 }
    }

    if (Object.keys(topics).length === 0) return

    this.client.subscribe(topics, (err) => {
      if (err) {
        console.error('[MQTT] 订阅失败:', err.message)
      } else {
        console.log('[MQTT] 订阅成功')
      }
    })
  }

  // ==================== 发布消息 ====================

  /**
   * 发布 JSON 消息到指定主题
   * @param {string} topic - 主题
   * @param {Object} payload - 消息内容（对象）
   * @param {Object} [options={ qos: 1 }] - 发布选项
   * @returns {Promise<{status: string}>}
   */
  publish(topic, payload, options = { qos: 1 }) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.client || !this.client.connected) {
        const err = new Error(`MQTT 未连接，无法发布到主题 ${topic}`)
        err.code = 'MQTT_DISCONNECTED'
        console.warn('[MQTT] 未连接，拒绝发送:', topic)
        reject(err)
        return
      }
      const message = JSON.stringify(payload)
      this.client.publish(topic, message, options, (err) => {
        if (err) {
          console.error('[MQTT] 发布失败:', topic, err.message)
          reject(err)
        } else {
          console.log('[MQTT] 已发布到', topic, ':', JSON.stringify(payload))
          resolve({ status: 'published' })
        }
      })
    })
  }

  /** 断开连接 */
  disconnect() {
    this._reconnectStopped = true
    if (this.client) {
      this.client.end(true)
      this.client = null
    }
    this.isConnected = false
  }
}

module.exports = MqttClient
