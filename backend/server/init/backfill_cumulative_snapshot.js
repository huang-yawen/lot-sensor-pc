/**
 * 【文件职责】一次性回填累计快照表 t_cumulative_snapshot。
 *
 * 背景：累计值改成“落库时增量写入快照表”（见 service/cumulative/cumulativeSnapshotService.js），
 * 建表之前已有的历史数据在快照表里是空的，需要跑一次本脚本把历史累计值补出来，否则历史
 * 图表页 / 计算指标明细表只能看到新数据（且会回退到原来的实时计算，比较慢）。
 *
 * 用法（在 backend/server 目录下，或任意目录用绝对路径）：
 *   node backend/server/init/backfill_cumulative_snapshot.js
 *
 * ⚠️ 脚本会先 TRUNCATE 快照表再重新生成（避免重复累加），执行完请**重启后端**，
 *    让内存里的累计运行态重新从快照表恢复。
 *
 * 【配置】指标定义读 CUMULATIVE_METRICS（config/metrics.js），只处理 enabled 且
 * aggregation 为 flow_integral / on_duration 的两类累计指标。
 */
const promisePool = require('../config/dbPool')
const { CUMULATIVE_METRICS } = require('../config/metrics')
const { SNAPSHOT_TABLE, ensureTable } = require('../service/cumulative/cumulativeSnapshotService')

const MAX_GAP_SEC = 10

/** flow_integral（累计流量）：按 d_no 分区，从该设备第一条数据起算的积分累计。 */
function flowIntegralSql(metricKey, field) {
  return `
    INSERT INTO ${SNAPSHOT_TABLE} (d_no, metric_key, c_time, cumulative_value)
    SELECT d_no, '${metricKey}', c_time,
      ROUND(
        SUM(GREATEST(COALESCE(v, 0), 0) / 60 * LEAST(COALESCE(dt_sec, 1), ${MAX_GAP_SEC}))
          OVER (PARTITION BY d_no ORDER BY c_time ASC, id ASC ROWS UNBOUNDED PRECEDING),
        6)
    FROM (
      SELECT id, d_no, c_time,
        CAST(NULLIF(\`${field}\`, '') AS DECIMAL(20,6)) AS v,
        TIMESTAMPDIFF(SECOND, LAG(c_time) OVER (PARTITION BY d_no ORDER BY c_time ASC, id ASC), c_time) AS dt_sec
      FROM t_sensor_data
    ) AS t
  `
}

/** on_duration（累计运行时长）：按 d_no 分区，累加开关为 '1' 的行之间的真实时间（分钟）。 */
function onDurationSql(metricKey, field) {
  return `
    INSERT INTO ${SNAPSHOT_TABLE} (d_no, metric_key, c_time, cumulative_value)
    SELECT d_no, '${metricKey}', c_time,
      ROUND(
        SUM(COALESCE(is_on * LEAST(dt_sec, ${MAX_GAP_SEC}), 0))
          OVER (PARTITION BY d_no ORDER BY c_time ASC, id ASC ROWS UNBOUNDED PRECEDING) / 60,
        6)
    FROM (
      SELECT id, d_no, c_time,
        CASE WHEN TRIM(\`${field}\`) = '1' THEN 1 ELSE 0 END AS is_on,
        TIMESTAMPDIFF(SECOND, LAG(c_time) OVER (PARTITION BY d_no ORDER BY c_time ASC, id ASC), c_time) AS dt_sec
      FROM t_behavior_data
    ) AS t
  `
}

;(async () => {
  try {
    await ensureTable()
    await promisePool.query(`TRUNCATE TABLE ${SNAPSHOT_TABLE}`)
    console.log(`[Backfill] 已清空 ${SNAPSHOT_TABLE}`)

    const metrics = (CUMULATIVE_METRICS || []).filter(
      m => m.enabled && (m.aggregation === 'flow_integral' || m.aggregation === 'on_duration')
    )
    if (!metrics.length) {
      console.log('[Backfill] 没有需要回填的累计指标（flow_integral / on_duration）')
      process.exit(0)
    }

    for (const metric of metrics) {
      const sql = metric.aggregation === 'flow_integral'
        ? flowIntegralSql(metric.metric_key, metric.source_field)
        : onDurationSql(metric.metric_key, metric.source_field)
      const t0 = Date.now()
      const [result] = await promisePool.query(sql)
      console.log(`[Backfill] ${metric.metric_key} (${metric.source_table}.${metric.source_field}) 回填 ${result.affectedRows} 行，耗时 ${Date.now() - t0} ms`)
    }

    console.log('[Backfill] 完成，请重启后端让内存累计态重新从快照表恢复。')
    process.exit(0)
  } catch (err) {
    console.error('[Backfill] 失败:', err)
    process.exit(1)
  }
})()
