/** 【文件职责】时间窗口指标 API 控制器。
 * 【配置中心关联】TIME_WINDOW_METRICS 在服务层实时读取。 */
const timeWindowService = require('../../service/timeWindow/timeWindowService')

/**
 * GET /api/time-window
 * 查询已启用的时间窗口派生指标（滑动平均/波动/变化率）。
 * Query: ?d_no=xxx&limit=30
 */
module.exports = async (req, res) => {
  try {
    const d_no = req.query.d_no || null
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30))
    const data = await timeWindowService.queryAllTimeWindow({ d_no, limit })
    res.json({ success: true, data })
  } catch (err) {
    console.error('[TimeWindowController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}
/** 【文件职责】时间窗口派生指标 HTTP 控制器。
 * 【配置中心关联】TIME_WINDOW_METRICS 由时间窗口服务动态读取，配置保存后立即生效。 */
