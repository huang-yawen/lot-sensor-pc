/**
 * 累计指标查询服务
 *
 * 根据 systemConfig 中的 CUMULATIVE_METRICS 配置，使用 MySQL 窗口函数
 * SUM(...) OVER (ORDER BY c_time ROWS UNBOUNDED PRECEDING) 计算累计值。
 *
 * 支持的聚合方式：
 *   - SUM：累加（流量、功耗等连续量）
 *   - 未来可扩展 AVG、COUNT、MAX、MIN
 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')

/**
 * 获取所有已启用的累计指标配置
 * @returns {Array} 已启用指标配置数组
 */
function getEnabledCumulativeMetrics() {
  const config = systemConfig.getConfig()
  const metrics = config.CUMULATIVE_METRICS || []
  return metrics.filter(m => m.enabled)
}

/**
 * 单指标查询：根据一条 metric 配置生成并执行累计查询
 * @param {Object} metric     - 单条 CUMULATIVE_METRICS 配置
 * @param {Object} [options]  - 可选参数
 * @param {string} [options.d_no]     - 设备编号过滤
 * @param {number} [options.limit=30] - 返回最近 N 条
 * @returns {Array<{c_time, value, cumulative}>}
 */
async function querySingleCumulative(metric, options = {}) {
  const { d_no, limit = 30 } = options
  const table = metric.source_table
  const field = metric.source_field
  const precision = metric.precision ?? 2

  // 统一对数值型字段做 CAST 防止空串报错
  const valueExpr = `CAST(NULLIF(\`${field}\`, '') AS DECIMAL(20,6))`

  const safeLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 30))
  const subParams = []
  if (d_no) subParams.push(d_no)
  subParams.push(safeLimit)

  // 先对全部匹配记录累计，再截取最近 N 条。原实现先 LIMIT 再 SUM，
  // 会把“累计值”错误地变成“最近 N 条之和”。id 用于相同时间下稳定排序。
  const sql = `
    SELECT c_time, value, cumulative
    FROM (
      SELECT id, c_time, value, cumulative
      FROM (
        SELECT
          id,
          c_time,
          ROUND(${valueExpr}, ${precision}) AS value,
          ROUND(SUM(${valueExpr}) OVER (ORDER BY c_time ASC, id ASC ROWS UNBOUNDED PRECEDING), ${precision}) AS cumulative
        FROM ${table}
        WHERE 1=1 ${d_no ? 'AND d_no = ?' : ''}
      ) AS calculated
      ORDER BY c_time DESC, id DESC
      LIMIT ?
    ) AS recent
    ORDER BY c_time ASC, id ASC
  `

  const params = [...subParams]
  const [rows] = await promisePool.query(sql, params)
  return rows
}

/**
 * 批量查询：为所有已启用的累计指标分别执行查询
 * @param {Object} [options] - 见 querySingleCumulative
 * @returns {Object} { cumulative_flow: [...], cumulative_heat_time: [...], ... }
 */
async function queryAllCumulative(options = {}) {
  const metrics = getEnabledCumulativeMetrics()
  if (metrics.length === 0) return {}

  const results = {}
  await Promise.all(metrics.map(async (metric) => {
    try {
      results[metric.metric_key] = await querySingleCumulative(metric, options)
    } catch (err) {
      console.error(`[CumulativeService] 查询 ${metric.metric_key} 失败:`, err.message)
      results[metric.metric_key] = []
    }
  }))
  return results
}

/**
 * 为历史查询注入累计列 SQL 片段
 * 适用于 mode 为 "inline" 或 "both" 的情况。
 *
 * 返回 { selectFragment, metrics }，调用方拼入主查询的 SELECT 列表中。
 * selectFragment 示例：
 *   ROUND(SUM(CAST(NULLIF(field3,'') AS DECIMAL(20,6)))
 *     OVER (ORDER BY c_time ROWS UNBOUNDED PRECEDING), 2) AS `累计流量`
 *
 * 注意：此函数只生成 SQL 片段，不单独执行查询；窗口函数依赖完整结果集，
 * 由外层 ORDER BY c_time DESC 时需主查自行处理子查询包裹。
 *
 * @returns {{ selectFragment: string, metrics: Array }}
 */
function buildInlineCumulativeSql(sourceTable) {
  const metrics = getEnabledCumulativeMetrics()
    .filter(m => (m.mode === 'inline' || m.mode === 'both') && (!sourceTable || m.source_table === sourceTable))

  if (metrics.length === 0) return { selectFragment: '', metrics: [] }

  const fragments = metrics.map(m => {
    const field = m.source_field
    const valueExpr = `CAST(NULLIF(\`${field}\`, '') AS DECIMAL(20,6))`
    const alias = String(m.metric_name).replace(/`/g, '``')
    return `ROUND(SUM(${valueExpr}) OVER (ORDER BY c_time, id ROWS UNBOUNDED PRECEDING), ${m.precision ?? 2}) AS \`${alias}\``
  })

  return { selectFragment: `, ${fragments.join(', ')}`, metrics }
}

module.exports = {
  getEnabledCumulativeMetrics,
  querySingleCumulative,
  queryAllCumulative,
  buildInlineCumulativeSql,
}
