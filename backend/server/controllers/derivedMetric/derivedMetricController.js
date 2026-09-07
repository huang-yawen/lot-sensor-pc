/** 【文件职责】派生指标 API 控制器，负责请求校验和响应格式。
 * 【配置中心关联】DERIVED_METRICS 由服务层实时读取。 */
const service = require('../../service/derivedMetric/derivedMetricService')
const { queryDerivedMetricHistory } = require('../../service/derivedMetric/derivedMetricHistoryQuery')
const { resolveTimeRange } = require('../../utils/timeRange')

const list = async (req, res) => {
  try {
    res.json({ success: true, data: await service.listMetrics() })
  } catch (error) {
    res.status(500).json({ success: false, message: `读取公式配置失败: ${error.message}` })
  }
}

const save = async (req, res) => {
  try {
    const metric = await service.saveMetric(req.body || {})
    res.json({ success: true, data: metric, message: req.body?.id ? '公式指标已更新' : '公式指标已新增' })
  } catch (error) {
    const duplicate = error.code === 'ER_DUP_ENTRY'
    res.status(duplicate ? 409 : 400).json({ success: false, message: duplicate ? '指标标识已存在' : error.message })
  }
}

const remove = async (req, res) => {
  try {
    const deleted = await service.deleteMetric(req.params.id)
    res.status(deleted ? 200 : 404).json({ success: deleted, message: deleted ? '公式指标已删除' : '未找到公式指标' })
  } catch (error) {
    res.status(500).json({ success: false, message: `删除失败: ${error.message}` })
  }
}

const preview = async (req, res) => {
  try {
    const result = service.previewMetric(req.body?.metric || {}, req.body?.values || {})
    res.json({ success: true, data: result })
  } catch (error) {
    res.status(400).json({ success: false, message: error.message })
  }
}

// GET /api/derived-metrics/history —— 已勾选"历史图表"的公式指标，历史图表页面专用。
// Query: ?d_no=xxx&limit=300&range=1h（或 range=custom&startTime=...&endTime=...）
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

module.exports = { list, save, remove, preview, history }
