/**
 * 【文件职责】定温停机的兜底开关与兜底阈值。判断条件和停机动作全写在
 * tempShutdown.js 的 evaluateTempShutdown 函数里，本文件只留两个兜底值。
 *
 * ★★ 赛场上要改定温停机，改 tempShutdown.js 的 evaluateTempShutdown 函数就够了 ★★
 *
 * enabled / shutdownTemp 在指令中心都有对应指令项（preffix=shutdown_temp_enabled /
 * shutdown_temp），指令项优先，删掉才退回这里；跟 quantityShutdown/config.js 是同一套
 * "指令中心优先、配置中心兜底"约定。控制模式（auto_control_enabled）明确是手动时，
 * enabled 兜底也不生效，见 tempShutdown.js 的 isTempShutdownEnabled。
 *
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 【谁在读】tempShutdown.js 本身。
 */
module.exports = {
  enabled: false,    // 兜底开关（指令中心 shutdown_temp_enabled 没配置指令项时才用这个）
  // 兜底温度阈值（℃），指令中心 shutdown_temp 优先。tempShutdown.js 把 <= 0 当"无效阈值"
  // 直接跳过判断——这里原来是 0，等于不管开关开没开，这个功能永远不会触发（指令中心
  // shutdown_temp 这个指令项虽然存在，但从没人在页面上填过值，一直退到这里的 0）。
  // 40 只是占位值（比当前目标温度 32℃ 高一截），需要按赛题实际水温上限重新标定。
  shutdownTemp: 40,
}
