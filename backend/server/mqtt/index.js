/**
 * MQTT 模块入口
 * 
 * 组装所有 MQTT 相关模块并导出统一的客户端实例
 * 
 * 架构说明：
 *   index.js          - 入口，组装各模块
 *   mqttClient.js     - 核心客户端（连接、发布、订阅）
 *   messageRouter.js  - 消息路由器（按主题分发）
 *   deviceManager.js  - 设备管理器（心跳、在线状态、暂存指令）
 *   handlers/         - 各主题的消息处理器
 * 
 * 使用方式：
 *   const mqttClient = require('./mqtt')
 *   mqttClient.publish('topic', { key: 'value' })
 *   mqttClient.isConnected  // 连接状态
 *   mqttClient.checkIfAlive(deviceId)  // 检查设备在线
 */

const MqttClient = require('./mqttClient')
const MessageRouter = require('./messageRouter')
const DeviceManager = require('./deviceManager')
const { handleMessage: handleSensorData, SENSOR_TOPIC } = require('./sensorRealtime/sensorRealtimeHandler')
const { handleMessage: handleBehaviorData, BEHAVIOR_TOPIC } = require('./behaviorRealtime/behaviorRealtimeHandler')
const { handleMessage: handleAbnormalStateData, ERROR_TOPIC: ABNORMAL_STATE_TOPIC } = require('./errorHistory/errorHistoryHandler')

// ==================== 1. 读取配置 ====================

const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883'
const MQTT_USERNAME = process.env.MQTT_USERNAME || ''
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || ''

const config = {
  url: MQTT_URL,
  options: {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    reconnectPeriod: 5000,   // 5秒重连
    connectTimeout: 10000,   // 10秒超时
    clean: true,
  },
  subscribeTopics: [
    { topic: SENSOR_TOPIC, qos: 1 },
    { topic: BEHAVIOR_TOPIC, qos: 1 },
    { topic: ABNORMAL_STATE_TOPIC, qos: 1 },
    { topic: 'heart_beat', qos: 1 },
  ]
}

// ==================== 2. 创建各模块实例 ====================

/** MQTT 客户端 */
const mqttClient = new MqttClient(config)

/** 消息路由器 */
const router = new MessageRouter()
router.register(SENSOR_TOPIC, handleSensorData)
router.register(BEHAVIOR_TOPIC, handleBehaviorData)
router.register(ABNORMAL_STATE_TOPIC, handleAbnormalStateData)

/** 设备管理器 */
const deviceManager = new DeviceManager(mqttClient)

// ==================== 3. 连接消息处理 ====================

mqttClient.on('message', async (topic, payload) => {
  // 心跳消息特殊处理
  if (topic === 'heart_beat') {
    const raw = payload.toString().trim()
    let deviceId = raw

    // 尝试解析 JSON 格式的心跳（如 {"VID": "202177"}），提取 VID 字段
    try {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.VID) {
        deviceId = String(parsed.VID).trim()
      }
    } catch {
      // 非 JSON 格式，直接使用原始字符串作为设备 ID
    }

    if (deviceId) {
      deviceManager.onHeartbeat(deviceId)
    }
    return
  }

  // 其他消息通过路由器分发
  const result = await router.route(topic, payload)
  if (result) {
    // 触发 message 事件，让 app.js 可以广播到 WebSocket
    mqttClient.emit('processedMessage', result.topic, result.data)
  }
})

// ==================== 4. 导出接口 ====================

// 保持与旧代码兼容的接口
mqttClient.checkIfAlive = (deviceId) => deviceManager.isOnline(deviceId)
mqttClient.addPendingCommand = (deviceId, configId, value) => deviceManager.addPendingCommand(deviceId, configId, value)
mqttClient.publishJsonToDevice = (deviceId, topic, payload, options) => mqttClient.publish(topic, payload, options)
mqttClient.getAllDeviceStatus = () => deviceManager.getAllDeviceStatus()

module.exports = mqttClient