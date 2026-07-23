/**
 * 统一操作历史服务。
 *
 * source 分类：
 * - manual：页面在线下发成功
 * - manual_queued：设备上线后成功补发离线暂存指令
 * - interlock：本地告警触发的自动联锁
 * - calibration：设备上线后的自动校时
 * - auto：通过状态上报识别出的底层设备操作
 */
const promisePool = require('../../config/dbPool')
const { shouldRecord } = require('./operationHistoryPolicy')
let ensureTablePromise = null

function ensureOperationHistoryTable() {
  if (ensureTablePromise) return ensureTablePromise
  ensureTablePromise = promisePool.query(`CREATE TABLE IF NOT EXISTS t_operation_history (
    id INT(11) NOT NULL AUTO_INCREMENT,
    d_no VARCHAR(64) DEFAULT NULL,
    config_id INT(11) DEFAULT NULL,
    old_value VARCHAR(255) DEFAULT NULL,
    new_value VARCHAR(255) DEFAULT NULL,
    source VARCHAR(32) DEFAULT NULL,
    c_time DATETIME DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_d_no (d_no),
    KEY idx_c_time (c_time),
    KEY idx_config_id (config_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8`).catch(error => {
    ensureTablePromise = null
    throw error
  })
  return ensureTablePromise
}

async function saveOperationHistory({ d_no, config_id, old_value = null, new_value, source = 'manual', c_time }) {
  if (!shouldRecord(source)) {
    return { success: true, skipped: true, reason: 'disabled_by_config' }
  }

  const time = c_time || new Date().toISOString().slice(0, 19).replace('T', ' ')
  try {
    await ensureOperationHistoryTable()
    const [result] = await promisePool.execute(
      `INSERT INTO t_operation_history (d_no, config_id, old_value, new_value, source, c_time)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [d_no || null, config_id ?? null, old_value == null ? null : String(old_value), new_value == null ? null : String(new_value), source, time]
    )
    console.log('[OperationHistory] 保存成功:', { d_no, config_id, old_value, new_value, source, id: result.insertId })
    return { success: true, insertId: result.insertId }
  } catch (error) {
    console.error('[OperationHistory] 保存失败:', error.message)
    return { success: false, error: error.message }
  }
}

module.exports = { ensureOperationHistoryTable, shouldRecord, saveOperationHistory }
/** 【文件职责】写入操作历史服务，记录在线下发、离线暂存和缓存补发等动作。
 * 【配置中心关联】OPERATION_HISTORY_MODE 控制是否及如何记录，避免不同调用方规则不一致。 */
