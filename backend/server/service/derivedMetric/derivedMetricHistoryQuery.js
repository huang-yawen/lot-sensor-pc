/**
 * 【文件职责】自定义公式指标的历史图表查询：按时间范围从 t_sensor_data 查询已勾选
 * "历史图表"的公式指标，供历史图表页面画图。
 * 只支持传感器数据表——历史图表页面现在所有图表统一查 t_sensor_data，公式如果引用了
 * 行为数据字段，这里查不出正确结果（前端勾选框旁边会提示这个限制）。
 * 【配置中心关联】无直接读取；公式定义来自 t_derived_metric，每次请求动态读取。
 */
const promisePool = require('../../config/dbPool')
const { getEnabledMetrics, compileMetricSql } = require('./derivedMetricService')

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
  const params = []
  if (d_no) { conditions.push('d_no = ?'); params.push(d_no) }
  if (startTime) { conditions.push('c_time >= ?'); params.push(startTime) }
  if (endTime) { conditions.push('c_time <= ?'); params.push(endTime) }
  const whereExtra = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  const results = {}
  await Promise.all(metrics.map(async (metric) => {
    try {
      const valueExpr = compileMetricSql(metric)
      const sql = `
        SELECT c_time, value
        FROM (
          SELECT id, c_time, ${valueExpr} AS value
          FROM t_sensor_data
          WHERE 1=1 ${whereExtra}
          ORDER BY c_time DESC, id DESC
          LIMIT ?
        ) AS recent
        ORDER BY c_time ASC, id ASC
      `
      const [rows] = await promisePool.query(sql, [...params, safeLimit])
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
