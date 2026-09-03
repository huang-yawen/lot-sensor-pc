/** 【文件职责】按类型查询传感器/行为汇总数据的服务（前端"汇总数据"页面的数据来源，
 * 函数名和文件名沿用旧称，项目里已没有独立的"历史数据"概念，只有"实时数据/保存
 * 数据"这一对标签，可选按 online 参数筛选）。
 * 【配置中心关联】无直接读取。 */
const promisePool = require('../../config/dbPool')
const { formatDataWithUnit, buildDisplayFieldUnits, applyValueLabels, parseValueMap } = require('../../utils/helper')
const { getEnabledMetrics, compileMetricSql, chartSettings } = require('../derivedMetric/derivedMetricService')
const systemConfig = require('../../config/systemConfig')
const { buildInlineCumulativeSql } = require('../cumulative/cumulativeService')
const { buildInlineTimeWindowSql } = require('../timeWindow/timeWindowService')
const { buildRecencyFilter, REALTIME_LABEL, HISTORY_LABEL } = require('../../utils/realtimeFilter')

// 校验时间字符串格式：支持 "YYYY-MM-DD"、"YYYY-MM-DD HH:MM"、"YYYY-MM-DD HH:MM:SS"
// 三种精度，空值直接放行（代表用户没填这个时间条件，不参与过滤）。
const isValidDateTime = (dateStr) => {
    if (!dateStr) return true
    const regex = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/
    return regex.test(dateStr)
}

// 前端时间选择器精确到分钟时传来的是 "YYYY-MM-DD HH:MM"（缺秒），这里补上
// ":00"，保证跟数据库 c_time 字段的精度对齐，避免比较时出现细微的秒级偏差。
const formatDateTime = (dateStr) => {
    if (!dateStr) return null
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(dateStr)) {
        return `${dateStr}:00`
    }
    return dateStr
}

// 检查开始时间不晚于结束时间；只要有一个没填就不检查（半个区间是合法的，
// 比如只填开始时间表示"这个时间点之后的全部数据"）。
const validateDateRange = (startTime, endTime) => {
    if (!startTime || !endTime) return true
    const start = new Date(startTime)
    const end = new Date(endTime)
    return start <= end
}

/**
 * 查询传感器或行为汇总数据，是"汇总数据"页面表格的唯一数据来源，用一份
 * 通用逻辑同时服务两张表（type='sensor' 查 t_sensor_data，'behavior' 查
 * t_behavior_data），整体分五步：
 *   1. 确定查哪张表、哪张字段映射表，解析分页/关键词/时间范围参数并校验。
 *   2. 按字段映射表动态拼出 SELECT 列表（数据库物理字段名 -> 中文展示名），
 *      不是写死的列名，字段映射表改了这里自动跟着变。
 *   3. 传感器类型的表格额外拼上用户在"公式与图表"配置的自定义指标列，以及
 *      "累计与滑动统计"里设置成内嵌模式（inline/both）的派生列——都是直接
 *      拼进同一条 SQL 的 SELECT 列表，跟原始字段一起返回，不需要多发请求。
 *   4. 算出"实时数据"还是"保存数据"：规则是这张表当前最新一条记录算实时，
 *      其余全部算保存数据（不依赖设备上报是否自带 online 字段，见
 *      buildRecencyFilter），再根据前端传的筛选值决定要不要按这个条件过滤。
 *   5. 用同一套过滤条件跑两次查询：一次要数据（带分页），一次只要总数
 *      （用于分页组件），两次的 WHERE 条件必须完全一致，总数才对得上。
 * @param {Object} query - 请求参数（type/online/page/pageSize/keyword/startTime/endTime）
 * @returns {Promise<Object>} { success, data: { list, fieldUnits, chartSettings, total, page, size } }
 */
module.exports = async function getHistoryDataByType(query) {
    const type = query.type || 'sensor'
    const onlineFilter = query.online || null

    let dataTable = ''
    let fieldMappingTable = ''
    if (type === 'sensor') {
        dataTable = 't_sensor_data'
        fieldMappingTable = 't_sensor_field_mapper'
    } else {
        dataTable = 't_behavior_data'
        fieldMappingTable = 't_behavior_field_mapper'
    }

    const page = parseInt(query.page) || 1
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize) || systemConfig.getConfig().DEFAULT_PAGE_SIZE))
    const offset = (page - 1) * pageSize
    const keyword = query.keyword || null
    const keywordLike = keyword ? `%${keyword}%` : null
    
    let startTime = formatDateTime(query.startTime) || null
    let endTime = formatDateTime(query.endTime) || null
    
    if (startTime && !isValidDateTime(startTime)) {
        throw new Error('开始时间格式不正确，应为 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS')
    }
    if (endTime && !isValidDateTime(endTime)) {
        throw new Error('结束时间格式不正确，应为 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS')
    }
    if (!validateDateRange(startTime, endTime)) {
        throw new Error('开始时间不能大于结束时间')
    }

    // 让前端字段名和数据库字段映射保持同步。
    const [fieldMapper] = await promisePool.query(
        `SELECT f_name, db_name, unit, value_map FROM ${fieldMappingTable} WHERE visible = 1`
    )

    const fieldMapping = {}
    const fieldUnit = {}
    const valueMaps = {}
    fieldMapper.forEach((item) => {
        fieldMapping[item.db_name] = item.f_name
        fieldUnit[item.db_name] = item.unit
        const map = parseValueMap(item.value_map)
        if (map) valueMaps[item.db_name] = map
    })

    // searchMapper 是最终 SELECT 列表的各个列，从这里开始逐步往里拼：先是主键，
    // 再是按字段映射表转出来的中文列名，然后视情况追加自定义公式列、累计/滑动
    // 统计内嵌列，最后是固定的时间列和数据类型列。
    const searchMapper = ['id']
    if(dataTable=='t_sensor_data'){
        searchMapper.push('d_no as 设备编号')
    }
    for (const key in fieldMapping) {
        searchMapper.push(`${key} AS \`${fieldMapping[key]}\``)
    }
    // 自定义公式指标（DERIVED_METRICS）只在传感器类型的表格里显示——公式引用的
    // field1~field10 目前只映射到 t_sensor_data，放进行为数据表格里跑不通。
    let derivedMetrics = []
    if (type === 'sensor') {
        derivedMetrics = await getEnabledMetrics('history')
        for (const metric of derivedMetrics) {
            const alias = String(metric.metric_name).replace(/`/g, '``')
            searchMapper.push(`${compileMetricSql(metric)} AS \`${alias}\``)
            fieldMapping[metric.metric_key] = metric.metric_name
            fieldUnit[metric.metric_key] = metric.unit || ''
        }
    }
    // 累计统计（cumulativeService）和滑动统计（timeWindowService）里勾选了
    // "内嵌模式"的指标，同样直接拼列进这条 SQL，两类服务各自负责生成自己的
    // SQL 片段，这里只管拼接、不关心内部怎么算的。
    const cumulative = buildInlineCumulativeSql(dataTable)
    const timeWindow = buildInlineTimeWindowSql(dataTable)
    const inlineMetrics = [...cumulative.metrics, ...timeWindow.metrics]
    for (const result of [cumulative, timeWindow]) {
        if (result.selectFragment) searchMapper.push(result.selectFragment.replace(/^,\s*/, ''))
    }
    for (const metric of inlineMetrics) {
        fieldMapping[metric.metric_key] = metric.metric_name
        fieldUnit[metric.metric_key] = metric.unit || ''
    }
    // if (type === 'behavior') {
    //     searchMapper.push('field5 AS 采集时间')
    // }如果要有采集时间
    searchMapper.push('c_time AS 创立时间')
    // 实时数据 = 该表当前最新一条记录，保存数据 = 除最新记录外的其余记录，
    // 不再依赖设备上报时是否自带 online 字段。
    const recency = buildRecencyFilter(dataTable, onlineFilter)
    searchMapper.push(`${recency.dataTypeExpr} AS 数据类型`)

    // onlineFilter 为空/其他值时不筛选；等于两个固定标签之一时按最新记录换算成条件。
    let onlineCondition = '1=1'
    if (onlineFilter === REALTIME_LABEL) {
        onlineCondition = recency.isLatest
    } else if (onlineFilter === HISTORY_LABEL) {
        onlineCondition = `NOT (${recency.isLatest})`
    }

    const sql = `
        SELECT ${searchMapper.join(',')}
        FROM ${dataTable}
        WHERE 1=1
          AND (? IS NULL OR c_time >= ?)
          AND (? IS NULL OR c_time <= ?)
          AND (? IS NULL OR id = ? OR d_no LIKE ?)
          AND (${onlineCondition})
        ORDER BY id DESC
        LIMIT ? OFFSET ?
    `

    const params = [
        startTime, startTime,
        endTime, endTime,
        keyword, keyword, keywordLike,
        pageSize, offset,
    ]

    const [rows] = await promisePool.query(sql, params)
    const labeledRows = applyValueLabels(rows, fieldMapping, valueMaps)
    const processedData = formatDataWithUnit(labeledRows, fieldMapping, fieldUnit)
    const fieldUnits = buildDisplayFieldUnits(fieldMapping, fieldUnit)

    const countSql = `
        SELECT COUNT(*) AS total
        FROM ${dataTable}
        WHERE 1=1
          AND (? IS NULL OR c_time >= ?)
          AND (? IS NULL OR c_time <= ?)
          AND (? IS NULL OR id = ? OR d_no LIKE ?)
          AND (${onlineCondition})
    `
    const [countResult] = await promisePool.query(countSql, params.slice(0, 7))

    return {
        success: true,
        data: {
            list: processedData,
            fieldUnits,
            chartSettings: {
                ...chartSettings(derivedMetrics),
                ...Object.fromEntries(inlineMetrics.map(metric => [metric.metric_name, {
                    metricKey: metric.metric_key,
                    visible: true,
                    type: metric.chart_type,
                    yAxis: 'left',
                    color: metric.color,
                    min: null,
                    max: null,
                    unit: metric.unit || '',
                }])),
            },
            total: countResult[0].total,
            page,
            size: pageSize,
        },
    }
}
/** 【文件职责】按传感器类型和时间范围查询汇总数据的服务。
 * 【配置中心关联】无直接读取；时间字段已在 MQTT 入库时按 TIME_FIELDS 规范化。 */
