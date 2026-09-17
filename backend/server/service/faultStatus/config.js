/**
 * 【文件职责】故障状态（硬故障保护 + 复位按钮状态机）的开关与参数。逻辑在同目录 faultStatus.js。
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 【谁在读】faultStatus.js 本身、service/controlShared/cooldown.js、routes 里的故障态接口。
 *
 * 触发任一启用条件时：①保存故障前快照 ②强制关水泵和加热 ③系统状态置 FAULT
 * ④复位按钮自动拨到"开"（仅 UI 显示）⑤指令页面其他开关和参数锁定只读。
 * 人工修复后手动把复位按钮拨回"关"→按快照恢复参数和开关、重启执行器，回到 NORMAL。
 *
 * 六种故障（编号对应需求文档）：
 *   ① pipe_blockage   进水口/管道堵塞：压力 < 压力下限 OR 压力 > 压力上限
 *   ② outlet_blockage 出水口堵塞：水泵预热完成后流量 < 流量下限
 *   ③ dry_burn        干烧：加热开启后连续 dryBurnDurationMs 出水温度变化 < dryBurnMinRiseC
 *   ④ pump_idle       水泵空转：水泵预热完成，流量 = 0
 *   ⑤ pump_fault      水泵故障：水泵预热完成，进出水温差 > tempDiffThreshold
 *   ⑥ pipe_leak       管道漏水：水泵预热完成后流量 > 流量上限 AND (压力 < 压力下限 OR 压力=0)
 * ②④⑤⑥ 共用前置条件：水泵必须已连续开启满 pumpWarmupMs 才开始判断。
 * ★ pumpWarmupMs（以及指令项 pump_warmup_ms"水泵预热宽限期(ms)"）不只故障机在用，改这个值下面几处一起变：
 *   · 安全联锁：规则2 流量异常、规则3 压力异常、规则6 流量剧烈波动，要等水泵预热完成才判
 *   · 阈值告警（alarm/evaluateRules.js）：流量过高/过低、压力过高/过低四条，要等水泵预热完成才判
 *   · 数据质量跳变过滤（dataQuality/spikeFilter.js）：水泵预热期内流量、压力不判跳变
 *   指令中心配了 pump_warmup_ms 就以页面为准，本文件的 pumpWarmupMs 只是指令项被删掉时的兜底。
 * 优先级（同时触发取最高）：干烧③ > 管道堵塞① > 管道漏水⑥ > 水泵故障⑤ > 水泵空转④ > 出水口堵塞②
 * 与安全联锁相互独立、都全程生效。
 * 注：压力上下限、流量上下限、目标温度等阈值仍只从指令中心 t_direct 实时读取。
 * 当前状态：总开关开着（enabled=true），②⑤⑥三条生效，④未启用。
 */     
module.exports = {
  enabled: false,            // 故障状态总开关

  // 六种故障各自的开关：只有写 true 才开；写 false、整行注释掉、删掉都算关
  pipeBlockage: true,       // 故障①：进水口/管道堵塞
  outletBlockage: true,     // 故障②：出水口堵塞
  dryBurn: true,            // 故障③：干烧
  pumpIdle: true,           // 故障④：水泵空转
  pumpFault: true,           // 故障⑤：水泵故障
  pipeLeak: true,           // 故障⑥：管道漏水（流量>上限 且 压力<下限或=0）

  dryBurnDurationMs: 60000, // 加热开启后判定"温度不上升"所需的持续时长（毫秒）
  dryBurnMinRiseC: 0.1,     // 温度上升超过这个值（℃）就算"有在升温"，重新计时
  alarmCooldownMs: 30000,   // 同一故障的冷却时间（毫秒）

  // 故障⑤水泵故障的温差阈值兜底默认值（℃）。指令中心配了 preffix=temp_diff 就优先用指令中心的。
  tempDiffThreshold: 30,
  pumpWarmupMs: 3000,       // 水泵预热宽限期（毫秒）兜底值，故障机 + 安全联锁 + 阈值告警 + 数据质量共用；指令项 pump_warmup_ms 优先
}
