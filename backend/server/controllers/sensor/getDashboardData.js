/** 【文件职责】首页仪表盘数据聚合 API。
 *  组装传感器实时数据 + 故障数据 + 行为数据，方便首页一次渲染。
 *  传感器和行为数据复用 getTableData（消除字段映射/派生指标/recencyFilter 重复逻辑），
 *  故障数据查 t_error_msg（表结构不同，单独查）。
 * 【配置】字段映射、派生指标等由 getTableData 内部按最新配置读取。 */
const promisePool = require('../../config/dbPool')
const getTableData = require('../../service/tableData/getTableData')

/**
 * 首页仪表盘数据接口
 *
 * 返回结构（三合一）：
 *   - processedData：传感器最新数据（数组）
 *   - fieldUnits：字段单位映射（前端拼接显示用）
 *   - sortedData：故障记录（按设备编号分组）
 *   - behaviorOutcome：行为数据最新记录（数组）
 *   - chartSettings（可选）：图表配置，chart≠false 时返回
 *
 * 数据来源分工：
 *   - 传感器 + 行为 → 走 getTableData（复用字段映射、派生指标、recencyFilter 逻辑）
 *   - 故障 → 直接查 t_error_msg（表结构不同，需要按设备分组，不适合走 getTableData）
 */
module.exports = async (req, res) => {
    try {
        const dataScope = req.query.dataScope
        const includeChart = req.query.chart !== 'false'

        // 传感器 + 行为数据并行查（metricScope='realtime' → 用 show_realtime 派生指标 + 不拼单位）
        // 故障数据单独查（t_error_msg 表结构不同，不走 getTableData）
        const [sensorResult, behaviorResult, [errorRows]] = await Promise.all([
            getTableData({ type: 'sensor', dataScope, metricScope: 'realtime', page: 1, pageSize: 20 }),
            getTableData({ type: 'behavior', metricScope: 'realtime', page: 1, pageSize: 20 }),
            promisePool.query(
                'SELECT id, d_no AS `储运箱ID`, c_time AS `创立时间`, e_msg AS `故障原因` FROM t_error_msg ORDER BY id desc LIMIT 50'
            )
        ])

        // 故障记录按设备编号分组，方便前端按设备展示
        const sortedData = errorRows.reduce((acc, item) => {
            const deviceNo = item['储运箱ID']
            if (!acc[deviceNo]) acc[deviceNo] = []
            acc[deviceNo].push(item)
            return acc
        }, {})

        const responseBody = {
            success: true,
            message: '成功',
            processedData: sensorResult.data.list,
            fieldUnits: sensorResult.data.fieldUnits,
            sortedData,
            behaviorOutcome: behaviorResult.data.list,
        }
        if (includeChart) {
            responseBody.chartSettings = sensorResult.data.chartSettings
        }
        res.json(responseBody)
    } catch (err) {
        console.error('[Dashboard] 处理失败:', err)
        res.status(500).json({ success: false, message: '数据处理失败' })
    }
}
