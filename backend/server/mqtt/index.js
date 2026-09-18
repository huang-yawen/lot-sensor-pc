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
 * 另有两个跟"断线补传"配套的主题（方向和上面的设备心跳相反，别搞混）：
 *   MQTT_TOPICS.pcHeartbeat  - PC→设备，让设备判断上位机在不在线，见 mqtt/pcHeartbeat.js
 *   MQTT_TOPICS.offlineData  - 设备→PC，断线期间缓存数据的补传，见 mqtt/offlineData/
 * 【配置】连接/主题/心跳参数见 config/mqtt.js，改完重启后端生效（不再热更新）。
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * 【智能判定的三种触发方式 - 完整流程说明】
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * 这是一个 MQTT 消息总线，是触发判定的关键路口。下面说明三种判定方式如何协作。
 * 
 * 
 * 【方式 1】手动判定 - 前端用户操作
 * ───────────────────────────────────────────────────────────────────────────
 *   流程：
 *     1. 用户在历史记录页勾选几条
 *     2. 点"智能判定"按钮
 *     3. HTTP POST /api/intelligent/judge { type: 'sensor', ids: [101, 102] }
 *     4. 后端查库拿这几条记录
 *     5. 调判定服务
 *     6. 结果存 t_judgment_record，返回前端显示
 *   
 *   触发端：controllers/intelligent/recognize.js
 *   判定端：service/intelligent/intelligentJudgment.js::runManualJudgment()
 *   
 *   特点：
 *     • 需要历史库有这条数据（通常 MQTT 已存库）
 *     • 用户主动操作
 *     • 一次判几条
 *     • 有 UI 反馈
 *
 * 
 * 【方式 2】自动判定 - 后端定时器
 * ───────────────────────────────────────────────────────────────────────────
 *   流程：
 *     1. app.js 启动时调 startAutoJudgment()
 *     2. 定时器每 5 秒触发一次（可改）
 *     3. 从库里取最新 5 条传感器数据
 *     4. 调判定服务判定这 5 条
 *     5. 结果存库 + WebSocket 推给"自动判定"页面
 *   
 *   触发端：app.js::startAutoJudgment()
 *   判定端：service/intelligent/intelligentJudgment.js::runAutoOnce()
 *   
 *   特点：
 *     • 无人值守自动跑
 *     • 需要等数据存库（一般快）
 *     • 一次判最新 N 条
 *     • 前端"自动判定"页面可看结果曲线
 *
 * 
 * 【方式 3】MQTT 实时判定 - 每条消息到达即判（已实现）
 * ───────────────────────────────────────────────────────────────────────────
 *   流程：
 *     1. MQTT 消息到达 → 路由到 combinedRealtimeHandler（sensor===behavior 时）或
 *        sensorRealtimeHandler（分开上报时）
 *     2. 本地规则照常跑（告警 / 联锁 / 故障 / PID …）
 *     3. 消息处理末尾 fire-and-forget 调 triggerRealtimeJudgment()（不等回复）
 *     4. 判定结果异步落库 t_judgment_record + WebSocket 'realtime_judgment' 推给前端
 *
 *   判定端：service/intelligent/intelligentJudgment.js::runRealtimeJudgment()
 *   开关：config.js 的 REALTIME_JUDGMENT.enabled
 *   特点：最实时；数据在内存无需先存库；异步非阻塞不怕判定服务慢
 * 
 * 
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ 【对比总结】三种方式何时该用                                            │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │                                                                           │
 * │ ➤ 追溯历史问题：用【手动】                                              │
 * │   "这个时间段的数据异常吗？" → 勾选几条，点一下解决                     │
 * │                                                                           │
 * │ ➤ 无人自动监控：用【自动】                                              │
 * │   夜班时机器自动跑，5秒检查一次最新几条 → 浏览器展示曲线              │
 * │                                                                           │
 * │ ➤ 秒级实时响应：用【MQTT】                                              │
 * │   消息到立刻本地告警 + 异步深度判定 → 异常立即停机/切换策略            │
 * │                                                                           │
 * │ ➤ 赛场实战（推荐）：三种结合                                             │
 * │   • MQTT 实时做主防线（本地规则 + 异步判定服务）← 秒级响应             │
 * │   • 自动判定做辅助（无人值守 backup）← 5 秒一轮                        │
 * │   • 手动判定做追溯（事后分析）← 用户需要时                              │
 * │                                                                           │
 * └─────────────────────────────────────────────────────────────────────────┘
 * 
 * 
 * 🔧 【如何在这里集成 MQTT 实时判定】
 * ───────────────────────────────────────────────────────────────────────────
 * 
 * 这个文件（mqtt/index.js）只做路由，具体的判定逻辑要在各个 handler 里加。
 * 
 * 以传感器为例，改这个文件（mqtt/sensorRealtime/sensorRealtimeHandler.js）：
 * 
 *   1. 在 handleMessage 函数中，本地规则跑完之后（evaluateRules）
 *   2. 检查是否有告警或异常标记
 *   3. 如果有，启动异步任务调 judgeWithService()
 *   4. 结果异步存库或推前端
 * 
 * 具体代码见 sensorRealtimeHandler.js 文件！
 * 
 */
const MqttClient = require('./mqttClient')
const MessageRouter = require('./messageRouter')
const DeviceManager = require('./deviceManager')
const {
  MQTT_URL, MQTT_CLIENT_ID, MQTT_USERNAME, MQTT_PASSWORD, MQTT_QOS, MQTT_TOPICS, HEARTBEAT_MODE,
} = require('../config/mqtt')
const { HEARTBEAT_DEVICE_FIELDS } = require('../config/protocol')
const { firstValue } = require('../utils/protocol')
const { resolveDeviceNo, resolveDNoByNumber } = require('../utils/mappedData')
const { handleMessage: handleSensorData } = require('./sensorRealtime/sensorRealtimeHandler')
const { handleMessage: handleBehaviorData } = require('./behaviorRealtime/behaviorRealtimeHandler')
const { handleMessage: handleCombinedData } = require('./combinedRealtime/combinedRealtimeHandler')
const { handleMessage: handleOfflineData } = require('./offlineData/offlineDataHandler')
const { startPcHeartbeat } = require('./pcHeartbeat')

function buildMqttConfig() {
  return {
    url: MQTT_URL,
    options: {
      clientId: MQTT_CLIENT_ID || undefined,
      username: MQTT_USERNAME || undefined,
      password: MQTT_PASSWORD || undefined,
      connectTimeout: 10000,
      clean: true,
    },
    subscribeTopics: [
      { topic: MQTT_TOPICS.sensor, qos: MQTT_QOS },
      { topic: MQTT_TOPICS.behavior, qos: MQTT_QOS },
      { topic: MQTT_TOPICS.heartbeat, qos: MQTT_QOS },
      { topic: MQTT_TOPICS.offlineData, qos: MQTT_QOS },
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

  if (topic === MQTT_TOPICS.offlineData) {
    // 设备断线期间缓存、恢复后补传的数据：只落库（标记成补传数据，不进实时窗口），
    // 不走 messageRouter，也就不会触发下面的 processedMessage 广播和在线判定——
    // 补传的是过去时刻的值，既不能拿去驱动现在的控制，也不该推给实时页面。
    await handleOfflineData(topic, payload)
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

// PC 心跳下发：设备在线时按周期往 MQTT_TOPICS.pcHeartbeat 发消息，让设备知道上位机
// 还活着；设备收不到就自己缓存数据，恢复后从 MQTT_TOPICS.offlineData 补传。
startPcHeartbeat(mqttClient, deviceManager)

module.exports = mqttClient
