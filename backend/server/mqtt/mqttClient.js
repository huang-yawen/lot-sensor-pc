/**
 * MQTT 客户端核心模块
 * 
 * 职责：
 * 1. 建立和管理 MQTT 连接
 * 2. 提供消息发布功能
 * 3. 提供主题订阅功能
 * 4. 接收消息并交给路由器分发
 * 
 * 使用方式：
 *   const mqttClient = require('./mqtt')
 *   mqttClient.publish('topic', { key: 'value' })
 *   mqttClient.on('message', (topic, payload) => { ... })
 */

const mqtt = require('mqtt')
const EventEmitter = require('events')

class MqttClient extends EventEmitter {
  /**
   * @param {Object} config - MQTT 配置
   * @param {string} config.url - Broker 地址，如 'mqtt://localhost:1883'
   * @param {Object} config.options - MQTT 连接选项
   * @param {Array} config.subscribeTopics - 要订阅的主题列表 [{ topic, qos }]
   */
  constructor(config) {
    super()
    this.config = config
    this.isConnected = false
    this.client = null
    this._connect()
  }

  // ==================== 连接管理 ====================

  /** 创建并连接 MQTT */
  _connect() {
    this.client = mqtt.connect(this.config.url, this.config.options)

    this.client.on('connect', () => {
      this.isConnected = true
      console.log('[MQTT] 已连接')
      this._subscribeAll()
      this.emit('connected')
    })

    this.client.on('error', (err) => {
      console.error('[MQTT] 连接错误:', err.message)
      this.isConnected = false
    })

    this.client.on('close', () => {
      this.isConnected = false
      console.log('[MQTT] 连接已关闭')
    })

    this.client.on('reconnect', () => {
      console.log('[MQTT] 正在重连...')
    })

    // 收到消息 -> 触发事件，由 messageRouter 处理
    this.client.on('message', (topic, payload) => {
      this.emit('message', topic, payload)
    })
  }

  /** 订阅所有配置的主题 */
  _subscribeAll() {
    const topics = {}
    for (const item of this.config.subscribeTopics) {
      topics[item.topic] = { qos: item.qos || 0 }
    }
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
      if (!this.isConnected) {
        console.warn('[MQTT] 未连接，消息丢弃:', topic)
        resolve({ status: 'disconnected' })
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
    if (this.client) {
      this.client.end(true)
      this.client = null
    }
    this.isConnected = false
  }
}

module.exports = MqttClient