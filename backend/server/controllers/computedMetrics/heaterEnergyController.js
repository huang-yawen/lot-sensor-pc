/**
 * 【文件职责】加热能耗分析历史图表 API 控制器。只做最薄的一层：接收请求参数、
 * 解析时间范围、调用查询服务、包装成统一响应格式——真正的计算逻辑全在
 * heaterEnergyQuery.js 里，这里不重复写任何公式。
 * 【配置】无直接读取（服务层内部实时读取）。
 */
const { queryHeaterEnergy } = require('../../service/computedMetrics/heaterEnergyQuery')
const { resolveTimeRange } = require('../../utils/timeRange')

module.exports = async (req, res) => {
  try {
    const d_no = req.query.d_no || null
    const limit = req.query.limit
    const { startTime, endTime } = resolveTimeRange(req.query)
    const rows = await queryHeaterEnergy({ d_no, limit, startTime, endTime })
    res.json({ success: true, data: { rows } })
  } catch (err) {
    console.error('[HeaterEnergyController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}
