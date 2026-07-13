/**
 * 系统配置 API 控制器
 * GET    /api/system-config          — 获取当前配置
 * POST   /api/system-config          — 更新配置（部分更新，热更新）
 * POST   /api/system-config/reset    — 重置为默认配置
 * GET    /api/system-config/export   — 导出配置（含时间戳，可保存为备份文件）
 * POST   /api/system-config/import   — 导入配置（从备份文件恢复）
 */
const systemConfig = require('../../config/systemConfig')

// GET /api/system-config — 获取当前配置
const getConfig = (req, res) => {
  res.json({
    success: true,
    data: systemConfig.getConfig(),
  })
}

// POST /api/system-config — 更新配置
const updateConfig = (req, res) => {
  try {
    const partial = req.body
    if (!partial || typeof partial !== 'object' || Object.keys(partial).length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供需要更新的配置项',
      })
    }

    const updated = systemConfig.updateConfig(partial)
    if (updated) {
      res.json({
        success: true,
        data: systemConfig.getConfig(),
        message: '配置更新成功',
      })
    } else {
      res.json({
        success: true,
        data: systemConfig.getConfig(),
        message: '没有匹配到可更新的配置项，当前配置未变化',
      })
    }
  } catch (err) {
    console.error('[SystemConfig] 更新配置失败:', err)
    res.status(500).json({
      success: false,
      message: '更新配置失败: ' + err.message,
    })
  }
}

// POST /api/system-config/reset — 重置为默认配置
const resetConfig = (req, res) => {
  try {
    systemConfig.resetConfig()
    res.json({
      success: true,
      data: systemConfig.getConfig(),
      message: '配置已重置为默认值',
    })
  } catch (err) {
    console.error('[SystemConfig] 重置配置失败:', err)
    res.status(500).json({
      success: false,
      message: '重置配置失败: ' + err.message,
    })
  }
}

// GET /api/system-config/export — 导出配置
const exportConfig = (req, res) => {
  try {
    const config = systemConfig.exportConfig()
    res.json({
      success: true,
      data: config,
      message: '配置导出成功',
    })
  } catch (err) {
    console.error('[SystemConfig] 导出配置失败:', err)
    res.status(500).json({
      success: false,
      message: '导出配置失败: ' + err.message,
    })
  }
}

// POST /api/system-config/import — 导入配置
const importConfig = (req, res) => {
  try {
    const config = req.body
    if (!config || typeof config !== 'object') {
      return res.status(400).json({
        success: false,
        message: '请提供有效的配置数据',
      })
    }

    const imported = systemConfig.importConfig(config)
    if (imported) {
      res.json({
        success: true,
        data: systemConfig.getConfig(),
        message: '配置导入成功',
      })
    } else {
      res.json({
        success: true,
        data: systemConfig.getConfig(),
        message: '没有匹配到可导入的配置项',
      })
    }
  } catch (err) {
    console.error('[SystemConfig] 导入配置失败:', err)
    res.status(500).json({
      success: false,
      message: '导入配置失败: ' + err.message,
    })
  }
}

module.exports = {
  getConfig,
  updateConfig,
  resetConfig,
  exportConfig,
  importConfig,
}