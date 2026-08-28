/**
 * 时间窗口派生指标服务：滑动平均、波动幅度和相邻变化量。
 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')
const { calcBucketSeconds } = require('../../utils/timeRange')

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
  const { d_no, limit = 300, startTime, endTime } = options
  const precision = metric.precision ?? 2
  const safeLimit = Math.min(2000, Math.max(1, Number.parseInt(limit, 10) || 300))
  const conditions = []
  const whereParams = []
  if (d_no) { conditions.push('d_no = ?'); whereParams.push(d_no) }
  // 时间范围过滤放在窗口函数计算之前，保证滑动窗口只在所选时间范围内的数据上滚动。
  if (startTime) { conditions.push('c_time >= ?'); whereParams.push(startTime) }
  if (endTime) { conditions.push('c_time <= ?'); whereParams.push(endTime) }
  const whereExtra = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  // 滑动窗口值必须先在全部原始数据上逐行精确计算（窗口函数不能先分桶再算），算好之后
  // 再按时间等宽分桶降采样，每桶取最新一行——滑动平均/波动/变化率本身已经是平滑过的
  // 计算结果，取桶内最后一个值即可代表这段时间的水平，不需要对已算好的值再求一次平均。
  const bucketSeconds = startTime ? calcBucketSeconds({ startTime, endTime, pointLimit: safeLimit }) : 1
  const params = [bucketSeconds, ...whereParams, safeLimit]

  const sql = `
    SELECT c_time, ROUND(raw_result, ${precision}) AS value
    FROM (
      SELECT
        c_time, raw_result,
        ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY c_time DESC, id DESC) AS rn
      FROM (
        SELECT id, c_time, FLOOR(UNIX_TIMESTAMP(c_time) / ?) AS bucket, ${aggregationSql(metric)} AS raw_result
        FROM ${metric.source_table}
        WHERE 1=1 ${whereExtra}
      ) AS calculated
    ) AS bucketed
    WHERE rn = 1 AND raw_result IS NOT NULL
    ORDER BY c_time ASC
    LIMIT ?
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
/** 【文件职责】时间窗口派生指标计算服务，如滑动平均、波动和变化率。
 * 【配置中心关联】TIME_WINDOW_METRICS 定义计算字段、窗口和算法；保存后下次请求生效。 */
