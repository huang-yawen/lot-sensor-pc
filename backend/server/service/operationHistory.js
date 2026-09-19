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
 * 【值含义】查询时把 old_value/new_value 按 t_direct_config.f_value 转成「关/开」这类文案——
 * 设备上报路径存的是原始编码 0/1，软件下发路径存的是 on/off，不转的话同一列会混着两种写法。
 * 实现见下方"值含义映射"，同时兼容把 0/1 别名到同一侧文案。
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

function normalizeHistoryValue(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim()
  return String(value)
}

async function shouldSkipDuplicateHistory({ d_no, config_id, old_value, new_value }) {
  const normalizedNewValue = normalizeHistoryValue(new_value)
  const normalizedOldValue = normalizeHistoryValue(old_value)

  // 真实没有任何状态变化时，不记重复历史（例如“已关 -> 继续关”）。
  if (normalizedOldValue !== null && normalizedNewValue !== null && normalizedOldValue === normalizedNewValue) {
    return true
  }

  if (!d_no || config_id === null || config_id === undefined || normalizedNewValue === null) {
    return false
  }

  const finalDNo = normalizeDeviceNo(d_no)
  if (!finalDNo) {
    return false
  }

  try {
    await ensureOperationHistoryTable()
    const [rows] = await promisePool.query(
      `SELECT new_value
       FROM t_operation_history
       WHERE d_no = ? AND config_id = ?
       ORDER BY c_time DESC, id DESC
       LIMIT 1`,
      [finalDNo, Number(config_id)]
    )

    if (!rows || rows.length === 0) {
      return false
    }

    const latestValue = normalizeHistoryValue(rows[0].new_value)
    return latestValue !== null && latestValue === normalizedNewValue
  } catch (error) {
    console.warn('[OperationHistory] 去重判断失败，继续写入历史:', error.message)
    return false
  }
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

    const shouldSkip = await shouldSkipDuplicateHistory({
      d_no: finalDNo,
      config_id,
      old_value,
      new_value
    })

    if (shouldSkip) {
      console.log('[OperationHistory] 跳过重复状态记录:', { d_no: finalDNo, config_id, old_value, new_value, source })
      return { success: true, skipped: true, reason: 'duplicate_state' }
    }

    const safeOldValue = old_value == null ? null : String(old_value)
    const safeNewValue = new_value == null ? null : String(new_value)

    const [result] = await promisePool.execute(
      `INSERT INTO t_operation_history (d_no, config_id, old_value, new_value, source, c_time)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [finalDNo, config_id ?? null, safeOldValue, safeNewValue, source, time]
    )
    console.log('[OperationHistory] 保存成功:', { d_no: finalDNo, config_id, old_value, new_value, source, c_time: time, id: result.insertId })
    return { success: true, insertId: result.insertId }
  } catch (error) {
    console.error('[OperationHistory] 保存失败:', error.message)
    return { success: false, error: error.message }
  }
}

// ==================== 值含义映射 ====================
// t_operation_history 存的是原始值：软件下发路径（manual / interlock / pid_heating …）存的是
// t_direct 里的规范值 'on'/'off'；而设备上报路径（source='auto'，见
// mqtt/behaviorRealtime/behaviorRealtimeRepository.js）存的是设备自己报的原始编码 '0'/'1'。
// 同一列因此混着 on/off 和 0/1，直接展示很不直观。
// 值含义来自 t_direct_config.f_value（格式 '文案:值|文案:值'，如 '关:off|开:on'），
// 这正是 operationHistory.sql 注释里说的"关联 t_direct_config 获取操作名称和值含义"那一步。
const SWITCH_F_TYPE = '1'
// 跟 behaviorRealtimeRepository.js / controlHelpers.js 同一套宽松识别：这些值算"开"。
const ON_TOKENS = new Set(['on', 'open', '1', 'true'])

function isOnToken(value) {
  return ON_TOKENS.has(String(value ?? '').trim().toLowerCase())
}

/**
 * 把一条指令项的 f_value 解析成 { 原始值: 展示文案 }。
 * 只处理开关类（f_type='1'）：其它类型的 f_value 不是值含义表——输入框/滑动条不配；
 * 时间框存的是 'pump:on' 这种"目标preffix:目标值"绑定（见 service/schedule），
 * 误当映射会把值显示成 preffix。开关类额外补 '0'/'1' 两个别名指向"关/开"那一侧的文案，
 * 兼容设备上报路径存的原始编码。
 * @param {string} fType - t_direct_config.f_type
 * @param {string} fValue - t_direct_config.f_value
 * @returns {Object|null} 形如 { off: '关', on: '开', 0: '关', 1: '开' }；解析不出返回 null
 */
function parseDirectValueLabels(fType, fValue) {
  if (String(fType ?? '').trim() !== SWITCH_F_TYPE) return null
  const text = String(fValue ?? '').trim()
  if (!text) return null

  const labels = {}
  let onLabel = null
  let offLabel = null
  for (const part of text.split('|')) {
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const label = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (!label || !value) continue
    labels[value] = label
    if (isOnToken(value)) onLabel = label
    else offLabel = label
  }
  if (Object.keys(labels).length === 0) return null

  if (offLabel !== null && labels['0'] === undefined) labels['0'] = offLabel
  if (onLabel !== null && labels['1'] === undefined) labels['1'] = onLabel
  return labels
}

/** 拉取所有开关类指令项，构建 { config_id: { 原始值: 文案 } }。表很小，直接全量取。 */
async function loadDirectValueLabelMap() {
  const [rows] = await promisePool.query(
    'SELECT id, f_type, f_value FROM t_direct_config WHERE f_type = ?',
    [SWITCH_F_TYPE]
  )
  const map = {}
  for (const row of rows) {
    const labels = parseDirectValueLabels(row.f_type, row.f_value)
    if (labels) map[Number(row.id)] = labels
  }
  return map
}

/** 给历史值套文案；没配置映射（数值类指令项 / 已删掉的指令项）时原样返回。 */
function labelHistoryValue(rawValue, labels) {
  if (rawValue === null || rawValue === undefined) return rawValue
  if (!labels) return rawValue
  const key = String(rawValue).trim()
  return Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : rawValue
}

// ==================== 分页查询 ====================
// 通过 JOIN t_direct_config 拿操作名称（t_name）和值含义（f_value），改数据库就能适配不同赛题。
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

  // 三条查询互不依赖，并发发出：总数、当页数据、开关类指令项的值含义表。
  const offset = (currentPage - 1) * pageSize
  const [countResult, rowsResult, valueLabels] = await Promise.all([
    promisePool.query(
      `SELECT COUNT(*) AS total FROM t_operation_history h
       LEFT JOIN t_direct_config c ON h.config_id = c.id
       ${whereClause}`,
      queryParams
    ),
    promisePool.query(
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
              -- 来源文案。前 12 个对应当前代码里实际会写入的 source（见各 setSwitch 调用）；
              -- 最后 3 个是历史遗留 source（当前代码已无写入点，库里还留着少量旧记录），
              -- 按字面含义给出中文，避免这一列漏出英文。
              CASE h.source
                 WHEN 'manual' THEN '软件下发'
                 WHEN 'manual_queued' THEN '离线补发'
                 WHEN 'interlock' THEN '自动联锁'
                 WHEN 'calibration' THEN '自动校时'
                 WHEN 'linkage_rules' THEN '联动控制'
                 WHEN 'pid_heating' THEN 'PID恒温控制'
                 WHEN 'pump_velocity_control' THEN '恒流速控制'
                 WHEN 'quantity_shutdown' THEN '定量停机'
                 WHEN 'temp_shutdown' THEN '定温停机'
                 WHEN 'fault_status' THEN '故障断电'
                 WHEN 'fault_reset' THEN '故障复位'
                 WHEN 'schedule' THEN '定时任务'
                 WHEN 'auto' THEN '底层设备'
                 WHEN 'device' THEN '底层设备'
                 WHEN 'auto_control' THEN '自动控制'
                 WHEN 'pid_autotune' THEN 'PID自整定'
                 WHEN 'auto_tune' THEN 'PID自整定'
                 WHEN 'layered_control' THEN '分层控制'
                 ELSE h.source
              END AS '来源',
              h.c_time AS '操作时间',
              h.config_id AS __configId
       FROM t_operation_history h
       LEFT JOIN t_direct_config c ON h.config_id = c.id
       ${whereClause}
       ORDER BY h.c_time DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, Number(pageSize), Number(offset)]
    ),
    loadDirectValueLabelMap(),
  ])

  const total = countResult[0][0]?.total ?? 0
  const rows = rowsResult[0]

  // 旧值/新值换成指令项配置的文案：'on' 和 '1' 都显示成"开"、'off' 和 '0' 都显示成"关"，
  // 不再一半 on/off 一半 0/1。__configId 只是查映射用的中间列，返回前删掉——
  // 否则前端把 data[0] 的 key 当表头，会凭空多出一列。
  for (const row of rows) {
    const labels = row.__configId == null ? null : valueLabels[Number(row.__configId)]
    delete row.__configId
    row['旧值'] = labelHistoryValue(row['旧值'], labels)
    row['新值'] = labelHistoryValue(row['新值'], labels)
  }

  return { rows, total }
}

module.exports = {
  OPERATION_HISTORY_MODE: CONFIG.OPERATION_HISTORY_MODE,
  shouldRecord,
  ensureOperationHistoryTable,
  saveOperationHistory,
  getOperationHistory,
}
