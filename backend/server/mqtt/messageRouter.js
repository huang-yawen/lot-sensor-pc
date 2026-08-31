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
    // 为什么要把 handler 包一层 try/catch：MQTT 消息是持续不断进来的，如果某一条消息
    // 格式有问题（比如某个字段缺失、JSON 解析失败）导致 handler 内部抛异常，绝不能让
    // 这一次异常直接把整个消息监听流程炸掉——那样后面所有正常的消息也都收不到了。
    // 这里吞掉异常只打印日志、返回 null，保证坏消息只丢这一条，不影响后续消息处理。
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
