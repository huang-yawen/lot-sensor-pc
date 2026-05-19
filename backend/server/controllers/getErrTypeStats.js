const promisePool = require('../config/promisepool')

const buildWhere = (query) => {
    const keyword = query.keyword?.trim() || "";
    const startTime = query.startTime || "";
    const endTime = query.endTime || "";
    const conditions = [];
    const params = [];

    if (keyword) {
        conditions.push('(d_no LIKE ? OR e_msg LIKE ?)');
        params.push(`%${keyword}%`, `%${keyword}%`);
    }

    if (startTime) {
        conditions.push('c_time >= ?');
        params.push(startTime);
    }

    if (endTime) {
        conditions.push('c_time <= ?');
        params.push(endTime);
    }

    return {
        whereClause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
        params,
    };
};

module.exports = async (req, res) => {
    try {
        const { whereClause, params } = buildWhere(req.query);

        const [rows] = await promisePool.query(
            `   SELECT 
                    faultType AS type,
                    COUNT(*) AS count
                FROM (
                    SELECT
                        CASE
                            WHEN type IS NULL THEN '未知故障'
                            WHEN TRIM(CAST(type AS CHAR)) = '' THEN '未知故障'
                            WHEN LOWER(TRIM(CAST(type AS CHAR))) IN ('undefined', 'null', 'nan') THEN '未知故障'
                            ELSE TRIM(CAST(type AS CHAR))
                        END AS faultType
                    FROM t_error_msg
                    ${whereClause}
                ) AS normalized
                GROUP BY faultType
                ORDER BY count DESC
                `,
            params
        );

        res.json({
            success: true,
            data: rows,
            total: rows.reduce((sum, item) => sum + Number(item.count || 0), 0)
        });
    } catch (err) {
        console.error("故障类型统计查询出错：", err);
        res.status(500).json({
            success: false,
            message: "故障类型统计查询失败",
        });
    }
};
