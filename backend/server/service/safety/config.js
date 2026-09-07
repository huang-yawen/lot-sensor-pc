/**
 * 【文件职责】安全联锁的开关与参数。安全联锁：命中任一启用条件就强制关水泵和加热，
 * 并往 t_error_msg 写一条 type='安全联锁' 的记录。逻辑在同目录 safetyInterlock.js。
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 【谁在读】safetyInterlock.js 本身，以及 pidHeating / linkageRules / cooldown /
 * controlHelpers / computedMetrics 的几个查询（它们只读少数几项，如异常哨兵值）。
 *
 * 说明：温度/流量/压力的上下限阈值不写在这里，实时从指令中心 t_direct 读取
 * （用户在"设备设置"页改阈值即时生效）。这里只放"是否启用某条判定"和纯软件参数。
 * 当前状态：总开关开着，但除 sensorOffline 外的具体判定条件都关着。
 */
module.exports = {
  enabled: true,           // 安全联锁总开关

  flowLow: false,          // 流量低于下限阈值 或 流量为 0
  pressureHigh: false,     // 压力高于上限阈值 或 压力为 0
  tempHigh: false,         // 任一温度高于上限阈值
  tempDiff: false,         // 温差过大（两路温度差 > tempDiffThreshold）
  tempDiffThreshold: 10,   // 温差阈值（℃），tempDiff=true 时生效

  // 流量剧烈波动（疑似水锤/湍流）：最近 flowVolatilityWindow 个读数的极差 > 阈值就触发。
  flowVolatility: false,
  flowVolatilityThreshold: 20,
  flowVolatilityWindow: 10,   // 实时联锁用的内存滑动窗口点数

  manualMode: false,       // 进入手动模式时安全关闭一次
  sensorOffline: true,     // 任一传感器掉线（长期无数据 / 长期为 0 / 顶到异常最大值）

  heaterWithoutPump: false,        // 事后检测：加热开了才发现没水泵，检测到就强制两个都关
  requirePumpBeforeHeater: false,  // 源头拦截：开加热前必须先开水泵，否则拒绝这次开加热请求
                                   // （生效不受上面 enabled 总开关约束）

  alarmCooldownMs: 30000,  // 同一告警的冷却时间（毫秒）
  showOnErrorPage: true,   // 故障记录页是否显示"安全联锁记录"表格（只控制前端展示）

  // 传感器读数异常/掉线判定的哨兵值：读数 >= 它视为异常（如传感器故障卡在满量程）。
  // 安全联锁和联动控制（linkageRules.js）共用这一处；现场满量程不是 9999 时改这里。
  abnormalMax: 9999,
  // 掉线监测定时器的检测周期（毫秒）。后端启动时读一次，改了要重启后端才生效。
  monitorIntervalMs: 5000,
}
