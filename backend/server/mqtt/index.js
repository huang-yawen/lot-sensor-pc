/**
 * 【文件职责】MQTT 业务总线入口。
 * 根据配置中心创建客户端、订阅传感器/行为/心跳主题，将消息路由到处理器；当 MQTT
 * 参数或主题变化时重新注册路由和连接。
 * 【说明】原本还订阅设备主动上报的 alarm 告警主题（由 mqtt/errorHistory/ 处理），
 * 现赛题场景不再有设备侧上报告警，该子模块已被删除，本文件不再订阅/处理该主题；
 * 所有故障判断改为后端自己拿传感器数值实时评估，见 evaluateRules/safetyInterlock/
 * faultStatus 三套本地判断逻辑。
 * 心跳判定模式由 HEARTBEAT_MODE 二选一，两种互斥：
 *   'receive' - 自动上报：设备发一条传感器/行为数据（receive 主题）就代表在线，
 *               不要求单独发心跳包（默认）。
 *   'topic'   - 只认专门的心跳主题（MQTT_TOPICS.heartbeat）。
 * 多久没收到就判定离线由 HEARTBEAT_TIMEOUT 控制。
 * 【配置中心关联】MQTT_URL、MQTT_USERNAME、MQTT_PASSWORD、MQTT_QOS、MQTT_TOPICS、
 * HEARTBEAT_DEVICE_FIELDS、HEARTBEAT_MODE、HEARTBEAT_TIMEOUT 均由本模块/DeviceManager
 * 读取，并通过 systemConfig.onChange 热更新。
 */
const MqttClient = require('./mqttClient')
const MessageRouter = require('./messageRouter')
const DeviceManager = require('./deviceManager')
const systemConfig = require('../config/systemConfig')
const { firstValue } = require('../utils/protocol')
const { resolveDeviceNo, resolveDNoByNumber } = require('../utils/mappedData')
const { handleMessage: handleSensorData } = require('./sensorRealtime/sensorRealtimeHandler')
const { handleMessage: handleBehaviorData } = require('./behaviorRealtime/behaviorRealtimeHandler')
const { handleMessage: handleCombinedData } = require('./combinedRealtime/combinedRealtimeHandler')

function buildMqttConfig(scene) {
  const qos = scene.MQTT_QOS
  return {
    url: scene.MQTT_URL,
    options: {
      clientId: process.env.MQTT_CLIENT_ID || undefined,
      username: scene.MQTT_USERNAME || undefined,
      password: scene.MQTT_PASSWORD || undefined,
      connectTimeout: 10000,
      clean: true,
    },
    subscribeTopics: [
      { topic: scene.MQTT_TOPICS.sensor, qos },
      { topic: scene.MQTT_TOPICS.behavior, qos },
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
  if (scene.MQTT_TOPICS.sensor === scene.MQTT_TOPICS.behavior) {
    // 设备把传感器字段和行为字段放在同一条消息里上报，不再区分传感器/行为两个主题。
    // 这种情况下改用 handleCombinedData 这一个处理器，一次性把传感器字段和行为
    // 字段都解析并入库（messageRouter 内部按主题存路由表，同一主题分别 register
    // 两次的话，后一次会直接覆盖前一次，只有 behavior 处理器会生效）。
    router.register(scene.MQTT_TOPICS.sensor, handleCombinedData)
  } else {
    router.register(scene.MQTT_TOPICS.sensor, handleSensorData)
    router.register(scene.MQTT_TOPICS.behavior, handleBehaviorData)
  }
}

registerRoutes(systemConfig.getConfig())
let mqttSignature = JSON.stringify(buildMqttConfig(systemConfig.getConfig()))

mqttClient.on('message', async (topic, payload) => {
  const scene = systemConfig.getConfig()
  if (topic === scene.MQTT_TOPICS.heartbeat) {
    // 'topic' 模式才认专门的心跳主题；'receive' 模式下这个主题即使收到消息也不影响在线判定。
    if (scene.HEARTBEAT_MODE === 'topic') {
      const raw = payload.toString().trim()
      let deviceId = raw
      try {
        const parsed = JSON.parse(raw)
        deviceId = firstValue(parsed, scene.HEARTBEAT_DEVICE_FIELDS) || raw
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

    // 'receive' 模式：设备只要发过一条传感器/行为数据（receive 主题），就证明它还活着，
    // 不需要单独发心跳包；多久没收到就判定离线由 HEARTBEAT_TIMEOUT（配置中心可调）
    // 统一控制，逻辑在 DeviceManager 里。'topic' 模式下这里不生效。
    if (scene.HEARTBEAT_MODE === 'receive' && (topic === scene.MQTT_TOPICS.sensor || topic === scene.MQTT_TOPICS.behavior)) {
      const deviceNo = await resolveDeviceNo(result.data)
      if (deviceNo) deviceManager.onHeartbeat(String(deviceNo).trim())
    }
  }
})

// 配置中心任何一项保存都会触发这个回调，但不是所有配置项变化都跟 MQTT 连接相关
// （比如只是改了页面标题、分页大小）。用 JSON.stringify 序列化前后两份 MQTT 相关
// 配置（地址、账号密码、QoS、主题）比较是否真的变了，只有真变了才断线重连——
// 避免用户随便改个不相关的配置就让 MQTT 连接抖一下，正在处理中的消息、设备心跳
// 计时都被无谓打断。
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
mqttClient.registerDevice = (deviceId, metadata) => deviceManager.registerDevice(deviceId, metadata)
mqttClient.removeDevice = (deviceId) => deviceManager.removeDevice(deviceId)
mqttClient.renameDevice = (oldDeviceId, newDeviceId, metadata) => deviceManager.renameDevice(oldDeviceId, newDeviceId, metadata)
mqttClient.refreshDevices = () => deviceManager.refreshDevicesFromDB()
mqttClient.waitForDeviceSync = (timeoutMs) => deviceManager.waitForDeviceSync(timeoutMs)

module.exports = mqttClient
