/**
 * 【文件职责】SQL 派生指标（自定义公式指标）的增删改查 5 个接口。
 * 数据存 t_derived_metric；公式引擎见 service/derivedMetric/expressionEngine.js。
 *
 *  GET    /api/derived-metrics          list()    列出全部公式配置
 *     → { success:true, data:[ 指标定义... ] }
 *  POST   /api/derived-metrics          save()    新增或更新（body 带 id 就是更新）
 *     → { success:true, data:指标, message } ；标识重复 409 ；参数错 400
 *  DELETE /api/derived-metrics/:id      remove()  删除
 *     → { success:true, message } ；不存在 404
 *  POST   /api/derived-metrics/preview  preview() 试算，不落库
 *     body { metric:{公式定义}, values:{字段名:值} } → { success:true, data:算出的值 } ；公式错 400
 *  GET    /api/derived-metrics/history  history() 已勾"历史图表"的公式指标曲线（历史图表页用）
 *     query d_no / limit / range / startTime / endTime → { success:true, data:{ metric_key:[{time,value}] } }
 *
 *  出错统一 { success:false, message }。
 * 【配置】无（公式定义存数据库，不在 config/*.js）。
 */
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
