/**
 * 【文件职责】累计指标快照服务：把“全表累计值”预计算好存进 t_cumulative_snapshot，
 * 查询时直接读快照，避免每次在原始大表上跑窗口函数（SUM OVER UNBOUNDED PRECEDING）全表扫描。
 *
 * 数据流：
 *   ① 每条 MQTT 数据落库后，appendSnapshots() 按“上一条读数 → 本条读数”的真实时间差算出
 *      本条增量，累加到该 (设备, 指标) 的累计值，写入一行快照（c_time = 本条采集时间）。
 *   ② 历史图表页 / 计算指标明细表查询时，querySnapshotSeries() 直接按 (metric_key, c_time)
 *      索引读取，并可选按时间分桶降采样，毫秒级返回“全量累计值在该时刻的读数”。
 *   ③ 部署/重建后历史数据没有快照：跑 init/backfill_cumulative_snapshot.js 一次性回填；
 *      未回填时 cumulativeService 会自动回退到原实时计算，页面不会空白。
 *
 * 口径与 cumulativeService 保持一致（只处理 flow_integral / on_duration 两种累计）：
 *   flow_integral：Δ = max(流量,0)/60 × min(Δt, 10)   单位 L（第一条 Δt 按 1 秒，跟原算法一致）
 *   on_duration  ：Δ = 开关(0/1) × min(Δt, 10) / 60    单位 min（第一条 Δt 按 0）
 *   两者都按 MAX_GAP_SEC=10 秒裁剪，避免设备离线间隙被当成一直在流/一直在加热。
 * 【配置】指标定义读 CUMULATIVE_METRICS（config/metrics.js）。
 */
const promisePool = require('../../config/dbPool')
const { CUMULATIVE_METRICS } = require('../../config/metrics')
const { resolveDeviceNo, resolveFieldAliases } = require('../../utils/mappedData')
const { firstValue } = require('../../utils/protocol')
const { calcBucketSeconds } = require('../../utils/timeRange')
const { formatLocalDateTime } = require('../../utils/helper')

const MAX_GAP_SEC = 10
const SNAPSHOT_TABLE = 't_cumulative_snapshot'

/** 懒建表：第一次用到时才建，失败后清缓存下次重试。 */
let ensurePromise = null
function ensureTable() {
  if (ensurePromise) return ensurePromise
  ensurePromise = promisePool.query(`CREATE TABLE IF NOT EXISTS ${SNAPSHOT_TABLE} (
    id BIGINT NOT NULL AUTO_INCREMENT,
    d_no VARCHAR(64) DEFAULT NULL,
    metric_key VARCHAR(64) NOT NULL,
    c_time DATETIME NOT NULL,
    cumulative_value DECIMAL(20,6) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_metric_time (metric_key, c_time),
    KEY idx_dno_metric_time (d_no, metric_key, c_time)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8`)
    .catch(err => { ensurePromise = null; throw err })
  return ensurePromise
}

/** 字段别名缓存（按 源表.槽位 缓存）：字段映射改了重启生效，与项目其它配置一致。 */
const aliasCache = new Map()
async function getAliases(table, field) {
  const key = `${table}.${field}`
  if (!aliasCache.has(key)) aliasCache.set(key, await resolveFieldAliases(table, field))
  return aliasCache.get(key)
}

/** 每个 (d_no|metric_key) 的运行态：最新累计值 + 上一条读数时间（毫秒）。 */
const state = new Map()
let restorePromise = null
/** 启动后第一次用到时，从快照表恢复每个 (设备,指标) 的最新累计值，避免重启后从 0 重新累加。 */
function restoreState() {
  if (!restorePromise) {
    restorePromise = (async () => {
      try {
        await ensureTable()
        const [rows] = await promisePool.query(
          `SELECT s.d_no, s.metric_key, s.cumulative_value, s.c_time
           FROM ${SNAPSHOT_TABLE} s
           JOIN (SELECT d_no, metric_key, MAX(id) AS max_id FROM ${SNAPSHOT_TABLE} GROUP BY d_no, metric_key) t
             ON s.id = t.max_id`
        )
        for (const row of rows) {
          const ts = row.c_time ? new Date(String(row.c_time).replace(' ', 'T')).getTime() : NaN
          state.set(`${row.d_no}|${row.metric_key}`, {
            value: Number(row.cumulative_value) || 0,
            cTimeMs: Number.isFinite(ts) ? ts : NaN,
          })
        }
      } catch (err) {
        restorePromise = null
        console.error('[CumulativeSnapshot] 恢复累计快照状态失败:', err.message)
      }
    })()
  }
  return restorePromise
}

/**
 * 落库后调用：按当前这条上报更新各累计指标的快照。
 * 只处理 enabled 且 aggregation 为 on_duration / flow_integral 的指标；报文里取不到该指标
 * 需要的字段时跳过（比如传感器与行为分开上报时，本处理器手里只有一方的字段）。
 * @param {Object} params
 * @param {string} [params.d_no]  设备编号（不传则按报文自动解析）
 * @param {Object} params.info    本轮上报报文
 * @param {number} params.cTimeMs 本条采集时间（毫秒）
 */
async function appendSnapshots({ d_no, info, cTimeMs }) {
  if (!Number.isFinite(cTimeMs)) return
  const deviceNo = d_no || await resolveDeviceNo(info)
  if (!deviceNo) return
  await ensureTable()
  await restoreState()

  const metrics = (CUMULATIVE_METRICS || []).filter(
    m => m.enabled && (m.aggregation === 'on_duration' || m.aggregation === 'flow_integral')
  )
  if (!metrics.length) return

  const cTime = info?.c_time || formatLocalDateTime(new Date(cTimeMs))
  const inserts = []

  for (const metric of metrics) {
    const aliases = await getAliases(metric.source_table, metric.source_field)
    const raw = firstValue(info, aliases)
    if (raw == null) continue

    const key = `${deviceNo}|${metric.metric_key}`
    const prev = state.get(key)
    const lastValue = prev ? prev.value : 0
    const lastMs = prev ? prev.cTimeMs : NaN

    let delta
    if (metric.aggregation === 'flow_integral') {
      const flow = Number(raw)
      if (!Number.isFinite(flow)) continue
      // 第一条读数没有“上一条”，按 1 秒算（跟 cumulativeService 的 COALESCE(dt_sec,1) 一致）
      const dt = Number.isFinite(lastMs) ? Math.min((cTimeMs - lastMs) / 1000, MAX_GAP_SEC) : 1
      delta = Math.max(flow, 0) / 60 * Math.max(0, dt)
    } else {
      const isOn = String(raw).trim() === '1' ? 1 : 0
      // 第一条读数没有“上一条”，按 0 算（跟原算法 COALESCE(...,0) 一致）
      const dt = Number.isFinite(lastMs) ? Math.min(Math.max((cTimeMs - lastMs) / 1000, 0), MAX_GAP_SEC) : 0
      delta = isOn * dt / 60
    }

    const value = lastValue + delta
    state.set(key, { value, cTimeMs })
    inserts.push([deviceNo, metric.metric_key, cTime, Number(value.toFixed(6))])
  }

  if (inserts.length) {
    await promisePool.query(
      `INSERT INTO ${SNAPSHOT_TABLE} (d_no, metric_key, c_time, cumulative_value) VALUES ?`,
      [inserts]
    )
  }
}

/**
 * 查询某个累计指标的快照序列（历史曲线 / 明细表用），返回的是“全量累计值在该时刻的读数”。
 * 传 startTime 时按等宽时间桶降采样，每桶取最新一行——累计值单调递增，桶内最后一行即该桶
 * 结束时的累计读数。走 (metric_key, c_time) 索引，不扫原始大表。
 * @returns {Array<{c_time, value, cumulative}>}
 */
async function querySnapshotSeries({ metric_key, d_no = null, limit = 300, startTime, endTime } = {}) {
  await ensureTable()
  const safeLimit = Math.min(2000, Math.max(1, Number.parseInt(limit, 10) || 300))
  const conditions = ['metric_key = ?']
  const params = [metric_key]
  if (d_no) { conditions.push('d_no = ?'); params.push(d_no) }
  if (startTime) { conditions.push('c_time >= ?'); params.push(startTime) }
  if (endTime) { conditions.push('c_time <= ?'); params.push(endTime) }
  const bucketSeconds = startTime ? calcBucketSeconds({ startTime, endTime, pointLimit: safeLimit }) : 1

  const sql = `
    SELECT c_time, cumulative AS value, cumulative
    FROM (
      SELECT
        c_time,
        ROUND(cumulative_value, 6) AS cumulative,
        ROW_NUMBER() OVER (PARTITION BY FLOOR(UNIX_TIMESTAMP(c_time) / ?) ORDER BY c_time DESC, id DESC) AS rn
      FROM ${SNAPSHOT_TABLE}
      WHERE ${conditions.join(' AND ')}
    ) AS bucketed
    WHERE rn = 1
    ORDER BY c_time ASC
    LIMIT ?
  `
  const [rows] = await promisePool.query(sql, [bucketSeconds, ...params, safeLimit])
  return rows
}

/**
 * 只取某个累计指标的最新快照值（首页「累计运行时长」用，避免全表扫描）。
 * @returns {number|null} 没有快照时返回 null，调用方回退到全表计算
 */
async function querySnapshotLatest({ metric_key, d_no = null } = {}) {
  await ensureTable()
  const conditions = ['metric_key = ?']
  const params = [metric_key]
  if (d_no) { conditions.push('d_no = ?'); params.push(d_no) }
  const [[row]] = await promisePool.query(
    `SELECT cumulative_value FROM ${SNAPSHOT_TABLE} WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT 1`,
    params
  )
  return row ? Number(row.cumulative_value) : null
}

/** 清空快照表（回填前调用，避免重复累加）。 */
async function truncateSnapshots() {
  await ensureTable()
  await promisePool.query(`TRUNCATE TABLE ${SNAPSHOT_TABLE}`)
  state.clear()
  restorePromise = null
}

module.exports = { SNAPSHOT_TABLE, ensureTable, appendSnapshots, querySnapshotSeries, querySnapshotLatest, truncateSnapshots }

