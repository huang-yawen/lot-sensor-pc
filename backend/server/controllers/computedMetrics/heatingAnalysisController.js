/**
 * 【文件职责】"加热效率 / 加热速度"历史图表 API 控制器。薄薄一层：解析时间范围、
 * 调查询服务、包装响应——公式全在 heatingAnalysisQuery.js 里，这里不重复写。
 * 一个接口一次返回两条数据（efficiency / rate），前端一次请求画两张图。
 * 【配置中心关联】无直接读取（服务层内部实时读取）。
 */
const { queryHeatingEfficiency, queryHeatingRate } = require('../../service/computedMetrics/heatingAnalysisQuery')
const { resolveTimeRange } = require('../../utils/timeRange')

module.exports = async (req, res) => {
  try {
    const limit = req.query.limit
    const { startTime, endTime } = resolveTimeRange(req.query)
    const [efficiency, rate] = await Promise.all([
      queryHeatingEfficiency({ limit, startTime, endTime }),
      queryHeatingRate({ limit, startTime, endTime }),
    ])
    res.json({ success: true, data: { efficiency, rate } })
  } catch (err) {
    console.error('[HeatingAnalysisController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}
