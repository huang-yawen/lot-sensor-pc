/**
 * 【文件职责】自定义公式指标的历史图表查询：按时间范围从 t_sensor_data 查询已勾选
 * "历史图表"的公式指标，供历史图表页面画图。
 * 只支持传感器数据表——历史图表页面现在所有图表统一查 t_sensor_data，公式如果引用了
 * 行为数据字段，这里查不出正确结果（前端勾选框旁边会提示这个限制）。
 * 【配置】无直接读取；公式定义来自 t_derived_metric，每次请求动态读取。
 */
const promisePool = require('../../config/dbPool')
const { getEnabledMetrics, compileMetricSql } = require('./derivedMetricService')
const { calcBucketSeconds } = require('../../utils/timeRange')

/**
 * @param {Object} [options]
 * @param {string} [options.d_no]
 * @param {number} [options.limit=300]
 * @param {string} [options.startTime]
 * @param {string} [options.endTime]
 * @returns {Object} { metric_key: { config: {metric_key, metric_name, unit, chart_type, color}, rows: [{c_time, value}] } }
 */
async function queryDerivedMetricHistory(options = {}) {
  const { d_no, limit = 300, startTime, endTime } = options
  const metrics = await getEnabledMetrics('historyChart')
  if (metrics.length === 0) return {}

  const safeLimit = Math.min(2000, Math.max(1, Number.parseInt(limit, 10) || 300))
  const conditions = []
  const whereParams = []
  if (d_no) { conditions.push('d_no = ?'); whereParams.push(d_no) }
  if (startTime) { conditions.push('c_time >= ?'); whereParams.push(startTime) }
  if (endTime) { conditions.push('c_time <= ?'); whereParams.push(endTime) }
  const whereExtra = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  // 自定义公式基于单行传感器读数计算，属于瞬时量，按时间等宽分桶后取均值——道理跟
  // averageChartQuery.js 一致，保证不同时间范围能展现横跨整个范围的趋势。
  const bucketSeconds = startTime ? calcBucketSeconds({ startTime, endTime, pointLimit: safeLimit }) : 1

  const results = {}
  await Promise.all(metrics.map(async (metric) => {
    try {
      const valueExpr = compileMetricSql(metric)
      const sql = `
        SELECT MIN(c_time) AS c_time, AVG(value) AS value
        FROM (
          SELECT FLOOR(UNIX_TIMESTAMP(c_time) / ?) AS bucket, c_time, ${valueExpr} AS value
          FROM t_sensor_data
          WHERE 1=1 ${whereExtra}
        ) AS calculated
        GROUP BY bucket
        ORDER BY c_time ASC
        LIMIT ?
      `
      const [rows] = await promisePool.query(sql, [bucketSeconds, ...whereParams, safeLimit])
      results[metric.metric_key] = {
        config: {
          metric_key: metric.metric_key,
          metric_name: metric.metric_name,
          unit: metric.unit,
          chart_type: metric.chart_type,
          color: metric.color,
        },
        rows,
      }
    } catch (err) {
      console.error(`[DerivedMetricHistoryQuery] 查询 ${metric.metric_key} 失败:`, err.message)
      results[metric.metric_key] = {
        config: { metric_key: metric.metric_key, metric_name: metric.metric_name, unit: metric.unit, chart_type: metric.chart_type, color: metric.color },
        rows: [],
        error: err.message,
      }
    }
  }))
  return results
}

module.exports = { queryDerivedMetricHistory }
