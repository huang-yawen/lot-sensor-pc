/**
 * 【文件职责】MQTT 连接参数、主题名、心跳判定方式。
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 注意：这几项以前是"持久化配置 > .env > 源码默认"，现在就以本文件为准，.env 里的
 * MQTT_URL/MQTT_CLIENT_ID/MQTT_USERNAME/MQTT_PASSWORD 全部不再生效，已从 .env 删除。
 * 【谁在读】mqtt/index.js（建连接、订阅、心跳）、mqtt/deviceManager.js（离线阈值）、
 * app.js 和若干服务（拿 MQTT_TOPICS 判断主题）。
 */
module.exports = {
  // Broker 地址，必须以 mqtt:// 或 mqtts:// 开头。
  // 现场备选（换网络环境时直接替换下面这行，原先记在 server/.env 里）：
  //   路由器   mqtt://192.168.1.100:1883
  //   lsr热点  mqtt://10.97.241.240:1883
  //   本机     mqtt://localhost:1883
  MQTT_URL: 'mqtt://192.168.1.110:1883',
  // MQTT_URL: 'mqtt://localhost:1883',
  // 客户端标识。同一个 Broker 上 client id 必须唯一——两个后端实例用同一个 id 会被
  // Broker 交替踢下线，表现为 MQTT 反复断连重连、指令下发时报「MQTT 未连接」。
  MQTT_CLIENT_ID: 'lot-sensor-pc-test1',
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
    // PC 心跳下发（PC→设备），方向跟上面的 heartbeat 相反、必须是不同的主题名。
    // 设备靠"能不能持续收到这个主题的消息"判断上位机在不在线，收不到就自己缓存数据。
    pcHeartbeat: 'heart',
    // 设备断线期间缓存的数据，恢复联系后从这个主题补传上来（设备→PC）。
    // 报文结构跟 sensor/behavior 完全一样，只是落库时标记成"补传数据"。
    offlineData: 'offline',
  },

  // PC 心跳：判定设备在线时，每隔 PC_HEARTBEAT_INTERVAL 毫秒往 MQTT_TOPICS.pcHeartbeat
  // 发一条内容随意的消息；设备离线（超过 HEARTBEAT_TIMEOUT 没上报）或 MQTT 没连上就不发。
  // 关掉后设备会一直认为上位机离线、持续缓存数据，只在调试时才关。见 mqtt/pcHeartbeat.js。
  PC_HEARTBEAT_ENABLED: true,
  PC_HEARTBEAT_INTERVAL: 1000,

  // 超过该时间没收到某设备心跳就判离线（毫秒）。最小 1000。
  HEARTBEAT_TIMEOUT: 5000,

  // 心跳判定模式（两种互斥）：
  //   'receive' = 设备发一条 sensor/behavior 主题的数据就代表在线，不用单独发心跳包（默认）。
  //   'topic'   = 只认专门的心跳主题（MQTT_TOPICS.heartbeat），sensor/behavior 数据不影响在线判定。
  HEARTBEAT_MODE: 'receive',
}
