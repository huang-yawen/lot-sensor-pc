/**
 * 【文件职责】操作历史（t_operation_history）：写入策略 + 写入 + 分页查询。
 * （原来是 service/operationHistory/ 下 config + policy + save + get 4 个文件，合并到这里。）
 *
 * 一条操作历史 = 某个执行器/参数被谁在什么时候改了。source 分类：
 *   manual        页面在线下发成功
 *   manual_queued 设备上线后成功补发的离线暂存指令
 *   interlock     本地告警触发的自动联锁
 *   calibration   设备上线后的自动校时
 *   schedule      指令页设定的定时时刻到点后自动下发
 *   auto / device 通过状态上报识别出的底层设备操作
 *
 * 【配置】记录模式常量 CONFIG.OPERATION_HISTORY_MODE 就在下面。改完重启后端生效。
 * GET /api/system-config 也会读这里导出的 OPERATION_HISTORY_MODE。
 */
const promisePool = require('../config/dbPool')
const { nowLocalDateTime, formatLocalDateTime } = require('../utils/helper')
const { normalizeDeviceNo } = require('./directData/saveDirectConfig')

// ==================== 配置 ====================
const CONFIG = {
  // 'both'          - 同时记录软件指令和底层操作（推荐）
  // 'software_only' - 只记录软件指令（页面在线下发、离线补发、自动联锁、自动校时）
  // 'device_only'   - 只记录底层操作（设备状态上报与系统期望不一致时识别出的现场操作）
  // 'off'           - 完全关闭操作历史写入
  OPERATION_HISTORY_MODE: 'both',
}

// ==================== 记录策略 ====================
const DEVICE_SOURCES = new Set(['auto', 'device'])

/**
 * 根据 OPERATION_HISTORY_MODE 判断某个来源是否应写入历史。
 * 未识别的来源按“软件操作”处理，避免新增软件指令入口时意外漏记。
 */
function shouldRecord(source) {
  const mode = CONFIG.OPERATION_HISTORY_MODE || 'both'
  if (mode === 'off') return false
  const category = DEVICE_SOURCES.has(source) ? 'device' : 'software'
  if (mode === 'software_only') return category === 'software'
  if (mode === 'device_only') return category === 'device'
  return true
}

// ==================== 建表 + 写入 ====================
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

  // 使用本地时区时间，避免 toISOString() 的 UTC 时差（8小时偏差）
  const time = c_time
    ? (typeof c_time === 'string' || c_time instanceof Date
        ? formatLocalDateTime(c_time)
        : nowLocalDateTime())
    : nowLocalDateTime()

  // 跟 saveDirectConfig.js 用同一套标准化：调用方传来的原始 d_no 有时是未处理过的
  // 字符串 'null'/'undefined'（比如多设备模式下全局配置），不标准化会被当成真实
  // 设备号原样存进去，这条操作历史会被错误归到一个叫"null"的设备名下。
  const finalDNo = normalizeDeviceNo(d_no)

  try {
    await ensureOperationHistoryTable()
    const [result] = await promisePool.execute(
      `INSERT INTO t_operation_history (d_no, config_id, old_value, new_value, source, c_time)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [finalDNo, config_id ?? null, old_value == null ? null : String(old_value), new_value == null ? null : String(new_value), source, time]
    )
    console.log('[OperationHistory] 保存成功:', { d_no: finalDNo, config_id, old_value, new_value, source, c_time: time, id: result.insertId })
    return { success: true, insertId: result.insertId }
  } catch (error) {
    console.error('[OperationHistory] 保存失败:', error.message)
    return { success: false, error: error.message }
  }
}

// ==================== 分页查询 ====================
// 通过 JOIN t_direct_config 拿操作名称（t_name），改数据库就能适配不同赛题。
/**
 * @param {Object} params
 * @param {number} params.currentPage - 当前页码（从1开始）
 * @param {number} params.pageSize - 每页条数
 * @param {string} params.startTime - 开始时间
 * @param {string} params.endTime - 结束时间
 * @param {number|null} params.config_id - 指令类型ID（筛选特定指令配置）
 * @returns {Promise<{rows: Array, total: number}>}
 */
async function getOperationHistory({ currentPage = 1, pageSize = 5, startTime = null, endTime = null, config_id = null }) {
  await ensureOperationHistoryTable()
  const conditions = []
  const queryParams = []

  if (config_id !== null && config_id !== undefined && config_id !== '') {
    conditions.push('h.config_id = ?')
    queryParams.push(Number(config_id))
  }
  if (startTime) {
    conditions.push('h.c_time >= ?')
    queryParams.push(startTime)
  }
  if (endTime) {
    conditions.push('h.c_time <= ?')
    queryParams.push(endTime)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // 查询总数
  const [[{ total }]] = await promisePool.query(
    `SELECT COUNT(*) AS total FROM t_operation_history h
     LEFT JOIN t_direct_config c ON h.config_id = c.id
     ${whereClause}`,
    queryParams
  )

  // 分页查询，JOIN t_direct_config 获取操作名称
  const offset = (currentPage - 1) * pageSize
  const [rows] = await promisePool.query(
    `SELECT h.id, h.d_no AS '设备编号',
            COALESCE(c.t_name,
              CASE h.source
                WHEN 'interlock' THEN '自动联锁'
                WHEN 'calibration' THEN '自动校时'
                ELSE '未知操作'
              END
            ) AS '操作名称',
            h.old_value AS '旧值',
            h.new_value AS '新值',
            CASE h.source
               WHEN 'manual' THEN '软件下发'
               WHEN 'manual_queued' THEN '离线补发'
               WHEN 'interlock' THEN '自动联锁'
               WHEN 'calibration' THEN '自动校时'
               WHEN 'auto_control' THEN '自动控制'
               WHEN 'quantity_shutdown' THEN '定量停机'
               WHEN 'schedule' THEN '定时任务'
               WHEN 'auto' THEN '底层设备'
               WHEN 'device' THEN '底层设备'
               ELSE h.source
            END AS '来源',
            h.c_time AS '操作时间'
     FROM t_operation_history h
     LEFT JOIN t_direct_config c ON h.config_id = c.id
     ${whereClause}
     ORDER BY h.c_time DESC
     LIMIT ? OFFSET ?`,
    [...queryParams, Number(pageSize), Number(offset)]
  )

  return { rows, total }
}

module.exports = {
  OPERATION_HISTORY_MODE: CONFIG.OPERATION_HISTORY_MODE,
  shouldRecord,
  ensureOperationHistoryTable,
  saveOperationHistory,
  getOperationHistory,
}
