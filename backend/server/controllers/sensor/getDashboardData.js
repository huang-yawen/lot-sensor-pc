/** 【文件职责】首页仪表盘数据聚合 API。
 * 【配置中心关联】字段映射、派生指标等由下游按最新配置读取。 */
const promisePool = require('../../config/dbPool')
const { buildDisplayFieldUnits, applyValueLabels, parseValueMap } = require('../../utils/helper')
const { getEnabledMetrics, compileMetricSql, chartSettings } = require('../../service/derivedMetric/derivedMetricService')
const { buildRecencyFilter } = require('../../utils/realtimeFilter')

/**
 * 首页仪表盘数据接口
 * 
 * 组装传感器实时数据、故障数据、行为数据，方便首页一次渲染。
 * 原名为 sensorRealtime，因实际返回了三种数据，更名为 getDashboardData。
 */
module.exports = async (req, res) => {
    try {
        const onlineFilter = req.query.online

        // 读取字段映射表，让前端展示名和数据库字段保持一致。
        const [fieldMapper] = await promisePool.query(
            `SELECT f_name, db_name, unit, value_map FROM t_sensor_field_mapper WHERE visible = 1`
        )

        const fieldMapping = {}
        const fieldUnit = {}
        const sensorValueMaps = {}
        fieldMapper.forEach((item) => {
            fieldMapping[item.db_name] = item.f_name
            fieldUnit[item.db_name] = item.unit
            const map = parseValueMap(item.value_map)
            if (map) sensorValueMaps[item.db_name] = map
        })

        const searchMapper = ['id']
        searchMapper.push('d_no AS 设备编号')
        for (const key in fieldMapping) {
            searchMapper.push(`${key} AS \`${fieldMapping[key]}\``)
        }
        const derivedMetrics = await getEnabledMetrics('realtime')
        for (const metric of derivedMetrics) {
            const alias = String(metric.metric_name).replace(/`/g, '``')
            searchMapper.push(`${compileMetricSql(metric)} AS \`${alias}\``)
            if (metric.unit) fieldUnit[metric.metric_key] = metric.unit
            fieldMapping[metric.metric_key] = metric.metric_name
        }
        searchMapper.push('c_time AS 创立时间')
        // 实时数据 = 该表当前最新一条记录，汇总数据 = 数据库里面的所有的数据
        // 不再依赖设备上报时是否自带 online 字段。
        const sensorRecency = buildRecencyFilter('t_sensor_data', onlineFilter)
        searchMapper.push(`${sensorRecency.dataTypeExpr} AS 数据类型`)

        const [sensorData] = await promisePool.query(
            `SELECT ${searchMapper.join(',')} FROM t_sensor_data${sensorRecency.whereClause} ORDER BY id desc LIMIT 20`
        )

        // 注意：不将单位拼接到数值上，前端图表需要纯数值，列表显示时由前端自行拼接单位
        const processedData = applyValueLabels(sensorData, fieldMapping, sensorValueMaps)
        const fieldUnits = buildDisplayFieldUnits(fieldMapping, fieldUnit)

        // 顺手把故障数据、行为数据也拼到同一个返回里，方便首页一次渲染。
        const [errorMapper] = await promisePool.query(
            'SELECT id, d_no AS `储运箱ID`, c_time AS `创立时间`, e_msg AS `故障原因` FROM t_error_msg ORDER BY id desc LIMIT 50'
        )

        const sortedData = errorMapper.reduce((acc, item) => {
            const deviceNo = item['储运箱ID']
            if (!acc[deviceNo]) acc[deviceNo] = []
            acc[deviceNo].push(item)
            return acc
        }, {})

        const behaviorFieldMapping = {}
        const behaviorValueMaps = {}
        const [behaviorField] = await promisePool.query(
            'SELECT db_name, f_name, value_map FROM t_behavior_field_mapper WHERE visible = 1'
        )
        behaviorField.forEach((item) => {
            behaviorFieldMapping[item.db_name] = item.f_name
            const map = parseValueMap(item.value_map)
            if (map) behaviorValueMaps[item.db_name] = map
        })

        const searchBehavior = ['id', 'd_no AS 储运箱ID']
        Object.keys(behaviorFieldMapping).forEach((key) => {
            searchBehavior.push(`${key} AS \`${behaviorFieldMapping[key]}\``)
        })
        const behaviorRecency = buildRecencyFilter('t_behavior_data')
        searchBehavior.push(`${behaviorRecency.dataTypeExpr} AS 数据类型`)
        searchBehavior.push('c_time AS 更新时间')

        const [behaviorRows] = await promisePool.query(
            `SELECT ${searchBehavior.join(',')} FROM t_behavior_data ORDER BY id desc LIMIT 20`
        )
        let behaviorOutcome = applyValueLabels(behaviorRows, behaviorFieldMapping, behaviorValueMaps)

        // 累计/时间窗口派生指标图表已搬到"历史图表"页面（/api/cumulative、/api/time-window
        // 自带时间范围参数），首页不再顺带查询和返回 cumulativeData/timeWindowData。

        // 这个接口同时被"首页概览"和"传感器实时数据"共用："传感器实时数据"页面会真的拿
        // chartSettings 去画 LineBarCharts，首页概览请求了但没用上。首页调用时传 chart=false
        // 跳过这份计算和返回，避免占位数据白跑一趟；不传就保持原样（"传感器实时数据"不用改）。
        const includeChart = req.query.chart !== 'false'
        const responseBody = {
            success: true,
            message: '成功',
            processedData,
            fieldUnits,
            sortedData,
            behaviorOutcome,
        }
        if (includeChart) {
            responseBody.chartSettings = chartSettings(derivedMetrics)
        }
        res.json(responseBody)
    } catch (err) {
        console.error('处理失败:', err)
        res.status(500).send('数据处理失败')
    }
}
/** 【文件职责】仪表盘聚合接口，整合实时传感器、设备与告警展示数据。
 * 【配置中心关联】页面字段/名称相关配置在下游读取，控制器不保存配置副本。 */
