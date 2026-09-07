/**
 * 【文件职责】PID 恒温控制的兜底参数。逻辑在同目录 pidHeating.js。
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 【谁在读】pidHeating.js 本身；averageChartQuery / heaterEnergyQuery / heatingAnalysisQuery
 * 拿它算参考曲线。
 *
 * 加热模块只有开关量、没有功率输出，用"时间比例控制"模拟 PWM：固定周期 windowMs，
 * PID 输出的占空比 duty(0~100%) 决定这个周期内加热开多久。只接管加热，水泵仍由联动规则决定。
 * 是否真正启用由指令中心开关 preffix=pid_enabled 决定（和 heater_hysteresis_enabled 各自独立，
 * 两个都开时 PID 优先）；这里的 enabled 只在指令项还没配置时用作兜底。
 * kp/ki/kd/windowMs 等在指令中心都有对应指令项，指令项优先，删掉指令项才退回这里。
 * 目标温度不在这里，统一用 config/appSettings.js 的 DEFAULT_TARGET_TEMP。
 */
module.exports = {
  enabled: true,           // PID 恒温兜底开关（现场指令项优先）
  kp: 20,                  // 比例系数：差得越多加得越猛。调大→升温快但易震荡
  ki: 0.5,                 // 积分系数：消除稳态误差。调大→消差快但易超调
  kd: 5,                   // 微分系数：接近目标提前刹车。调大→超调小但对噪声敏感
  windowMs: 10000,         // 时间比例控制周期（毫秒）

  // 精准控制增强参数（指令项未配置时用这些默认值）
  deadband: 0,             // 死区(℃)：误差小于此值保持上一次 duty；0=不用死区
  derivativeFilter: 0.3,   // 微分滤波系数 0~1：越小滤波越强
  dutyRampLimit: 15,       // 占空比斜率限制(%/周期)：0=不限制
  kff: 0,                  // 前馈系数：0=禁用，建议 0.5~2
}
