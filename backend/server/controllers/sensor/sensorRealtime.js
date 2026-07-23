/** 【文件职责】实时传感器数据 API 控制器。
 * 【配置中心关联】不缓存场景；实时刷新周期由 app.js 读取 REALTIME_REFRESH_INTERVAL。 */
const promisePool = require('../../config/dbPool')
const { buildDisplayFieldUnits } = require('../../utils/helper')
const { getEnabledMetrics, compileMetricSql, chartSettings } = require('../../service/derivedMetric/derivedMetricService')

// 组装传感器实时数据和前端需要的字段元信息。
module.exports = async (req, res) => {
    try {
        const onlineFilter = req.query.online

        // 读取字段映射表，让前端展示名和数据库字段保持一致。
        const [fieldMapper] = await promisePool.query(
            `SELECT f_name, db_name, unit FROM t_sensor_field_mapper WHERE visible = 1`
        )

        const fieldMapping = {}
        const fieldUnit = {}
        fieldMapper.forEach((item) => {
            fieldMapping[item.db_name] = item.f_name
            fieldUnit[item.db_name] = item.unit
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
        searchMapper.push('online AS 数据类型')

        let whereClause = ''
        let params = []
        if (onlineFilter) {
            whereClause = ' WHERE online = ?'
            params = [onlineFilter]
        }

        const [sensorData] = await promisePool.query(
            `SELECT ${searchMapper.join(',')} FROM t_sensor_data${whereClause} ORDER BY id desc`,
            params
        )

        // 注意：不将单位拼接到数值上，前端图表需要纯数值，列表显示时由前端自行拼接单位
        // const processedData = formatDataWithUnit(sensorData, fieldMapping, fieldUnit)
        const processedData = sensorData
        const fieldUnits = buildDisplayFieldUnits(fieldMapping, fieldUnit)

        // 顺手把故障数据、行为数据也拼到同一个返回里，方便首页一次渲染。
        const [errorMapper] = await promisePool.query(
            'SELECT id, d_no AS `储运箱ID`, c_time AS `创立时间`, e_msg AS `故障原因` FROM t_error_msg'
        )

        const sortedData = errorMapper.reduce((acc, item) => {
            const deviceNo = item['储运箱ID']
            if (!acc[deviceNo]) acc[deviceNo] = []
            acc[deviceNo].push(item)
            return acc
        }, {})

        const fieldName = {}
        const [behaviorField] = await promisePool.query(
            'SELECT db_name, p_name FROM t_behavior_field_mapper'
        )
        behaviorField.forEach((item) => {      
            fieldName[item.db_name] = item.p_name
        })

        const searchBehavior = ['id', 'd_no AS 储运箱ID']
        Object.keys(fieldName).forEach((key) => {
            searchBehavior.push(`${key} AS \`${fieldName[key]}\``)
        })      
        searchBehavior.push('online AS 数据类型')
        searchBehavior.push('c_time AS 更新时间')

        let [behaviorOutcome] = await promisePool.query(
            `SELECT ${searchBehavior.join(',')} FROM t_behavior_data ORDER BY id desc`
        )
        // behaviorOutcome = behaviorOutcome.map((item) => {
        //     for (const key in fieldName) {
        //         const label = fieldName[key]
        //         const unit = fieldUnit[key]
        //         if (unit) {
        //             item[label] = `${item[label]} ${unit}`
        //         }
        //     }
        //     return item
        // })

        res.json({
            success: true,
            message: '成功',
            processedData,
            fieldUnits,
            chartSettings: chartSettings(derivedMetrics),
            sortedData,
            behaviorOutcome,
        })
    } catch (err) {
        console.error('处理失败:', err)
        res.status(500).send('数据处理失败')
    }
}
/** 【文件职责】实时传感器数据接口，为首次加载页面提供最新一批数据。
 * 【配置中心关联】无直接读取；实时推送间隔由 app.js 使用 REALTIME_REFRESH_INTERVAL 控制。 */
