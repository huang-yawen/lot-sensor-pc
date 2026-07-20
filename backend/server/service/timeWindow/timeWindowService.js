/**
 * 时间窗口派生指标服务：滑动平均、波动幅度和相邻变化量。
 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')

function getEnabledTimeWindowMetrics() {
  return (systemConfig.getConfig().TIME_WINDOW_METRICS || []).filter(metric => metric.enabled)
}

function aggregationSql(metric) {
  const value = `CAST(NULLIF(\`${metric.source_field}\`, '') AS DECIMAL(20,6))`
  const preceding = Math.max(1, (metric.window_size || 5) - 1)
  if (metric.aggregation === 'avg') {
    return `AVG(${value}) OVER (ORDER BY c_time, id ROWS ${preceding} PRECEDING)`
  }
  if (metric.aggregation === 'volatility') {
    return `MAX(${value}) OVER (ORDER BY c_time, id ROWS ${preceding} PRECEDING) - MIN(${value}) OVER (ORDER BY c_time, id ROWS ${preceding} PRECEDING)`
  }
  if (metric.aggregation === 'rate') {
    return `${value} - LAG(${value}, 1) OVER (ORDER BY c_time, id)`
  }
  throw new Error(`不支持的聚合类型: ${metric.aggregation}`)
}

async function querySingleTimeWindow(metric, options = {}) {
  const { d_no, limit = 30 } = options
  const precision = metric.precision ?? 2
  const safeLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 30))
  const params = []
  if (d_no) params.push(d_no)
  params.push(safeLimit)

  // 窗口函数先在全部匹配行上计算，随后才取最近 N 条，避免窗口在分页边界被截断。
  const sql = `
    SELECT c_time, ROUND(raw_result, ${precision}) AS value
    FROM (
      SELECT id, c_time, ${aggregationSql(metric)} AS raw_result
      FROM ${metric.source_table}
      WHERE 1=1 ${d_no ? 'AND d_no = ?' : ''}
      ORDER BY c_time DESC, id DESC
      LIMIT ?
    ) AS recent
    WHERE raw_result IS NOT NULL
    ORDER BY c_time ASC, id ASC
  `
  const [rows] = await promisePool.query(sql, params)
  return rows
}

async function queryAllTimeWindow(options = {}) {
  const results = {}
  await Promise.all(getEnabledTimeWindowMetrics().map(async metric => {
    try {
      results[metric.metric_key] = await querySingleTimeWindow(metric, options)
    } catch (error) {
      console.error(`[TimeWindowService] 查询 ${metric.metric_key} 失败:`, error.message)
      results[metric.metric_key] = []
    }
  }))
  return results
}

function buildInlineTimeWindowSql(sourceTable) {
  const metrics = getEnabledTimeWindowMetrics()
    .filter(metric => (metric.mode === 'inline' || metric.mode === 'both') && metric.source_table === sourceTable)
  if (!metrics.length) return { selectFragment: '', metrics: [] }
  const fragments = metrics.map(metric => {
    const alias = String(metric.metric_name).replace(/`/g, '``')
    return `ROUND(${aggregationSql(metric)}, ${metric.precision ?? 2}) AS \`${alias}\``
  })
  return { selectFragment: `, ${fragments.join(', ')}`, metrics }
}

module.exports = {
  getEnabledTimeWindowMetrics,
  querySingleTimeWindow,
  queryAllTimeWindow,
  buildInlineTimeWindowSql,
}
