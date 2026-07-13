const promisePool = require('../../config/dbPool')

// 统计故障类型数量，供图表展示使用。
module.exports = async function getErrorTypeStats(query) {
    const keyword = query.keyword?.trim() || ''
    const whereClause = keyword ? `WHERE d_no LIKE ? OR e_msg LIKE ?` : ``
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
