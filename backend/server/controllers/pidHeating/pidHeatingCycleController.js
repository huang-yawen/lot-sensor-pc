/**
 * 【接口】GET /api/pid-heating-cycles —— PID 周期加热开关阶梯图数据（历史图表页专用）
 *
 * 请求 query：limit（可选，默认约 1000）、range（'1h'/'6h'/'24h'/'custom'）、
 *            startTime/endTime（range=custom 时用）
 * 响应 200：{ success:true, data:[ { time, on }... ] }   按 PWM 周期边界复原的加热开/关序列
 * 出错 500：{ success:false, message }
 *
 * 计算在 service/pidHeating/pidHeatingCycleHistory.js。
 */
const { queryCycles } = require('../../service/pidHeating/pidHeatingCycleHistory')
const { resolveTimeRange } = require('../../utils/timeRange')

module.exports = async (req, res) => {
  try {
    const limit = req.query.limit
    const { startTime, endTime } = resolveTimeRange(req.query)
    const data = await queryCycles({ startTime, endTime, limit })
    res.json({ success: true, data })
  } catch (err) {
    console.error('[PidHeatingCycleController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}
