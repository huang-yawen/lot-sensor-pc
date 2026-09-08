/** 【文件职责】平均温度/平均流速历史图表 API 控制器，同时带上当前目标温度
 * （PID 跟踪对比图用作参考线）和当前目标流速（恒流速跟踪对比图用作参考线）。
 * 【配置】COMPUTED_METRICS.pipeAreaCm2 由服务层实时读取。 */
const { queryAverageChart, getCurrentTargetTemp, getCurrentTargetVelocity } = require('../../service/computedMetrics/averageChartQuery')
const { resolveTimeRange } = require('../../utils/timeRange')

module.exports = async (req, res) => {
  try {
    const d_no = req.query.d_no || null
    const limit = req.query.limit
    const { startTime, endTime } = resolveTimeRange(req.query)
    const [rows, targetTemp, targetVelocity] = await Promise.all([
      queryAverageChart({ d_no, limit, startTime, endTime }),
      getCurrentTargetTemp(d_no),
      getCurrentTargetVelocity(d_no),
    ])
    res.json({ success: true, data: { rows, targetTemp, targetVelocity } })
  } catch (err) {
    console.error('[AverageChartController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}
