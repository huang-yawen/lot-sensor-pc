/**
 * 【接口】GET /api/cumulative —— 累计指标历史曲线（历史图表页专用）
 *
 * 请求 query：
 *   d_no        可选  设备编号（单设备模式可不传）
 *   limit       可选  返回多少个点，默认见服务层（约 300）
 *   range       可选  '1h' / '6h' / '24h' / 'custom'
 *   startTime / endTime  range=custom 时用（'YYYY-MM-DD HH:mm:ss'）
 *
 * 响应 200：{ success:true, data:{ <指标metric_key>: [{ time, value }...] } }
 * 出错 500：{ success:false, message }
 *
 * 指标定义在 config/metrics.js 的 CUMULATIVE_METRICS；enabled=false 的不返回。
 * 计算在 service/cumulative/cumulativeService.js。
 */
const cumulativeService = require('../../service/cumulative/cumulativeService')
const { resolveTimeRange } = require('../../utils/timeRange')

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
