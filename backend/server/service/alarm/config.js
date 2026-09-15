/**
 * 【文件职责】本地阈值告警与自动联锁的开关和参数。判定逻辑在同目录 evaluateRules.js 的 checkAlarms 函数里。
 *
 * ★★ 赛场上要改告警判定条件或动作，改 evaluateRules.js 的 checkAlarms 函数 ★★
 *   本文件只管开关和参数，改完重启后端生效。
 *
 * ★★ 总开关看本文件，六个阈值本文件只是"兜底层" ★★
 *   总开关 enabled 只认本文件：指令页面上**没有**告警的开关项，这里开了告警就在跑，
 *   关了就整个不跑。改完要重启后端。
 *
 *   六个阈值是两层结构，跟 PID 恒温、定量停机、定温停机取参数一样：**指令页面
 *   t_direct 里配了就以页面为准**（网页上改完即时生效，不用重启后端）；指令项被
 *   删掉、或者从没填过值时，才退回本文件的值。现场调阈值的第一顺位是指令页面。
 *
 *   温度上限    → 指令项 temp_high      没配才看 temperatureHighThreshold
 *   温度下限    → 指令项 temp_low       没配才看 temperatureLowThreshold
 *   流量上限    → 指令项 flow_high      没配才看 flowHighThreshold
 *   流量下限    → 指令项 flow_low       没配才看 flowLowThreshold
 *   压力上限    → 指令项 pressure_high  没配才看 pressureHighThreshold
 *   压力下限    → 指令项 pressure_low   没配才看 pressureLowThreshold
 *
 *   注意这六个指令项跟安全联锁、故障状态机、联动规则用的是同一份值（都走
 *   controlHelpers.js 的 THRESHOLD_SLOTS），在页面上调一个，那几处的判定会跟着变。
 *
 *   剩下的几项（enabled / autoInterlockEnabled / 六条规则开关 / cooldownMs）只在
 *   本文件，改完要重启后端——跟安全联锁的逐条条件开关、联动的九条规则开关一样。
 *
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。
 * 【谁在读】evaluateRules.js 本身；app.js（转 WebSocket 广播）、mqtt handler（每条消息触发评估）。
 *
 * enabled：总开关，是否由服务端按规则自行计算告警；不影响设备主动上报的告警。
 * autoInterlockEnabled：规则触发后是否下发控制指令（每条规则里写的 actions 数组，可以同时放
 *   水泵和加热，写法见 evaluateRules.js 的 checkAlarms 注释）。开启前必须实机安全测试。
 * 当前状态：总开关关着（enabled=false），要用告警把它改成 true 再重启后端。
 *
 * 六条规则写成独立开关，三对上下限（温度 / 流量 / 压力），赛场想临时停某一条把它
 * 设成 false 即可，不用动判定逻辑。
 *
 * 温度两路一起判：进水（SENSOR_FIELD_MAP.temp1）和出水（temp2）任意一路越限就报，
 * 告警文案里会写明是哪一路，不用为两路各配一套阈值。
 */
module.exports = {
  enabled: false,
  autoInterlockEnabled: true,

  // ==================== 各规则开关（赛场临时停掉某一条用，只在本文件） ====================
  temperatureHigh: true,  // 温度过高（进水/出水任一路超上限）
  temperatureLow: true,   // 温度过低（进水/出水任一路低于下限）
  flowHigh: false,         // 循环流量过高（水泵预热完成后才判）
  flowLow: false,          // 循环流量过低（水泵预热完成后才判）
  pressureHigh: true,     // 管路压力过高（水泵预热完成后才判）
  pressureLow: true,      // 管路压力过低（水泵预热完成后才判）
  // ↑ 流量/压力四条的水泵预热时长：指令中心"水泵预热宽限期(ms)"（pump_warmup_ms）优先，
  //   没配才用 faultStatus/config.js 的 pumpWarmupMs，跟安全联锁、故障机、数据质量共用一份

  // ==================== 阈值兜底值（指令页面没配才用这里的） ====================
  // ★ 下面六个值里，只有 temperatureHighThreshold / flowLowThreshold / pressureHighThreshold
  //   是原来就在跑的实际生效值；另外三个是按现有值推的占位数，赛场必须按赛题给的量程
  //   重新标定一遍，否则要么一直不报、要么一上电就刷屏。
  // ★ 优先在指令页面上改（即时生效）；这里的值只有在指令项被删掉时才会用到。
  temperatureHighThreshold: 29,   // 温度上限（℃），对应指令项 temp_high
  temperatureLowThreshold: 10,    // 温度下限（℃），对应指令项 temp_low——占位值，按赛题标定
  flowHighThreshold: 10,          // 循环流量上限，对应指令项 flow_high——占位值，按赛题标定
  flowLowThreshold: 0.5,          // 循环流量下限，对应指令项 flow_low
  pressureHighThreshold: 10,      // 管路压力上限，对应指令项 pressure_high
  pressureLowThreshold: 0.5,      // 管路压力下限，对应指令项 pressure_low——占位值，按赛题标定

  // ==================== 冷却 ====================
  cooldownMs: 30000,  // 同一个"设备+规则"多久内只触发一次（毫秒）
}
