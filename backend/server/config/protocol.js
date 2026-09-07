/**
 * 【文件职责】设备上报报文的字段兼容配置：设备编号 / 时间字段的候选名，以及
 * 页面控制值 ↔ 设备线上值的映射。
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 【谁在读】utils/protocol.js、mqtt 各 handler、utils/mappedData.js、指令下发相关服务。
 */
module.exports = {
  // 普通数据包中"设备编号"的候选字段，按数组顺序查找，大小写不敏感。
  // 例如设备上报 {"deviceId":"water-01"} 会命中 deviceId。
  // id 排第一：现场设备上报的字段就叫 id（值是硬件编号，要和 t_device.number 完全一致
  // 才被采信，见 utils/mappedData.js resolveDeviceNo）。
  DEVICE_ID_FIELDS: ['id', 'VID', 'deviceId', 'device_id', 'd_no', 'DNO'],

  // 普通数据包中"采集时间"的候选字段，按顺序查找；都没有时用服务器当前时间。
  // 推荐设备直接上报 YYYY-MM-DD HH:mm:ss，避免现场时区解析差异。
  TIME_FIELDS: ['Time', 'time', 'timestamp', 'c_time'],

  // JSON 格式心跳中的设备编号候选字段。纯文本心跳（如 water-01）也支持。
  HEARTBEAT_DEVICE_FIELDS: ['id', 'VID', 'deviceId', 'device_id', 'd_no', 'DNO'],

  // 页面/数据库控制值 → 设备真实值的映射。
  // 示例：页面存 on、设备协议要 open，则下发 open；设备回报 open 时反向存为 on。
  // 若设备直接接受 on/off，改为 { on: 'on', off: 'off' }。
  CONTROL_VALUE_MAP: { on: 'open', off: 'close' },
}
