/**
 * 【文件职责】定温停机的兜底开关与阈值。逻辑在同目录 tempShutdown.js。
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 【谁在读】tempShutdown.js 本身。
 *
 * 设定一个出水温度阈值（℃），当出水温度 >= 该阈值时，关闭水泵和加热，整套系统自动停机。
 * 与定量停机（累计流量达到目标停机）对称：一个按温度、一个按流量，两条独立的停机保护。
 *
 * enabled / shutdownTemp 在指令中心有对应指令项（preffix=shutdown_temp），指令项优先，
 * 删掉才退回这里。指令中心没有独立的 shutdown_temp_enabled 开关，靠 shutdown_temp > 0
 * 自动启用，shutdown_temp <= 0 或未配置则不启用。
 *
 * 当前状态：兜底关着（enabled=false），阈值兜底 0（等于不启用）。
 */
module.exports = {
  enabled: false,          // 兜底开关（指令中心 shutdown_temp 有值且 > 0 时会覆盖为启用）
  shutdownTemp: 0,         // 兜底温度阈值（℃），指令中心 shutdown_temp 优先
}
