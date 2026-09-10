/**
 * 【文件职责】本地阈值告警与自动联锁的开关和参数。判定逻辑在同目录 evaluateRules.js 的 checkAlarms 函数里。
 *
 * ★★ 赛场上要改告警判定条件或动作，改 evaluateRules.js 的 checkAlarms 函数 ★★
 *   本文件只管开关和参数，改完重启后端生效。
 *
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。
 * 【谁在读】evaluateRules.js 本身；app.js（转 WebSocket 广播）、mqtt handler（每条消息触发评估）。
 *
 * enabled：总开关，是否由服务端按规则自行计算告警；不影响设备主动上报的告警。
 * autoInterlockEnabled：规则触发后是否下发控制指令（每条规则里写的 action）。默认关，开启前必须实机安全测试。
 * 当前状态：总开关关着（enabled=false）。
 *
 * 各规则写成独立开关（temperatureHigh / flowLow / pressureHigh），赛场想临时停
 * 某一条把它设成 false 即可，不用动判定逻辑；阈值用对应 threshold 参数改。
 */
module.exports = {
  enabled: false,
  autoInterlockEnabled: false,

  // ==================== 各规则开关（赛场临时停掉某一条用） ====================
  temperatureHigh: true,  // 出水温度过高
  flowLow: true,           // 循环流量过低
  pressureHigh: true,      // 管路压力过高

  // ==================== 阈值参数 ====================
  temperatureHighThreshold: 29,   // 出水温度上限（℃）
  flowLowThreshold: 0.5,           // 循环流量下限
  pressureHighThreshold: 10,      // 管路压力上限

  // ==================== 冷却 ====================
  cooldownMs: 30000,  // 同一个"设备+规则"多久内只触发一次（毫秒）
}
