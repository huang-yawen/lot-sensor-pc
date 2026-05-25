const promisePool = require('../config/promisepool')
const { formatDataWithUnit } = require('../utils/helper')

module.exports= async (req, res) => {
    const type = req.query.type || 'sensor'
    const onlineFilter = req.query.online || null;
    try {
        let dataTable = ''
        let fieldMappingTable = ''
        if (type === 'sensor') {
            dataTable = 't_sensor_data'
            fieldMappingTable = 't_sensor_field_mapper'
        }
        else {
            dataTable = 't_behavior_data'
            fieldMappingTable = 't_behavior_field_mapper'
        }
        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.pageSize) || 5;
        const offset = (page - 1) * pageSize;
        const keyword = req.query.keyword || null;
        const keywordLike = keyword ? `%${keyword}%` : null;
        const startTime = req.query.startTime || null;
        const endTime = req.query.endTime || null;

        const [fieldMapper] = await promisePool.query(
            `SELECT f_name, db_name, unit FROM ${fieldMappingTable} WHERE visible = 1`
        );

        // 字段映射表决定前端展示列名和单位，避免在接口里写死列配置。
        const fieldMapping = {};
        const fieldUnit = {};
        fieldMapper.forEach(item => {
            fieldMapping[item.db_name] = item.f_name;
            fieldUnit[item.db_name] = item.unit;
        });

        const searchMapper = ['id', 'd_no AS 设备编号'];
        for (let key in fieldMapping) {
            searchMapper.push(`${key} AS \`${fieldMapping[key]}\``);
        }
        if (type === 'behavior') {
            searchMapper.push(`field5 as 采集时间`)
        }
        searchMapper.push('c_time AS 创立时间');

        const sql = `
            SELECT ${searchMapper.join(',')}
            FROM ${dataTable}
            WHERE 1=1
              AND (? IS NULL OR c_time >= ?)
              AND (? IS NULL OR c_time <= ?)
              AND (? IS NULL OR id = ? OR d_no LIKE ?)
              AND (? IS NULL OR online = ?)
            ORDER BY c_time desc
            LIMIT ? OFFSET ?
        `;

        const params = [
            startTime, startTime,
            endTime, endTime,
            keyword, keyword, keywordLike,
            onlineFilter, onlineFilter,
            pageSize, offset
        ];

        const [rows] = await promisePool.query(sql, params);
        const processedData = formatDataWithUnit(rows, fieldMapping, fieldUnit)
        const countSql = `
            SELECT COUNT(*) AS total
            FROM ${dataTable}
            WHERE 1=1
              AND (? IS NULL OR c_time >= ?)
              AND (? IS NULL OR c_time <= ?)
              AND (? IS NULL OR id = ? OR d_no LIKE ?)
              AND (? IS NULL OR online = ?)
        `;
        const [countResult] = await promisePool.query(countSql, params.slice(0, 9));
        const total = countResult[0].total;

        res.json({
            success: true,
            data: {
                list: processedData,
                total,
                page,
                size: pageSize
            }
        });
    } catch (err) {
        console.error('分页查询失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
}
