/**
 * 【文件职责】操作历史的记录模式。逻辑在同目录 operationHistoryPolicy.js。
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 【谁在读】operationHistoryPolicy.js。
 *
 * MODE 取值：
 *   'both'          - 同时记录软件指令和底层操作（推荐）
 *   'software_only' - 只记录软件指令（页面在线下发、离线补发、自动联锁、自动校时）
 *   'device_only'   - 只记录底层操作（设备状态上报与系统期望不一致时识别出的现场操作）
 *   'off'           - 完全关闭操作历史写入
 */
module.exports = {
  OPERATION_HISTORY_MODE: 'both',
}
