/** 【文件职责】异常类型统计服务。
 * 【配置中心关联】无直接读取。 */
const promisePool = require('../../config/dbPool')

// 统计故障类型数量，供图表展示使用。
// 只统计真正的硬故障（faultStatus.js 写入的“故障保护”），安全联锁不算故障。
module.exports = async function getErrorTypeStats(query) {
    const keyword = query.keyword?.trim() || ''
    const whereClause = keyword ? `WHERE type = '故障保护' AND (d_no LIKE ? OR e_msg LIKE ?)` : `WHERE type = '故障保护'`
    const params = keyword ? [`%${keyword}%`, `%${keyword}%`] : []

    const [rows] = await promisePool.query(
        `SELECT
            CASE
                WHEN type IS NULL OR type = '' OR TRIM(type) = '' OR type = 'undefined' THEN '未知故障'
                ELSE type
            END AS type,
            COUNT(*) AS count
         FROM t_error_msg
         ${whereClause}
         GROUP BY type
         ORDER BY count DESC`,
        params
    )

    return {
        success: true,
        data: rows,
        total: rows.reduce((sum, item) => sum + item.count, 0),
    }
}
/** 【文件职责】异常类型统计查询服务。
 * 【配置中心关联】无直接读取；基于已保存的异常历史进行统计。 */
