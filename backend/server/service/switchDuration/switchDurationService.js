/**
 * 【文件职责】首页开关运行时长服务：查询水泵/加热的"累计运行时长"和"本次已运行时长"。
 * 【配置中心关联】数据来源固定为 CUMULATIVE_METRICS 中 metric_key 为
 * cumulative_pump_time / cumulative_heat_time 的两条记录（source_table/source_field
 * 动态读取，字段映射改了不用同步改这里）；SWITCH_DURATION_DISPLAY.enabled 控制是否展示，
 * 由控制器层负责判断，本文件只管查询。
 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')

const MAX_GAP_SEC = 10 // 单次采样间隔上限（秒），超出视为离线间隙，不计入累计时长
const CACHE_TTL_MS = 60000 // “累计运行时长”全表扫描结果缓存 60 秒，避免高频轮询下反复全表计算

// key: `${table}.${field}:${d_no || ''}` -> { value, expireAt }
const totalMinutesCache = new Map()

/** “累计运行时长”（分钟）：全表扫描 + 60 秒内存缓存。 */
async function queryTotalOnMinutes(table, field, d_no) {
  const cacheKey = `${table}.${field}:${d_no || ''}`
  const cached = totalMinutesCache.get(cacheKey)
  if (cached && cached.expireAt > Date.now()) return cached.value

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
 * 本次开启的起点参照，用最新记录时间（而非服务器当前时间）作为终点——避免设备离线时
 * 用服务器时间继续累加导致数字失真。不走缓存，因为只是两条 ORDER BY ... LIMIT 1，
 * 无 c_time 索引下实测约 20~40ms，可接受。
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

  const minutes = (new Date(latest.c_time.replace(' ', 'T')) - new Date(startTime.replace(' ', 'T'))) / 60000
  return { isOn: true, currentSessionMinutes: Math.max(0, minutes) }
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
  const metrics = systemConfig.getConfig().CUMULATIVE_METRICS || []
  const metric = metrics.find(m => m.metric_key === metricKey)
  if (!metric) return null // 配置中心里已删除或改名该指标，前端不展示

  const { source_table: table, source_field: field, precision = 1 } = metric
  const [totalMinutes, session, fieldLabel] = await Promise.all([
    queryTotalOnMinutes(table, field, d_no),
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
