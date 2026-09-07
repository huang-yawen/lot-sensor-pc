/**
 * 【文件职责】正常状况联动规则的开关与参数。逻辑在同目录 linkageRules.js。
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 【谁在读】linkageRules.js 本身；mqtt 的 sensorRealtime / combinedRealtime handler
 * （每条消息触发一次规则评估）。
 *
 * 仅在"自动模式"下运行，与安全联锁、故障状态相互独立、全程并行。
 * 9 条规则逐条独立开关，可任意组合勾选。同一执行器本轮多条规则命中且结论矛盾时，
 * "关闭"优先于"打开"（fail-safe）。目标温度用 config/appSettings.js 的 DEFAULT_TARGET_TEMP。
 * 阈值实时读指令中心 t_direct，页面改即时生效。
 * 当前状态：总开关开着，具体规则全部关着（只有 enabled=true 但没有勾选任何一条规则）。
 */
module.exports = {
  enabled: true,                   // 联动总开关

  pumpAlwaysOn: false,             // 水泵常开：无故障、读数没顶到异常哨兵就保持运行

  // 加热滞回带通断这条规则的参数。（这条规则本身是否生效由指令中心 preffix=heater_hysteresis_enabled
  // 决定，不在这里勾；和 pid_enabled 各自独立，两个都开时 PID 优先。）
  heaterHysteresisValue: 0.1,      // 回差（℃）：出水温度低于"目标-回差"才开，达到目标就关
  tempDiffOpenThreshold: 3,        // 温差过大判定阈值（℃），超过关闭加热
  heaterHysteresisMinOnMs: 5000,   // 最小开启驻留（ms），防加热继电器在目标温度附近高频通断
  heaterHysteresisMinOffMs: 5000,  // 最小关闭驻留（ms）

  flowSingle: false,               // 流量单层：区间内/低于下限开泵，高于上限关泵保护
  pressureSingle: false,           // 压力单层：低于下限开泵，高于上限关泵、关加热
  tempSingle: false,               // 温度单层（带滞回）：低于目标/下限开加热，高于目标/上限关加热
  tempSingleHysteresis: 1,         // 温度单层滞回回差（℃）
  dualTemp: false,                 // 双温度融合：温差超过阈值开泵
  dualTempDiffThreshold: 2,        // 双温度融合温差阈值（℃），建议比安全联锁的温差阈值小
  tempFlow: false,                 // 温度+流量融合
  pressureFlow: false,             // 压力+流量融合
  tempPressure: false,             // 温度+压力融合
}
