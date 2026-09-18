/**
 * 【文件职责】按 MQTT Topic 分发消息到对应业务处理器。
 * 【配置】不直接读取；mqtt/index.js 依据 MQTT_TOPICS 注册路由，配置变更时会
 * 清空旧路由再注册，确保旧场景主题不会继续写入数据库。
 *
 * MQTT 消息路由器
 * 
 * 职责：根据主题将收到的消息分发给对应的处理器
 * 
 * 📍 【消息流向】
 * ═════════════════════════════════════════════════════════════════════
 *   MQTT Broker
 *       ↓
 *   mqttClient 连接 & 订阅
 *       ↓
 *   接收消息 (topic, payload)
 *       ↓
 *   MessageRouter.route()  ← 【仔细看这里】
 *       ├─→ 按 topic 查找对应的 handler
 *       ├─→ 执行 handler(topic, payload)
 *       └─→ handler 返回处理结果
 * 
 * 
 * 🔍 【现有的 handlers 有哪些】
 * ═════════════════════════════════════════════════════════════════════
 * 
 *   topic                    handler 所在文件                  处理逻辑
 *   ────────────────────────────────────────────────────────────
 *   sensor_data              mqtt/sensorRealtime/            • 传感器数据存库
 *                           sensorRealtimeHandler.js         • 本地告警规则
 *                                                            • 安全联锁
 *                                                            • PID 控制
 *                                                            • 【MQTT 实时判定】
 *
 *   behavior_data            mqtt/behaviorRealtime/          • 行为数据存库
 *                           behaviorRealtimeHandler.js       • 故障告警
 * 
 *   sensor_behavior_combined mqtt/combinedRealtime/          • 同时处理传感器+
 *                           combinedRealtimeHandler.js       行为（单条消息）
 * 
 * 
 * 💡 【判定逻辑不要加在这一层】
 * 智能判定（方式③ 消息即触发）已经实现在 mqtt/combinedRealtime/combinedRealtimeHandler.js
 * 的 triggerRealtimeJudgment() 里，不要在 route() 里再塞判定逻辑——这一层只做消息分发。
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
    // 把 handler 的调用包在 try/catch 里执行：如果某条消息格式有问题（比如缺字段、
    // JSON 解析失败）导致 handler 内部抛出异常，这里会捕获住，只打印一条错误日志、
    // 返回 null，不会让这次异常中断后续消息的处理。
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
