const service = require('../../service/derivedMetric/derivedMetricService')

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

module.exports = { list, save, remove, preview }
