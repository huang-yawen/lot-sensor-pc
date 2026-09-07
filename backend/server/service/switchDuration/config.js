/**
 * 【文件职责】首页开关运行时长显示开关。逻辑在同目录 switchDurationService.js。
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 【谁在读】switchDurationService.js、controllers/switchDuration/switchDurationController.js。
 *
 * 控制首页"最新传感数据"运行状态区，水泵/加热开启时是否额外显示"累计运行时长"和
 * "本次已运行时长"。数据来源固定为 config/metrics.js 里 metric_key 为
 * cumulative_pump_time / cumulative_heat_time 的两条累计指标。
 */
module.exports = {
  enabled: true,
}
