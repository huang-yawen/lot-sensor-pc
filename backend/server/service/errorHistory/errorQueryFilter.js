/** 【文件职责】故障/安全联锁记录的查询过滤条件构造，供列表查询（getErrorHistory）和
 * 类型统计（getErrorTypeStats）共用——两边必须用同一套筛选口径，图表统计的才是表格
 * 里看到的那批数据；之前统计服务漏了时间范围过滤，导致选了时间段饼图却还是全量。
 * 【配置中心关联】无直接读取。 */
const { CATEGORY_TYPES, resolveCategory } = require('./errorTypeNames')

const isValidDateTime = (dateStr) => {
    if (!dateStr) return true
    const regex = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/
    return regex.test(dateStr)
}

const validateDateRange = (startTime, endTime) => {
    if (!startTime || !endTime) return true
    return new Date(startTime) <= new Date(endTime)
}

/**
 * 按查询参数拼出 WHERE 子句和参数数组。
 * 支持的筛选：category（fault/safety，决定 type 取值范围）、keyword（设备编号或记录信息
 * 模糊匹配）、startTime/endTime（按 c_time 闭区间过滤）。只为实际传入的条件拼片段。
 */
const buildWhere = (query = {}) => {
    const keyword = query.keyword?.trim() || ''
    const startTime = query.startTime || ''
    const endTime = query.endTime || ''
    const types = CATEGORY_TYPES[resolveCategory(query)]
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

    return { whereClause: `WHERE ${conditions.join(' AND ')}`, params }
}

module.exports = { buildWhere, isValidDateTime, validateDateRange }
