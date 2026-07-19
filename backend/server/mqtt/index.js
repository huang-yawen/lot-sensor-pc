const MqttClient = require('./mqttClient')
const MessageRouter = require('./messageRouter')
const DeviceManager = require('./deviceManager')
const systemConfig = require('../config/systemConfig')
const { firstValue } = require('../utils/protocol')
const { handleMessage: handleSensorData } = require('./sensorRealtime/sensorRealtimeHandler')
const { handleMessage: handleBehaviorData } = require('./behaviorRealtime/behaviorRealtimeHandler')
const { handleMessage: handleAbnormalStateData } = require('./errorHistory/errorHistoryHandler')

function buildMqttConfig(scene) {
  const qos = scene.MQTT_QOS
  return {
    url: scene.MQTT_URL,
    options: {
      username: scene.MQTT_USERNAME || undefined,
      password: scene.MQTT_PASSWORD || undefined,
      connectTimeout: 10000,
      clean: true,
    },
    subscribeTopics: [
      { topic: scene.MQTT_TOPICS.sensor, qos },
      { topic: scene.MQTT_TOPICS.behavior, qos },
      { topic: scene.MQTT_TOPICS.alarm, qos },
      { topic: scene.MQTT_TOPICS.heartbeat, qos },
    ],
    maxReconnectAttempts: 5,
  }
}

const mqttClient = new MqttClient(buildMqttConfig(systemConfig.getConfig()))
const router = new MessageRouter()
const deviceManager = new DeviceManager(mqttClient)

function registerRoutes(scene) {
  router.clear()
  router.register(scene.MQTT_TOPICS.sensor, handleSensorData)
  router.register(scene.MQTT_TOPICS.behavior, handleBehaviorData)
  router.register(scene.MQTT_TOPICS.alarm, handleAbnormalStateData)
}

registerRoutes(systemConfig.getConfig())
let mqttSignature = JSON.stringify(buildMqttConfig(systemConfig.getConfig()))

mqttClient.on('message', async (topic, payload) => {
  const scene = systemConfig.getConfig()
  if (topic === scene.MQTT_TOPICS.heartbeat) {
    const raw = payload.toString().trim()
    let deviceId = raw
    try {
      const parsed = JSON.parse(raw)
      deviceId = firstValue(parsed, scene.HEARTBEAT_DEVICE_FIELDS) || raw
    } catch {}
    if (deviceId) deviceManager.onHeartbeat(String(deviceId).trim())
    return
  }

  const result = await router.route(topic, payload)
  if (result) mqttClient.emit('processedMessage', result.topic, result.data)
})

systemConfig.onChange((scene) => {
  registerRoutes(scene)
  const nextConfig = buildMqttConfig(scene)
  const nextSignature = JSON.stringify(nextConfig)
  if (nextSignature !== mqttSignature) {
    mqttSignature = nextSignature
    mqttClient.reconfigure(nextConfig)
  }
})

mqttClient.checkIfAlive = (deviceId) => deviceManager.isOnline(deviceId)
mqttClient.addPendingCommand = (deviceId, configId, value) => deviceManager.addPendingCommand(deviceId, configId, value)
mqttClient.publishJsonToDevice = (deviceId, topic, payload, options) => mqttClient.publish(topic, payload, options)
mqttClient.getAllDeviceStatus = () => deviceManager.getAllDeviceStatus()
mqttClient.registerDevice = (deviceId) => deviceManager.registerDevice(deviceId)
mqttClient.removeDevice = (deviceId) => deviceManager.removeDevice(deviceId)
mqttClient.renameDevice = (oldDeviceId, newDeviceId) => deviceManager.renameDevice(oldDeviceId, newDeviceId)

module.exports = mqttClient
