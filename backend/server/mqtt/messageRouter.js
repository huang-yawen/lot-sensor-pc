/**
 * MQTT 消息路由器
 * 
 * 职责：根据主题将收到的消息分发给对应的处理器
 * 
 * 使用方式：
 *   const router = new MessageRouter()
 *   router.register('sensor_data', sensorHandler)
 *   router.route(topic, payload)  // 自动分发
 */

class MessageRouter {
  constructor() {
    /** @type {Map<string, Function>} 主题 -> 处理函数 */
    this.handlers = new Map()
  }

  /**
   * 注册消息处理器
   * @param {string} topic - 主题名称
   * @param {Function} handler - 处理函数 (topic, payload) => result
   */
  register(topic, handler) {
    this.handlers.set(topic, handler)
  }

  /**
   * 路由消息到对应的处理器
   * @param {string} topic - 原始主题
   * @param {Buffer} payload - 原始消息内容
   * @returns {Promise<{topic: string, data: any}|null>} 处理结果，无匹配返回 null
   */
  async route(topic, payload) {
    const handler = this.handlers.get(topic)
    if (!handler) {
      console.warn('[MessageRouter] 无处理器匹配主题:', topic)
      return null
    }
    try {
      const data = await handler(topic, payload)
      return { topic, data }
    } catch (err) {
      console.error('[MessageRouter] 处理消息失败:', topic, err.message)
      return null
    }
  }
}

module.exports = MessageRouter