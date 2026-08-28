/** 【文件职责】平均温度/平均流速历史图表 API 控制器。
 * 【配置中心关联】COMPUTED_METRICS.pipeAreaCm2 由服务层实时读取。 */
const { queryAverageChart } = require('../../service/computedMetrics/averageChartQuery')
const { resolveTimeRange } = require('../../utils/timeRange')

/**
 * GET /api/average-chart
 * 查询平均温度/平均流速的历史数据（历史图表页面专用）。
 * Query: ?d_no=xxx&limit=300&range=1h（或 range=custom&startTime=...&endTime=...）
 */
module.exports = async (req, res) => {
  try {
    const d_no = req.query.d_no || null
    const limit = req.query.limit
    const { startTime, endTime } = resolveTimeRange(req.query)
    const data = await queryAverageChart({ d_no, limit, startTime, endTime })
    res.json({ success: true, data })
  } catch (err) {
    console.error('[AverageChartController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}
