/** 【文件职责】温度-流量相关性散点图 API 控制器。
 * 【配置】无直接读取；d_no/时间范围/条数上限均来自请求参数。 */
const { queryTempFlowScatter } = require('../../service/computedMetrics/scatterChartQuery')
const { resolveTimeRange } = require('../../utils/timeRange')

module.exports = async (req, res) => {
  try {
    const d_no = req.query.d_no || null
    const limit = req.query.limit
    const { startTime, endTime } = resolveTimeRange(req.query)
    const rows = await queryTempFlowScatter({ d_no, limit, startTime, endTime })
    res.json({ success: true, data: rows })
  } catch (err) {
    console.error('[ScatterChartController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}
