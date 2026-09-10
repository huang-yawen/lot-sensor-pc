/**
 * 【文件职责】定量停机的兜底参数。停机的判断条件和动作全写在同目录
 * quantityShutdown.js 的 evaluateQuantityShutdown 函数里，本文件只留两个兜底值。
 *
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 【谁在读】quantityShutdown.js 本身。
 *
 * enabled / totalFlowTarget 在指令中心也有对应项（preffix=quantity_shutdown_enabled /
 * total_flow_target），指令项优先，删掉才退回这里。
 * 每次打开"定量停机"开关会开启新的计量周期；关闭开关则重置计量周期。
 */
module.exports = {
  enabled: false,          // 定量停机总开关（指令中心 quantity_shutdown_enabled 优先）
  totalFlowTarget: 500,    // 兜底定量值（L），指令中心 total_flow_target 优先
}
