/** 【文件职责】时间窗口指标 API 控制器。
 * 【配置】TIME_WINDOW_METRICS 在服务层实时读取。 */
const timeWindowService = require('../../service/timeWindow/timeWindowService')
const { resolveTimeRange } = require('../../utils/timeRange')

/**
 * GET /api/time-window
 * 查询已启用的时间窗口派生指标（滑动平均/波动/变化率，历史图表页面专用）。
 * Query: ?d_no=xxx&limit=300&range=1h（或 range=custom&startTime=...&endTime=...）
 */
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
