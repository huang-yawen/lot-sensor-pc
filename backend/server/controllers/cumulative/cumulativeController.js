/** 【文件职责】累计指标 API 控制器。具体的计算规则由下方服务说明。
 * 【配置中心关联】CUMULATIVE_METRICS 在服务层动态读取。 */
const cumulativeService = require('../../service/cumulative/cumulativeService')
const { resolveTimeRange } = require('../../utils/timeRange')

/**
 * GET /api/cumulative
 * 查询已启用的累计指标数据（历史图表页面专用）。
 * Query: ?d_no=xxx&limit=300&range=1h（或 range=custom&startTime=...&endTime=...）
 */
module.exports = async (req, res) => {
  try {
    const d_no = req.query.d_no || null
    const limit = req.query.limit
    const { startTime, endTime } = resolveTimeRange(req.query)
    const data = await cumulativeService.queryAllCumulative({ d_no, limit, startTime, endTime })
    res.json({ success: true, data })
  } catch (err) {
    console.error('[CumulativeController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}
