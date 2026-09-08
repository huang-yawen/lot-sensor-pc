/** 【文件职责】故障/安全联锁记录的查询过滤条件构造，供列表查询（getErrorHistory）和
 * 类型统计（getErrorTypeStats）共用——两边必须用同一套筛选口径，图表统计的才是表格
 * 里看到的那批数据；之前统计服务漏了时间范围过滤，导致选了时间段饼图却还是全量。
 * 【配置】无直接读取。 */
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
 * 支持的筛选：category（fault/safety/linkage/alarm，决定 type 取值范围）、keyword
 * （设备编号或记录信息模糊匹配）、startTime/endTime（按 c_time 闭区间过滤）。只为
 * 实际传入的条件拼片段。
 */
const buildWhere = (query = {}) => {
    const keyword = query.keyword?.trim() || ''
    const startTime = query.startTime || ''
    const endTime = query.endTime || ''
    const category = resolveCategory(query)
    const conditions = []
    const params = []
    if (category === 'alarm') {
        // 场景配置 ALARM_RULES 触发的规则告警，type 是规则自己的显示名，各不相同、
        // 没法像另外三类那样列一张固定清单去 IN 匹配——改成排除掉那三类已知的固定
        // type，覆盖现在及以后任何新增的规则名，不用每加一条规则就来改这里。
        const knownTypes = Object.values(CATEGORY_TYPES).flat()
        conditions.push(`type NOT IN (${knownTypes.map(() => '?').join(',')})`)
        params.push(...knownTypes)
    } else {
        const types = CATEGORY_TYPES[category]
        conditions.push(`type IN (${types.map(() => '?').join(',')})`)
        params.push(...types)
    }

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
