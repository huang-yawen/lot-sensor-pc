const promisePool = require('../config/promisepool')
const { formatDataWithUnit } = require('../utils/helper')
module.exports = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.pageSize) || 5;
        const offset = (page - 1) * pageSize;
        const keyword = req.query.keyword?.trim() || "";
    
        const whereClause = keyword
            ? `WHERE d_no LIKE ? OR e_msg LIKE ?`
            : ``;
        const params = keyword
            ? [`%${keyword}%`, `%${keyword}%`, pageSize, offset]
            : [pageSize, offset];

        const [rows] = await promisePool.query(
            `   SELECT id, d_no AS '设备编号', e_msg AS '故障信息', c_time AS '报错时间'
                FROM t_error_msg
                ${whereClause}
                ORDER BY c_time desc
                LIMIT ? OFFSET ?
                `,
            params
        );

        const countSql = `
      SELECT COUNT(*) AS total
      FROM t_error_msg
      ${keyword ? "WHERE d_no LIKE ? OR e_msg LIKE ?" : ""}
    `;
        const [countResult] = await promisePool.query(
            countSql,
            keyword ? [`%${keyword}%`, `%${keyword}%`] : []
        );
        const total = countResult[0].total;

        res.json({
            success: true,
            data: {
                list: rows,
                total,
                page,
                size: pageSize,
            },
        });
    } catch (err) {
        console.error("err表查询出错：", err);
        res.status(500).json({
            success: false,
            message: "错误数据查询失败",
        });
    }
};