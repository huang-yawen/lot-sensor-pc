/**
 * 【文件职责】安全联锁的开关和参数。判定逻辑在同目录 safetyInterlock.js 的 checkRules 函数里。
 *
 * ★★ 赛场上要改安全联锁的判定条件或动作，改 safetyInterlock.js 的 checkRules 函数 ★★
 *   本文件只管开关和参数，改完重启后端生效。
 *
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。
 * 【谁在读】safetyInterlock.js 本身；requirePumpBeforeHeater 另被
 *   controlHelpers / pidHeating / scheduleService / updateDirectConfigAndPublish 读取。
 */
module.exports = {
  enabled: true, // 安全联锁总开关；关掉后下面所有条件都不判（requirePumpBeforeHeater 除外）

  // ==================== 各条件开关（赛场临时停掉某一条用） ====================
  manualMode: false,          // 进入手动模式时强制关泵关热
  flowLow: false,             // 流量异常（低于下限/为0/掉线）
  pressureHigh: false,        // 压力异常（高于上限/为0/掉线）
  tempHigh: false,            // 任一温度高于上限
  tempDiff: false,            // 温差过大
  flowVolatility: false,      // 流量剧烈波动（疑似水锤/湍流）
  sensorOffline: false,        // 传感器掉线（消息缺字段 或 设备心跳超时）
  heaterWithoutPump: false,   // 未开水泵却开启加热

  // ==================== 参数（规则里用 ctx.config 取） ====================
  tempDiffThreshold: 10,       // 温差阈值兜底值（℃），指令中心没配才用它
  flowVolatilityThreshold: 20, // 流量波动阈值兜底值
  flowVolatilityWindow: 10,    // 波动判定的滑动窗口点数（攒够这么多个读数才开始判）

  // 源头拦截：开加热前必须先开水泵，否则拒绝这次开加热请求。
  // 这条不受上面 enabled 总开关约束——它不是"事后关掉"，而是
  // 在 updateDirectConfigAndPublish / pidHeating / scheduleService 三处下发前直接拦住。
  requirePumpBeforeHeater: false,

  alarmCooldownMs: 30000,  // 同一个"设备+规则"多久内只触发一次（毫秒）
  showOnErrorPage: true,   // 故障记录页是否显示"安全联锁记录"表格（只控制前端展示）
  abnormalMax: 9999,       // 传感器异常哨兵值：读数 >= 它视为掉线/短路（联动规则也共用这一处）
  monitorIntervalMs: 5000, // 掉线监测定时器周期，启动时读一次，改了要重启后端
}
