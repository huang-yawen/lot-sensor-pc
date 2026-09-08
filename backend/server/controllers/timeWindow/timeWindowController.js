/**
 * 【接口】GET /api/time-window —— 滑动窗口指标历史曲线（滑动平均/波动/变化率，历史图表页专用）
 *
 * 请求 query：d_no（可选）、limit（可选）、range（'1h'/'6h'/'24h'/'custom'）、
 *            startTime/endTime（range=custom 时用）
 * 响应 200：{ success:true, data:{ <指标metric_key>: [{ time, value }...] } }
 * 出错 500：{ success:false, message }
 *
 * 指标定义在 config/metrics.js 的 TIME_WINDOW_METRICS；enabled=false 的不返回。
 * 计算在 service/timeWindow/timeWindowService.js。
 */
const timeWindowService = require('../../service/timeWindow/timeWindowService')
const { resolveTimeRange } = require('../../utils/timeRange')

module.exports = async (req, res) => {
  try {
    const d_no = req.query.d_no || null
    const limit = req.query.limit
    const { startTime, endTime } = resolveTimeRange(req.query)
    const data = await timeWindowService.queryAllTimeWindow({ d_no, limit, startTime, endTime })
    res.json({ success: true, data })
  } catch (err) {
    console.error('[TimeWindowController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}
