/**
 * 【文件职责】MQTT 业务总线入口：按 config/mqtt.js 创建客户端、订阅传感器/行为/心跳主题，
 * 把消息路由到对应处理器，并做心跳在线判定。
 * 【说明】原本还订阅设备主动上报的 alarm 告警主题，现赛题场景不再有设备侧上报告警，
 * 该子模块已删除；所有故障判断改为后端自己拿传感器数值实时评估，见
 * evaluateRules / safetyInterlock / faultStatus 三套本地判断逻辑。
 * 心跳判定模式由 HEARTBEAT_MODE 二选一（互斥）：
 *   'receive' - 设备发一条传感器/行为数据就代表在线，不用单独发心跳包（默认）
 *   'topic'   - 只认专门的心跳主题（MQTT_TOPICS.heartbeat）
 * 多久没收到判离线由 HEARTBEAT_TIMEOUT 控制（在 DeviceManager 里）。
 * 【配置】连接/主题/心跳参数见 config/mqtt.js，改完重启后端生效（不再热更新）。
 */
const MqttClient = require('./mqttClient')
const MessageRouter = require('./messageRouter')
const DeviceManager = require('./deviceManager')
const {
  MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD, MQTT_QOS, MQTT_TOPICS, HEARTBEAT_MODE,
} = require('../config/mqtt')
const { HEARTBEAT_DEVICE_FIELDS } = require('../config/protocol')
const { firstValue } = require('../utils/protocol')
const { resolveDeviceNo, resolveDNoByNumber } = require('../utils/mappedData')
const { handleMessage: handleSensorData } = require('./sensorRealtime/sensorRealtimeHandler')
const { handleMessage: handleBehaviorData } = require('./behaviorRealtime/behaviorRealtimeHandler')
const { handleMessage: handleCombinedData } = require('./combinedRealtime/combinedRealtimeHandler')

function buildMqttConfig() {
  return {
    url: MQTT_URL,
    options: {
      clientId: process.env.MQTT_CLIENT_ID || undefined,
      username: MQTT_USERNAME || undefined,
      password: MQTT_PASSWORD || undefined,
      connectTimeout: 10000,
      clean: true,
    },
    subscribeTopics: [
      { topic: MQTT_TOPICS.sensor, qos: MQTT_QOS },
      { topic: MQTT_TOPICS.behavior, qos: MQTT_QOS },
      { topic: MQTT_TOPICS.heartbeat, qos: MQTT_QOS },
    ],
    maxReconnectAttempts: 5,
  }
}

const mqttClient = new MqttClient(buildMqttConfig())
const router = new MessageRouter()
const deviceManager = new DeviceManager(mqttClient)

// 按主题注册处理器。传感器和行为配成同一个主题时，说明设备把两类字段放一条消息里上报，
// 改用 handleCombinedData 一次性解析入库（messageRouter 内部按主题存路由表，同一主题
// 分别 register 两次会互相覆盖，只有后一个生效）。
function registerRoutes() {
  router.clear()
  if (MQTT_TOPICS.sensor === MQTT_TOPICS.behavior) {
    router.register(MQTT_TOPICS.sensor, handleCombinedData)
  } else {
    router.register(MQTT_TOPICS.sensor, handleSensorData)
    router.register(MQTT_TOPICS.behavior, handleBehaviorData)
  }
}

registerRoutes()

mqttClient.on('message', async (topic, payload) => {
  if (topic === MQTT_TOPICS.heartbeat) {
    // 'topic' 模式才认专门的心跳主题；'receive' 模式下这个主题即使收到消息也不影响在线判定。
    if (HEARTBEAT_MODE === 'topic') {
      const raw = payload.toString().trim()
      let deviceId = raw
      try {
        const parsed = JSON.parse(raw)
        deviceId = firstValue(parsed, HEARTBEAT_DEVICE_FIELDS) || raw
      } catch {}
      if (deviceId) {
        // 心跳包里的字段跟传感器/行为数据一样，是设备上报的原始编号（对应 t_device.number），
        // 同样要转换成 d_no 再交给 DeviceManager，跟 'receive' 模式保持一致的设备标识。
        const dNo = await resolveDNoByNumber(String(deviceId).trim())
        if (dNo) deviceManager.onHeartbeat(dNo)
      }
    }
    return
  }

  const result = await router.route(topic, payload)
  if (result) {
    mqttClient.emit('processedMessage', result.topic, result.data)

    // 'receive' 模式：设备只要发过一条传感器/行为数据，就证明它还活着，不需要单独发心跳包；
    // 多久没收到判离线由 HEARTBEAT_TIMEOUT 统一控制（逻辑在 DeviceManager）。'topic' 模式这里不生效。
    if (HEARTBEAT_MODE === 'receive' && (topic === MQTT_TOPICS.sensor || topic === MQTT_TOPICS.behavior)) {
      const deviceNo = await resolveDeviceNo(result.data)
      if (deviceNo) deviceManager.onHeartbeat(String(deviceNo).trim())
    }
  }
})

mqttClient.checkIfAlive = (deviceId) => deviceManager.isOnline(deviceId)
mqttClient.addPendingCommand = (deviceId, configId, value) => deviceManager.addPendingCommand(deviceId, configId, value)
mqttClient.publishJsonToDevice = (deviceId, topic, payload, options) => mqttClient.publish(topic, payload, options)
mqttClient.getAllDeviceStatus = () => deviceManager.getAllDeviceStatus()
mqttClient.registerDevice = (deviceId, metadata) => deviceManager.registerDevice(deviceId, metadata)
mqttClient.removeDevice = (deviceId) => deviceManager.removeDevice(deviceId)
mqttClient.renameDevice = (oldDeviceId, newDeviceId, metadata) => deviceManager.renameDevice(oldDeviceId, newDeviceId, metadata)
mqttClient.refreshDevices = () => deviceManager.refreshDevicesFromDB()
mqttClient.waitForDeviceSync = (timeoutMs) => deviceManager.waitForDeviceSync(timeoutMs)

module.exports = mqttClient
