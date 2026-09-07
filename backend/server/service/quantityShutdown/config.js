/**
 * 【文件职责】定量停机的开关与目标值。逻辑在同目录 quantityShutdown.js。
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 【谁在读】quantityShutdown.js 本身。
 *
 * 设定一个定量值（单位 L）。本次计量周期累计流量 >= 该值时，关水泵和加热，整套系统自动停机。
 * 总流量只做累计统计，不参与实时调节。每次打开"定量停机"开关开启新周期，关闭则重置。
 * enabled / totalFlowTarget 在指令中心也有对应指令项（preffix=quantity_shutdown_enabled /
 * total_flow_target），指令项优先，删掉才退回这里。
 */
module.exports = {
  enabled: false,          // 定量停机总开关
  totalFlowTarget: 500,    // 定量值（L）
}
