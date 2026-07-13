/**
 * 操作历史记录服务
 * 
 * 记录操作历史，关联 t_direct_config.id 获取操作名称和值含义。
 * 来源有两种：manual（前端指令下发）/ auto（设备状态变化）
 */

const promisePool = require('../../config/dbPool')

/**
 * 保存操作历史记录
 * @param {Object} params
 * @param {string} params.d_no - 设备编号
 * @param {number} params.config_id - 指令配置ID，关联t_direct_config.id
 * @param {string} params.old_value - 旧值（对应t_direct_config.f_value中的值部分）
 * @param {string} params.new_value - 新值
 * @param {string} params.source - 来源：manual / auto
 * @param {string} params.c_time - 操作时间
 * @returns {Promise<Object>}
 */
async function saveOperationHistory({ d_no, config_id, old_value = null, new_value, source = 'manual', c_time }) {
  const time = c_time || new Date().toISOString().slice(0, 19).replace('T', ' ')

  try {
    const [result] = await promisePool.execute(
      `INSERT INTO t_operation_history (d_no, config_id, old_value, new_value, source, c_time) VALUES (?, ?, ?, ?, ?, ?)`,
      [d_no || null, config_id, old_value, new_value, source, time]
    )
    console.log('[OperationHistory] 保存成功:', { d_no, config_id, old_value, new_value, source, id: result.insertId })
    return { success: true, insertId: result.insertId }
  } catch (err) {
    console.error('[OperationHistory] 保存失败:', err.message)
    return { success: false, error: err.message }
  }
}

module.exports = { saveOperationHistory }