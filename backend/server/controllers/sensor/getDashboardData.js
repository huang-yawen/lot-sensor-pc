/** 【文件职责】首页仪表盘数据聚合 API。
 * 【配置中心关联】字段映射、派生指标等由下游按最新配置读取。 */
const promisePool = require('../../config/dbPool')
const { buildDisplayFieldUnits } = require('../../utils/helper')
const { getEnabledMetrics, compileMetricSql, chartSettings } = require('../../service/derivedMetric/derivedMetricService')
const systemConfig = require('../../config/systemConfig')

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
            `SELECT ${searchMapper.join(',')} FROM t_sensor_data${whereClause} ORDER BY id desc LIMIT 20`,
            params
        )

        // 注意：不将单位拼接到数值上，前端图表需要纯数值，列表显示时由前端自行拼接单位
        const processedData = sensorData
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
            `SELECT ${searchBehavior.join(',')} FROM t_behavior_data ORDER BY id desc LIMIT 20`
        )

        // ==================== 累计/时间窗口派生指标（standalone/both 模式） ====================
        let cumulativeData = {}
        let timeWindowData = {}
        const config = systemConfig.getConfig()

        // 单设备模式下自动取数据库第一条设备编号（两个模块共用）
        let d_no = req.query.d_no || null
        if (!d_no && config.SINGLE_DEVICE_MODE) {
            try {
                const [first] = await promisePool.query(
                    'SELECT d_no FROM t_sensor_data ORDER BY id DESC LIMIT 1'
                )
                if (first.length > 0) d_no = first[0].d_no
            } catch (e) { /* 忽略 */ }
        }

        // 累计指标
        const enabledCumulative = (config.CUMULATIVE_METRICS || [])
            .filter(m => m.enabled && (m.mode === 'standalone' || m.mode === 'both'))
        if (enabledCumulative.length > 0) {
            const cumulativeService = require('../../service/cumulative/cumulativeService')
            for (const metric of enabledCumulative) {
                try {
                    cumulativeData[metric.metric_key] = {
                        config: {
                            metric_key: metric.metric_key,
                            metric_name: metric.metric_name,
                            unit: metric.unit,
                            chart_type: metric.chart_type,
                            color: metric.color,
                            precision: metric.precision,
                            mode: metric.mode,
                        },
                        rows: await cumulativeService.querySingleCumulative(
                            metric, { d_no, limit: 30 }
                        ),
                    }
                } catch (err) {
                    console.error(`[Dashboard] 累计指标 ${metric.metric_key} 查询失败:`, err.message)
                    cumulativeData[metric.metric_key] = { config: metric, rows: [], error: err.message }
                }
            }
        }

        // 时间窗口指标
        const enabledTimeWindow = (config.TIME_WINDOW_METRICS || [])
            .filter(m => m.enabled && (m.mode === 'standalone' || m.mode === 'both'))
        if (enabledTimeWindow.length > 0) {
            const timeWindowService = require('../../service/timeWindow/timeWindowService')
            for (const metric of enabledTimeWindow) {
                try {
                    timeWindowData[metric.metric_key] = {
                        config: {
                            metric_key: metric.metric_key,
                            metric_name: metric.metric_name,
                            unit: metric.unit,
                            chart_type: metric.chart_type,
                            color: metric.color,
                            precision: metric.precision,
                            mode: metric.mode,
                            aggregation: metric.aggregation,
                            window_size: metric.window_size,
                        },
                        rows: await timeWindowService.querySingleTimeWindow(
                            metric, { d_no, limit: 30 }
                        ),
                    }
                } catch (err) {
                    console.error(`[Dashboard] 时间窗口指标 ${metric.metric_key} 查询失败:`, err.message)
                    timeWindowData[metric.metric_key] = { config: metric, rows: [], error: err.message }
                }
            }
        }

        res.json({
            success: true,
            message: '成功',
            processedData,
            fieldUnits,
            chartSettings: chartSettings(derivedMetrics),
            sortedData,
            behaviorOutcome,
            cumulativeData,
            timeWindowData,
        })
    } catch (err) {
        console.error('处理失败:', err)
        res.status(500).send('数据处理失败')
    }
}
/** 【文件职责】仪表盘聚合接口，整合实时传感器、设备与告警展示数据。
 * 【配置中心关联】页面字段/名称相关配置在下游读取，控制器不保存配置副本。 */
