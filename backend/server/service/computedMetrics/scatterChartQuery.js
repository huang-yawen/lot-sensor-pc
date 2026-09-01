/** 【文件职责】温度-流量相关性散点图查询服务。用 CTE（WITH 子句）先把原始字段的
 * 类型转换和读数取出来命名成 matched，外层再从 matched 里筛非空、限制条数——
 * 跟嵌套子查询效果一样，但可读性更好：先说清楚"这批数据长什么样"，再说"要什么样的"。
 * 【配置中心关联】d_no、时间范围、条数上限跟其他历史图表查询一致，实时读取请求参数。 */
const promisePool = require('../../config/dbPool')

/**
 * @param {Object} [options]
 * @param {string} [options.d_no]
 * @param {number} [options.limit=500]
 * @param {string} [options.startTime]
 * @param {string} [options.endTime]
 * @returns {Promise<Array<{temp: number, flow: number}>>}
 */
async function queryTempFlowScatter(options = {}) {
  const { d_no, limit = 500, startTime, endTime } = options
  const safeLimit = Math.min(2000, Math.max(1, Number.parseInt(limit, 10) || 500))

  const conditions = []
  const whereParams = []
  if (d_no) { conditions.push('d_no = ?'); whereParams.push(d_no) }
  if (startTime) { conditions.push('c_time >= ?'); whereParams.push(startTime) }
  if (endTime) { conditions.push('c_time <= ?'); whereParams.push(endTime) }
  const whereExtra = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  const sql = `
    WITH matched AS (
      SELECT
        c_time,
        CAST(NULLIF(field1, '') AS DECIMAL(20,6)) AS temp,
        CAST(NULLIF(field3, '') AS DECIMAL(20,6)) AS flow
      FROM t_sensor_data
      WHERE 1=1 ${whereExtra}
    )
    SELECT temp, flow
    FROM matched
    WHERE temp IS NOT NULL AND flow IS NOT NULL
    ORDER BY c_time DESC
    LIMIT ?
  `
  const [rows] = await promisePool.query(sql, [...whereParams, safeLimit])
  return rows
}

module.exports = { queryTempFlowScatter }
