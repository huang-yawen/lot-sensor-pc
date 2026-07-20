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