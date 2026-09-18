/**
 * 【文件职责】累计快照（t_cumulative_snapshot）的写入节流与保留策略。
 * 【值的来源】新增板块，下面是首次设定的默认值。改完重启后端生效。
 * 【谁在读】service/cumulative/cumulativeSnapshotService.js 及其清理定时器。
 *
 * 为什么需要：累计值是慢变量，没必要每条上报都往快照表落一行——按 minWriteIntervalMs 节流
 * 写入，就能把行数从“数据条数”降到“时长 ÷ 间隔”；再用 retentionDays 定期删过期行，避免表
 * 随时间无限增长。注意：内存里的累计值仍然**每条上报都精确累加**（首页取最新值直接用内存值），
 * 节流只影响“落库的快照点密度”，查询曲线 / 明细表完全够用。
 */
module.exports = {
  // 总开关：false 时不再写快照，查询自动回退到原来的实时计算（表里已有数据保留不动）
  enabled: true,
  // 同一设备同一指标两次写快照的最小间隔（ms）：5000 = 最多每 5 秒落一行；0 = 每条上报都落
  minWriteIntervalMs: 5000,
  // 快照保留天数：超过的定期删除；0 或负数 = 永久保留、不清理
  retentionDays: 30,
  // 清理任务执行间隔（ms），默认 6 小时
  cleanupIntervalMs: 6 * 60 * 60 * 1000,
  // 单次清理最多删多少行（分批删，避免长事务锁表）
  cleanupBatchSize: 5000,
}
