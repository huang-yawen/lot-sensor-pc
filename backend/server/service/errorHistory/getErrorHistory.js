/** 【文件职责】异常历史查询服务。
 * 【配置中心关联】无直接读取。 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')

const isValidDateTime = (dateStr) => {
    if (!dateStr) return true
    const regex = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/
    return regex.test(dateStr)
}

const validateDateRange = (startTime, endTime) => {
    if (!startTime || !endTime) return true
    const start = new Date(startTime)
    const end = new Date(endTime)
    return start <= end
}

/** category=fault（默认）只看真正的硬故障；category=safety 看安全联锁记录，两者互不混淆。 */
const CATEGORY_TYPES = {
    fault: ['故障保护'],
    safety: ['安全联锁', '安全告警'],
}

const buildWhere = (query) => {
    const keyword = query.keyword?.trim() || ''
    let startTime = query.startTime || ''
    let endTime = query.endTime || ''
    const types = CATEGORY_TYPES[query.category] || CATEGORY_TYPES.fault
    const conditions = [`type IN (${types.map(() => '?').join(',')})`]
    const params = [...types]

    if (startTime && !isValidDateTime(startTime)) {
        throw new Error('开始时间格式不正确，应为 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS')
    }
    if (endTime && !isValidDateTime(endTime)) {
        throw new Error('结束时间格式不正确，应为 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS')
    }
    if (!validateDateRange(startTime, endTime)) {
        throw new Error('开始时间不能大于结束时间')
    }

    // 只为用户实际传入的筛选条件拼接 SQL 片段。
    if (keyword) {
        conditions.push('(d_no LIKE ? OR e_msg LIKE ?)')
        params.push(`%${keyword}%`, `%${keyword}%`)
    }

    if (startTime) {
        conditions.push('c_time >= ?')
        params.push(startTime)
    }

    if (endTime) {
        conditions.push('c_time <= ?')
        params.push(endTime)
    }

    return {
        whereClause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
        params,
    }
}

// 查询带分页的故障历史记录，支持关键字和时间筛选。
module.exports = async function getErrorHistory(query) {
    const page = parseInt(query.page) || 1
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize) || systemConfig.getConfig().DEFAULT_PAGE_SIZE))
    const offset = (page - 1) * pageSize
    const { whereClause, params } = buildWhere(query)

    const [rows] = await promisePool.query(
        `SELECT id, d_no AS '设备编号', e_msg AS '记录信息', c_time AS '报警时间', type AS '类型'
         FROM t_error_msg
         ${whereClause}
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
    )

    const countSql = `
        SELECT COUNT(*) AS total
        FROM t_error_msg
        ${whereClause}
    `
    const [countResult] = await promisePool.query(countSql, params)

    return {
        success: true,
        data: {
            list: rows,
            total: countResult[0].total,
            page,
            size: pageSize,
        },
    }
}
/** 【文件职责】异常历史查询服务，封装筛选、分页和排序逻辑。
 * 【配置中心关联】无直接读取；数据由 MQTT 告警处理链路按当前主题写入。 */
