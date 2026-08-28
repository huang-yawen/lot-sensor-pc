/** 【文件职责】设备状态时间线（水泵/加热开关）历史图表 API 控制器。
 * 【配置中心关联】无直接读取。 */
const { queryDeviceStateTrend } = require('../../service/computedMetrics/deviceStateQuery')
const { resolveTimeRange } = require('../../utils/timeRange')

/**
 * GET /api/device-state-trend
 * Query: ?d_no=xxx&limit=300&range=1h（或 range=custom&startTime=...&endTime=...）
 */
module.exports = async (req, res) => {
  try {
    const d_no = req.query.d_no || null
    const limit = req.query.limit
    const { startTime, endTime } = resolveTimeRange(req.query)
    const data = await queryDeviceStateTrend({ d_no, limit, startTime, endTime })
    res.json({ success: true, data })
  } catch (err) {
    console.error('[DeviceStateTrendController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}
