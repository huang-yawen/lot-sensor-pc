/**
 * 【文件职责】MQTT 连接参数、主题名、心跳判定方式。
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 注意：这几项以前是"持久化配置 > .env > 源码默认"，现在就以本文件为准，.env 里的
 * MQTT_URL/MQTT_USERNAME/MQTT_PASSWORD 不再生效（MQTT_CLIENT_ID 仍从 .env 读，见 mqtt/index.js）。
 * 【谁在读】mqtt/index.js（建连接、订阅、心跳）、mqtt/deviceManager.js（离线阈值）、
 * app.js 和若干服务（拿 MQTT_TOPICS 判断主题）。
 */
module.exports = {
  // Broker 地址，必须以 mqtt:// 或 mqtts:// 开头。
  MQTT_URL: 'mqtt://192.168.1.110:1883',
  MQTT_USERNAME: '', // Broker 用户名；无认证时留空
  MQTT_PASSWORD: '', // Broker 密码；无认证时留空
  MQTT_QOS: 1, // 0=最多一次，1=至少一次，2=仅一次。现场通常用 1

  // 语义主题。值必须与设备固件一致，键名 sensor/behavior/heartbeat/control 不可改名。
  MQTT_TOPICS: {
    // 传感量上报。本项目设备把传感器字段和行为字段放同一条消息上报，所以 behavior 也指向这个主题；
    // mqtt/index.js 检测到两者相同时会用合并处理器代替分开的处理器。
    sensor: 'receive',
    behavior: 'receive', // 执行器/运行状态上报
    heartbeat: 'heart_beat', // 设备心跳上报，用于在线/离线判断
    control: 'control', // PC 端向设备下发控制指令
  },

  // 超过该时间没收到某设备心跳就判离线（毫秒）。最小 1000。
  HEARTBEAT_TIMEOUT: 50000,

  // 心跳判定模式（两种互斥）：
  //   'receive' = 设备发一条 sensor/behavior 主题的数据就代表在线，不用单独发心跳包（默认）。
  //   'topic'   = 只认专门的心跳主题（MQTT_TOPICS.heartbeat），sensor/behavior 数据不影响在线判定。
  HEARTBEAT_MODE: 'receive',
}
