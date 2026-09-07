/**
 * 【文件职责】只读返回拼装后的完整配置，供前端展示用（页面标题、术语、单设备模式、
 * 各页面显示开关等）。
 *
 * 配置已改为代码常量，这里不再有更新 / 重置 / 导入 / 导出接口。要改配置去改对应的
 * config.js —— 清单见 config/systemConfig.js 顶部注释。
 */
const systemConfig = require('../../config/systemConfig')

// GET /api/system-config —— 返回完整配置（只读）
const getConfig = (req, res) => {
  res.json({ success: true, data: systemConfig.getConfig() })
}

module.exports = { getConfig }
