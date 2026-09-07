/** 【文件职责】异常历史查询服务。
 * 【配置中心关联】无直接读取。 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')
const { resolveCategory, friendlyName } = require('./errorTypeNames')
// 筛选条件构造跟类型统计（getErrorTypeStats）共用同一份实现，两边口径必须一致。
const { buildWhere } = require('./errorQueryFilter')

// 查询带分页的故障历史记录，支持关键字和时间筛选。
module.exports = async function getErrorHistory(query) {
    const page = parseInt(query.page) || 1
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize) || systemConfig.getConfig().DEFAULT_PAGE_SIZE))
    const offset = (page - 1) * pageSize
    const category = resolveCategory(query)
    const { whereClause, params } = buildWhere(query)

    const [rows] = await promisePool.query(
        `SELECT id, d_no AS '设备编号', e_msg AS '记录信息', c_time AS '报警时间', type AS '类型', e_no
         FROM t_error_msg
         ${whereClause}
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
    )

    // "类型"列原本只有"故障保护"/"安全联锁"/"安全告警"这种笼统大类，这里按 e_no 换成
    // 具体的故障/触发条件名称（比如"干烧""未开水泵却开启加热"），e_no 之外的字段不变。
    const list = rows.map((row) => {
        const { e_no, ...rest } = row
        rest['类型'] = friendlyName(category, e_no, rest['类型'])
        return rest
    })

    const countSql = `
        SELECT COUNT(*) AS total
        FROM t_error_msg
        ${whereClause}
    `
    const [countResult] = await promisePool.query(countSql, params)

    return {
        success: true,
        data: {
            list,
            total: countResult[0].total,
            page,
            size: pageSize,
        },
    }
}
