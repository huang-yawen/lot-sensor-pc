/**
 * 【文件职责】PC 端心跳下发：判定设备在线时，按固定周期往 MQTT_TOPICS.pcHeartbeat
 * （默认 'heart'）发一条消息，让底层设备知道上位机还活着。
 * 【为什么需要】设备靠"能不能持续收到这个主题的消息"判断上位机在不在线：收不到就把
 * 这段时间的传感器数据自己缓存起来，等重新收到心跳后，再从 MQTT_TOPICS.offlineData
 * （默认 'offline'）主题把缓存的数据补传上来。补传数据怎么落库见
 * mqtt/offlineData/offlineDataHandler.js。
 * 【别跟设备心跳搞混】config/mqtt.js 里的 MQTT_TOPICS.heartbeat 是设备→PC，用来判断
 * 设备在不在线；本文件发的 pcHeartbeat 是 PC→设备，用来让设备判断 PC 在不在线。
 * 两个主题各管一个方向，不能共用一个主题名，否则会自己收到自己发的心跳。
 * 【配置】PC_HEARTBEAT_ENABLED / PC_HEARTBEAT_INTERVAL / MQTT_TOPICS.pcHeartbeat
 * 见 config/mqtt.js，改完重启后端生效。
 */
const { MQTT_TOPICS, MQTT_QOS, PC_HEARTBEAT_ENABLED, PC_HEARTBEAT_INTERVAL } = require('../config/mqtt')
const { nowLocalDateTime } = require('../utils/helper')

/**
 * 启动 PC 心跳定时器。
 * 一台设备都不在线这一轮就不发（在线判定见 DeviceManager.isOnline：超过
 * HEARTBEAT_TIMEOUT 没收到设备上报即离线）；MQTT 没连上时 mqttClient.publish 自己会
 * 拒发并 reject，这里接住打一行日志，不让它变成未捕获的 Promise 异常。
 * @param {Object} mqttClient - MqttClient 实例
 * @param {Object} deviceManager - DeviceManager 实例
 * @returns {NodeJS.Timeout|null} 定时器；未启用或配置无效时返回 null
 */
function startPcHeartbeat(mqttClient, deviceManager) {
  if (!PC_HEARTBEAT_ENABLED) {
    console.log('[PcHeartbeat] 已关闭（PC_HEARTBEAT_ENABLED=false），不下发心跳')
    return null
  }

  const topic = MQTT_TOPICS.pcHeartbeat
  const interval = Number(PC_HEARTBEAT_INTERVAL)
  if (!topic || !Number.isFinite(interval) || interval <= 0) {
    console.warn('[PcHeartbeat] 主题或间隔配置无效，不下发心跳')
    return null
  }

  console.log(`[PcHeartbeat] 每 ${interval} 毫秒向主题 ${topic} 下发一次心跳（仅设备在线时）`)
  return setInterval(() => {
    const anyOnline = deviceManager.getAllDeviceStatus().some((status) => status.online)
    if (!anyOnline) return
    // 内容对设备没有意义，设备只看"有没有收到"，带个时间戳纯粹是为了抓包时好对时间。
    mqttClient.publish(topic, { time: nowLocalDateTime() }, { qos: MQTT_QOS })
      .catch((err) => console.warn('[PcHeartbeat] 下发失败:', err.message))
  }, interval)
}

module.exports = { startPcHeartbeat }
