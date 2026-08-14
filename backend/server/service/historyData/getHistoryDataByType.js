/** 【文件职责】按类型查询传感器历史数据的服务。
 * 【配置中心关联】无直接读取。 */
const promisePool = require('../../config/dbPool')
const { formatDataWithUnit, buildDisplayFieldUnits } = require('../../utils/helper')
const { getEnabledMetrics, compileMetricSql, chartSettings } = require('../derivedMetric/derivedMetricService')
const systemConfig = require('../../config/systemConfig')
const { buildInlineCumulativeSql } = require('../cumulative/cumulativeService')
const { buildInlineTimeWindowSql } = require('../timeWindow/timeWindowService')
const { buildRecencyFilter, REALTIME_LABEL, HISTORY_LABEL } = require('../../utils/realtimeFilter')

const isValidDateTime = (dateStr) => {
    if (!dateStr) return true
    const regex = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/
    return regex.test(dateStr)
}

const formatDateTime = (dateStr) => {
    if (!dateStr) return null
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(dateStr)) {
        return `${dateStr}:00`
    }
    return dateStr
}

const validateDateRange = (startTime, endTime) => {
    if (!startTime || !endTime) return true
    const start = new Date(startTime)
    const end = new Date(endTime)
    return start <= end
}

// 查询传感器或行为历史数据，并返回格式化后的列表和字段信息。
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
        `SELECT f_name, db_name, unit FROM ${fieldMappingTable} WHERE visible = 1`
    )

    const fieldMapping = {}
    const fieldUnit = {}
    fieldMapper.forEach((item) => {
        fieldMapping[item.db_name] = item.f_name
        fieldUnit[item.db_name] = item.unit
    })

    const searchMapper = ['id']
    if(dataTable=='t_sensor_data'){
        searchMapper.push('d_no as 设备编号')
    }
    for (const key in fieldMapping) {
        searchMapper.push(`${key} AS \`${fieldMapping[key]}\``)
    }
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
    // 实时数据 = 该表当前最新一条记录，历史数据 = 除最新记录外的其余记录，
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
    const processedData = formatDataWithUnit(rows, fieldMapping, fieldUnit)
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
/** 【文件职责】按传感器类型和时间范围查询历史数据的服务。
 * 【配置中心关联】无直接读取；时间字段已在 MQTT 入库时按 TIME_FIELDS 规范化。 */
