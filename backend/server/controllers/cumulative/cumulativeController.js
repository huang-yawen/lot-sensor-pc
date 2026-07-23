/** 【文件职责】累计指标 API 控制器。具体的计算规则由下方服务说明。
 * 【配置中心关联】CUMULATIVE_METRICS 在服务层动态读取。 */
const cumulativeService = require('../../service/cumulative/cumulativeService')

/**
 * GET /api/cumulative
 * 查询已启用的累计指标数据（首页独立图表专用）。
 * Query: ?d_no=xxx&limit=30
 */
module.exports = async (req, res) => {
  try {
    const d_no = req.query.d_no || null
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30))
    const data = await cumulativeService.queryAllCumulative({ d_no, limit })
    res.json({ success: true, data })
  } catch (err) {
    console.error('[CumulativeController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}
/** 【文件职责】累计派生指标 HTTP 控制器，校验请求并调用累计计算服务。
 * 【配置中心关联】CUMULATIVE_METRICS 由下层服务读取；本控制器不缓存配置。 */
