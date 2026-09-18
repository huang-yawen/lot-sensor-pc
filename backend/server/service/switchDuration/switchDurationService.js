/**
 * 【文件职责】首页开关运行时长服务：查询水泵/加热的"累计运行时长"和"本次已运行时长"。
 * 【配置】数据来源固定为 CUMULATIVE_METRICS 中 metric_key 为
 * cumulative_pump_time / cumulative_heat_time 的两条记录（source_table/source_field
 * 动态读取，字段映射改了不用同步改这里）；SWITCH_DURATION_DISPLAY.enabled 控制是否展示，
 * 由控制器层负责判断，本文件只管查询。
 */
const promisePool = require('../../config/dbPool')
const { CUMULATIVE_METRICS } = require('../../config/metrics')
const { querySnapshotLatest } = require('../cumulative/cumulativeSnapshotService')

const MAX_GAP_SEC = 10 // 单次采样间隔上限（秒），超出视为离线间隙，不计入累计时长
const CACHE_TTL_MS = 60000 // “累计运行时长”全表扫描结果缓存 60 秒，避免高频轮询下反复全表计算

// key: `${table}.${field}:${d_no || ''}` -> { value, expireAt }
const totalMinutesCache = new Map()

/** “累计运行时长”（分钟）：优先读累计快照表（预计算，走索引），没有快照再回退全表扫描；结果 60 秒内存缓存。 */
async function queryTotalOnMinutes(table, field, d_no, metricKey) {
  const cacheKey = `${table}.${field}:${d_no || ''}`
  const cached = totalMinutesCache.get(cacheKey)
  if (cached && cached.expireAt > Date.now()) return cached.value

  // 优先读累计快照表里该指标的最新累计值（就是全量累计时长，单位分钟），避免每次全表扫描。
  if (metricKey) {
    try {
      const latest = await querySnapshotLatest({ metric_key: metricKey, d_no })
      if (latest != null) {
        totalMinutesCache.set(cacheKey, { value: latest, expireAt: Date.now() + CACHE_TTL_MS })
        return latest
      }
    } catch (err) {
      console.error(`[SwitchDuration] 读取 ${metricKey} 累计快照失败，回退全表计算:`, err.message)
    }
  }

  const conditions = []
  const params = []
  if (d_no) { conditions.push('d_no = ?'); params.push(d_no) }
  const whereExtra = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [[row]] = await promisePool.query(`
    SELECT SUM(COALESCE(is_on * LEAST(dt_sec, ${MAX_GAP_SEC}), 0)) / 60 AS total_minutes
    FROM (
      SELECT
        CASE WHEN TRIM(\`${field}\`) = '1' THEN 1 ELSE 0 END AS is_on,
        TIMESTAMPDIFF(SECOND, LAG(c_time) OVER (ORDER BY c_time ASC, id ASC), c_time) AS dt_sec
      FROM ${table}
      ${whereExtra}
    ) AS with_dt
  `, params)

  const value = Number(row.total_minutes) || 0
  totalMinutesCache.set(cacheKey, { value, expireAt: Date.now() + CACHE_TTL_MS })
  return value
}

/**
 * “本次已运行时长”（分钟）：判断当前是否开启，若开启则找最近一次“非开启”记录的时间作为
 * 本次开启的起点参照（没有则用该设备第一条记录的时间）。起点到最新记录之间不再直接做
 * 首尾时间差，而是跟 queryTotalOnMinutes 同一套窗口函数逐行按 MAX_GAP_SEC 裁剪求和——
 * 避免本次开启期间设备离线（超过 MAX_GAP_SEC 无上报）时，把离线的这段时间也当成"已运行"
 * 算进去，导致跟"累计运行时长"的口径对不上（该问题由离线间隙没有被排除引起）。
 * 不走缓存，因为只是几条 ORDER BY ... LIMIT 1 加一次窗口函数查询，可接受。
 */
async function queryCurrentSession(table, field, d_no) {
  const conditions = []
  const params = []
  if (d_no) { conditions.push('d_no = ?'); params.push(d_no) }
  const whereBase = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [[latest]] = await promisePool.query(
    `SELECT c_time, \`${field}\` AS val FROM ${table} ${whereBase} ORDER BY c_time DESC, id DESC LIMIT 1`,
    params
  )
  if (!latest || String(latest.val).trim() !== '1') {
    return { isOn: false, currentSessionMinutes: 0 }
  }

  const offConditions = [...conditions, `TRIM(\`${field}\`) != '1'`]
  const [[lastOff]] = await promisePool.query(
    `SELECT c_time FROM ${table} WHERE ${offConditions.join(' AND ')} ORDER BY c_time DESC, id DESC LIMIT 1`,
    params
  )

  let startTime
  if (lastOff) {
    startTime = lastOff.c_time
  } else {
    const [[first]] = await promisePool.query(`SELECT MIN(c_time) AS c_time FROM ${table} ${whereBase}`, params)
    startTime = first?.c_time
  }
  if (!startTime) return { isOn: true, currentSessionMinutes: 0 }

  // 从起点（含，即上一次"关"的那一行，or 该设备第一条记录）到最新记录之间，逐行算
  // 相邻时间差、裁剪到 MAX_GAP_SEC 上限、只在 is_on 的行上累加——跟 queryTotalOnMinutes
  // 完全同一套算法，只是把范围限定在本次开启区间，保证两个数字口径一致。
  const sessionConditions = [...conditions, 'c_time >= ?']
  const sessionParams = [...params, startTime]
  const [[session]] = await promisePool.query(`
    SELECT SUM(COALESCE(is_on * LEAST(dt_sec, ${MAX_GAP_SEC}), 0)) / 60 AS minutes
    FROM (
      SELECT
        CASE WHEN TRIM(\`${field}\`) = '1' THEN 1 ELSE 0 END AS is_on,
        TIMESTAMPDIFF(SECOND, LAG(c_time) OVER (ORDER BY c_time ASC, id ASC), c_time) AS dt_sec
      FROM ${table}
      WHERE ${sessionConditions.join(' AND ')}
    ) AS with_dt
  `, sessionParams)

  return { isOn: true, currentSessionMinutes: Math.max(0, Number(session.minutes) || 0) }
}

/** 从 t_behavior_field_mapper 查 db_name 对应的中文字段名，供前端匹配"运行状态"区块里的字段。 */
async function getFieldLabel(dbName) {
  const [[row]] = await promisePool.query(
    'SELECT f_name FROM t_behavior_field_mapper WHERE db_name = ? LIMIT 1',
    [dbName]
  )
  return row?.f_name || null
}

/** 根据 CUMULATIVE_METRICS 中的 metric_key 查一份 { isOn, totalMinutes, currentSessionMinutes, fieldLabel }。 */
async function querySwitchDuration(metricKey, d_no) {
  const metrics = CUMULATIVE_METRICS || []
  const metric = metrics.find(m => m.metric_key === metricKey)
  if (!metric) return null // 配置中心里已删除或改名该指标，前端不展示

  const { source_table: table, source_field: field, precision = 1 } = metric
  const [totalMinutes, session, fieldLabel] = await Promise.all([
    queryTotalOnMinutes(table, field, d_no, metric.metric_key),
    queryCurrentSession(table, field, d_no),
    getFieldLabel(field),
  ])

  return {
    fieldLabel,
    isOn: session.isOn,
    totalMinutes: Number(totalMinutes.toFixed(precision)),
    currentSessionMinutes: Number(session.currentSessionMinutes.toFixed(precision)),
  }
}

/** 汇总水泵 + 加热两组数据。 */
async function getSwitchDurationSummary(d_no) {
  const [pump, heater] = await Promise.all([
    querySwitchDuration('cumulative_pump_time', d_no),
    querySwitchDuration('cumulative_heat_time', d_no),
  ])
  return { pump, heater }
}

module.exports = { getSwitchDurationSummary }
