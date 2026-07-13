/**
 * 操作历史列表查询服务（分页）
 * 通过 JOIN t_direct_config 获取操作名称（t_name），
 * 保证只需要改数据库就能适配不同赛题。
 */

const promisePool = require('../../config/dbPool')

/**
 * 查询操作历史列表（分页）
 * @param {Object} params
 * @param {number} params.currentPage - 当前页码（从1开始）
 * @param {number} params.pageSize - 每页条数
 * @param {string} params.startTime - 开始时间
 * @param {string} params.endTime - 结束时间
 * @param {number|null} params.config_id - 指令类型ID（筛选特定指令配置）
 * @returns {Promise<{rows: Array, total: number}>}
 */
async function getOperationHistory({ currentPage = 1, pageSize = 10, startTime = null, endTime = null, config_id = null }) {
  const conditions = []
  const queryParams = []

  if (config_id !== null && config_id !== undefined && config_id !== '') {
    conditions.push('h.config_id = ?')
    queryParams.push(Number(config_id))
  }
  if (startTime) {
    conditions.push('h.c_time >= ?')
    queryParams.push(startTime)
  }
  if (endTime) {
    conditions.push('h.c_time <= ?')
    queryParams.push(endTime)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // 查询总数
  const [[{ total }]] = await promisePool.query(
    `SELECT COUNT(*) AS total FROM t_operation_history h
     LEFT JOIN t_direct_config c ON h.config_id = c.id
     ${whereClause}`,
    queryParams
  )

  // 分页查询，JOIN t_direct_config 获取操作名称
  const offset = (currentPage - 1) * pageSize
  const [rows] = await promisePool.query(
    `SELECT h.id, h.d_no AS '设备编号',
            c.t_name AS '操作名称',
            h.old_value AS '旧值',
            h.new_value AS '新值',
            h.source AS '来源',
            h.c_time AS '操作时间'
     FROM t_operation_history h
     LEFT JOIN t_direct_config c ON h.config_id = c.id
     ${whereClause}
     ORDER BY h.c_time DESC
     LIMIT ? OFFSET ?`,
    [...queryParams, Number(pageSize), Number(offset)]
  )

  return { rows, total }
}

module.exports = { getOperationHistory }
