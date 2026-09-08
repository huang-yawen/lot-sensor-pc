/**
 * 【接口】GET /api/data —— 首页仪表盘一次性数据（传感器 + 行为 + 故障 三合一）
 *
 * 请求 query：
 *   dataScope   可选  'realtime' | 'saved'   透传给 getTableData
 *   chart       可选  'false' 时响应里不含 chartSettings
 *
 * 响应 200：
 *   { success:true, message:'成功',
 *     processedData:   [传感器最新 20 条],           // 来自 getTableData(type:'sensor', realtime)
 *     fieldUnits:      { 列名: 单位 },
 *     behaviorOutcome: [行为最新 20 条],             // 来自 getTableData(type:'behavior', realtime)
 *     sortedData:      { 设备编号: [故障记录...] },   // t_error_msg 最近 50 条，按设备分组
 *     chartSettings:   {...} }                        // chart≠false 时才有
 * 出错 500：{ success:false, message:'数据处理失败' }
 *
 * 注：本接口响应是历史遗留的自定义字段名（processedData/sortedData/behaviorOutcome），
 * 不是统一的 { success, data } 结构，前端 Dashboard.vue 按这些名字取。
 */
const promisePool = require('../../config/dbPool')
const getTableData = require('../../service/tableData/getTableData')

module.exports = async (req, res) => {
    try {
        const dataScope = req.query.dataScope
        const includeChart = req.query.chart !== 'false'

        // 传感器 + 行为并行走 getTableData（复用字段映射/派生指标/recencyFilter）；
        // 故障单独查 t_error_msg（表结构不同、要按设备分组）。
        const [sensorResult, behaviorResult, [errorRows]] = await Promise.all([
            getTableData({ type: 'sensor', dataScope, metricScope: 'realtime', page: 1, pageSize: 20 }),
            getTableData({ type: 'behavior', metricScope: 'realtime', page: 1, pageSize: 20 }),
            promisePool.query(
                'SELECT id, d_no AS `储运箱ID`, c_time AS `创立时间`, e_msg AS `故障原因` FROM t_error_msg ORDER BY id desc LIMIT 50'
            )
        ])

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
