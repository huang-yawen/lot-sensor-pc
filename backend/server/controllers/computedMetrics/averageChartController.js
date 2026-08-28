/** 【文件职责】平均温度/平均流速历史图表 API 控制器，同时带上当前目标温度
 * （PID 跟踪对比图用作参考线）。
 * 【配置中心关联】COMPUTED_METRICS.pipeAreaCm2 由服务层实时读取。 */
const { queryAverageChart, getCurrentTargetTemp } = require('../../service/computedMetrics/averageChartQuery')
const { resolveTimeRange } = require('../../utils/timeRange')

module.exports = async (req, res) => {
  try {
    const d_no = req.query.d_no || null
    const limit = req.query.limit
    const { startTime, endTime } = resolveTimeRange(req.query)
    const [rows, targetTemp] = await Promise.all([
      queryAverageChart({ d_no, limit, startTime, endTime }),
      getCurrentTargetTemp(d_no),
    ])
    res.json({ success: true, data: { rows, targetTemp } })
  } catch (err) {
    console.error('[AverageChartController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}
