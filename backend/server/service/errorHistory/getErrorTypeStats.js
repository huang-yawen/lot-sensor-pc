/** 【文件职责】异常类型统计服务。
 * 【配置中心关联】无直接读取。 */
const promisePool = require('../../config/dbPool')
const { CATEGORY_TYPES, resolveCategory, friendlyName } = require('./errorTypeNames')

// 统计故障/安全联锁的具体类型分布（按 e_no 精确区分，而不是笼统的 type 大类），供图表展示使用。
module.exports = async function getErrorTypeStats(query) {
  const category = resolveCategory(query)
  const types = CATEGORY_TYPES[category]
  const keyword = query.keyword?.trim() || ''

  const conditions = [`type IN (${types.map(() => '?').join(',')})`]
  const params = [...types]
  if (keyword) {
    conditions.push('(d_no LIKE ? OR e_msg LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`)
  }

  const [rows] = await promisePool.query(
    `SELECT e_no, type, COUNT(*) AS count
     FROM t_error_msg
     WHERE ${conditions.join(' AND ')}
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
/** 【文件职责】异常类型统计查询服务。
 * 【配置中心关联】无直接读取；基于已保存的异常历史进行统计。 */
