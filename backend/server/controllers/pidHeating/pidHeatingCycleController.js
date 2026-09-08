/** 【文件职责】PID PWM 周期历史（加热开关阶梯图）API 控制器。
 * 【配置】无直接读取。 */
const { queryCycles } = require('../../service/pidHeating/pidHeatingCycleHistory')
const { resolveTimeRange } = require('../../utils/timeRange')

/**
 * GET /api/pid-heating-cycles
 * Query: ?limit=1000&range=1h（或 range=custom&startTime=...&endTime=...）
 */
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
