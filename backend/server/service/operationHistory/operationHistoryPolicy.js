/** 【文件职责】操作历史记录策略。
 * 【配置中心关联】OPERATION_HISTORY_MODE 每次策略判断时动态读取。 */
const systemConfig = require('../../config/systemConfig')

const DEVICE_SOURCES = new Set(['auto', 'device'])

/**
 * 根据 OPERATION_HISTORY_MODE 判断某个来源是否应写入历史。
 * 未识别的来源按“软件操作”处理，避免新增软件指令入口时意外漏记。
 */
function shouldRecord(source) {
  const mode = systemConfig.getConfig().OPERATION_HISTORY_MODE || 'both'
  if (mode === 'off') return false
  const category = DEVICE_SOURCES.has(source) ? 'device' : 'software'
  if (mode === 'software_only') return category === 'software'
  if (mode === 'device_only') return category === 'device'
  return true
}

module.exports = { shouldRecord }
