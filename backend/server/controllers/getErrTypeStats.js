const promisePool = require('../config/promisepool')

module.exports = async (req, res) => {
    try {
        const keyword = req.query.keyword?.trim() || "";

        const whereClause = keyword
            ? `WHERE d_no LIKE ? OR e_msg LIKE ?`
            : ``;
        const params = keyword
            ? [`%${keyword}%`, `%${keyword}%`]
            : [];

        const [rows] = await promisePool.query(
            `   SELECT 
                    CASE 
                        WHEN type IS NULL OR type = '' OR TRIM(type) = '' OR type = 'undefined' THEN '未知故障'
                        ELSE type 
                    END AS type,
                    COUNT(*) AS count
                FROM t_error_msg
                ${whereClause}
                GROUP BY type
                ORDER BY count DESC
                `,
            params
        );

        res.json({
            success: true,
            data: rows,
            total: rows.reduce((sum, item) => sum + item.count, 0)
        });
    } catch (err) {
        console.error("故障类型统计查询出错：", err);
        res.status(500).json({
            success: false,
            message: "故障类型统计查询失败",
        });
    }
};