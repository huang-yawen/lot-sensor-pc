/**
 * 【文件职责】SQL 派生指标（自定义公式指标）对外只剩一个查询接口。
 * 公式定义存 t_derived_metric，靠数据库手工维护（原配置中心的公式编辑页已删除）。
 * 公式引擎见 service/derivedMetric/expressionEngine.js；
 * 表格内联派生指标由 service/tableData/getTableData.js 直接调 service 层，不经过这里。
 *
 *  GET /api/derived-metrics/history  history()  已勾"历史图表"的公式指标曲线（历史图表页 HistoryCharts.vue 用）
 *     query d_no / limit / range / startTime / endTime
 *     → { success:true, data:{ metric_key:[{time,value}] } }
 *     出错 → 500 { success:false, message }
 *
 * 【配置】无（公式定义存数据库，不在 config/*.js）。
 */
const { queryDerivedMetricHistory } = require('../../service/derivedMetric/derivedMetricHistoryQuery')
const { resolveTimeRange } = require('../../utils/timeRange')

const history = async (req, res) => {
  try {
    const d_no = req.query.d_no || null
    const limit = req.query.limit
    const { startTime, endTime } = resolveTimeRange(req.query)
    const data = await queryDerivedMetricHistory({ d_no, limit, startTime, endTime })
    res.json({ success: true, data })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
}

module.exports = { history }
