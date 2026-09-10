/**
 * 【文件职责】定温停机的兜底开关与兜底阈值。判断条件和停机动作全写在
 * tempShutdown.js 的 evaluateTempShutdown 函数里，本文件只留两个兜底值。
 *
 * ★★ 赛场上要改定温停机，改 tempShutdown.js 的 evaluateTempShutdown 函数就够了 ★★
 *
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 【谁在读】tempShutdown.js 本身。
 */
module.exports = {
  enabled: false,   // 兜底开关（指令中心 shutdown_temp 有值且 > 0 时会覆盖为启用）
  shutdownTemp: 0,  // 兜底温度阈值（℃），指令中心 shutdown_temp 优先；<= 0 等于不启用
}
