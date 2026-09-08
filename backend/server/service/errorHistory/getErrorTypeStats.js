/** 【文件职责】异常类型统计服务。
 * 【配置】无直接读取。 */
const promisePool = require('../../config/dbPool')
const { resolveCategory, friendlyName } = require('./errorTypeNames')
const { buildWhere } = require('./errorQueryFilter')

// 统计故障/安全联锁的具体类型分布（按 e_no 精确区分，而不是笼统的 type 大类），供图表展示使用。
// 筛选条件跟列表查询共用 buildWhere：同样支持关键字和时间范围，保证饼图统计的就是
// 表格里筛出来的那批记录；不传时间范围时统计该类型的全部记录。
module.exports = async function getErrorTypeStats(query) {
  const category = resolveCategory(query)
  const { whereClause, params } = buildWhere(query)

  const [rows] = await promisePool.query(
    `SELECT e_no, type, COUNT(*) AS count
     FROM t_error_msg
     ${whereClause}
     GROUP BY e_no, type`,
    params
  )

  // 按友好名称二次合并（同一个 e_no 理论上只对应一个名称，这里防的是 e_no 为空时
  // 多行落到同一个 fallback 名称上需要相加）。
  const merged = new Map()
  for (const row of rows) {
    const name = friendlyName(category, row.e_no, row.type)
    merged.set(name, (merged.get(name) || 0) + row.count)
  }

  const data = [...merged.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  return {
    success: true,
    data,
    total: data.reduce((sum, item) => sum + item.count, 0),
  }
}
