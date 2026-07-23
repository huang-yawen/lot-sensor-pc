/**
 * 【文件职责】按 MQTT Topic 分发消息到对应业务处理器。
 * 【配置中心关联】不直接读取；mqtt/index.js 依据 MQTT_TOPICS 注册路由，配置变更时会
 * 清空旧路由再注册，确保旧场景主题不会继续写入数据库。
 *
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

  clear() {
    this.handlers.clear()
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
