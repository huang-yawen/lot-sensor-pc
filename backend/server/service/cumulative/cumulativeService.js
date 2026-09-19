/**
 * 累计指标查询服务
 *
 * 根据 systemConfig 中的 CUMULATIVE_METRICS 配置，使用 MySQL 窗口函数
 * 计算累计值或累计平均值。
 *
 * 【页面/接口】
 *   · 历史图表页 →「累计统计」合并图 /「累计流量」图 /「累计运行时长」图，接口 GET /api/cumulative
 *     配置见 config/metrics.js 的 CUMULATIVE_METRICS（mode 决定进图表页还是内联进表格）。
 *   · 首页「累计流量」卡片的总量：routes/sensorRoutes.js 里调本文件的 queryFlowIntegralTotal()。
 *     ⚠ 跟历史图表页是"同一套增量算法、不同统计范围"，别误以为是同一个数：
 *         · 首页不传 startTime → 从库里第一条数据累计到现在的【全量总量】（工业累计器语义，
 *           后端重启不归零）。实测库里是 3600 L 量级。
 *         · 历史图表页会带上所选时间范围 → 只累加范围内的数据，且从范围起点从 0 开始累加。
 *       所以首页卡片的值 ≠ 历史图表页曲线的最后一个点（除非所选范围覆盖了全部历史）。
 *       这是刻意设计：首页要的是"这块水表总共走了多少"，图表页要的是"这段区间内走了多少"。
 *   · 传感器/行为表格的内联列：service/tableData/getTableData.js 调 buildCumulativeSelect()。
 *
 * 支持的聚合方式（metric.aggregation）：
 *   - sum：累加（流量、功耗等连续量，默认）
 *   - avg：累计平均（从第一条数据开始逐点求平均）
 *   - on_duration：开关状态"持续时长"累计（字段值为 '1' 期间经过的实际时间，
 *     单位分钟）。走独立的 querySingleOnDurationCumulative，不复用 aggregationSql。
 *   - flow_integral：源字段是"每分钟速率量"（如瞬时流量 L/min）时用这个。直接 SUM(原始值)
 *     对速率量没有物理意义，必须先乘以每条读数代表的时间跨度再累加：本条增量 = 值/60 ×
 *     min(与上一条的秒差, MAX_GAP_SEC)。走独立的 querySingleFlowIntegralCumulative。
 */
const promisePool = require('../../config/dbPool')
const { CUMULATIVE_METRICS } = require('../../config/metrics')
const { calcBucketSeconds } = require('../../utils/timeRange')
const { querySnapshotSeries } = require('./cumulativeSnapshotService')

// 相邻两条读数的秒差上限：超过视为设备离线间隙，积分时只按上限计，避免离线期间
// 被当成一直在流。跟 querySingleOnDurationCumulative 的 MAX_GAP_SEC、首页
// computedMetrics.js 里 Math.min(10, ...) 的 clamp 保持一致。
const MAX_GAP_SEC = 10

/**
 * 获取所有已启用的累计指标配置
 * @returns {Array} 已启用指标配置数组
 */
function getEnabledCumulativeMetrics() {
  const metrics = CUMULATIVE_METRICS || []
  return metrics.filter(m => m.enabled)
}

/**
 * 根据指标配置生成累计/累计平均的窗口函数 SQL 片段。
 * metric.aggregation 为 avg 时使用 AVG(...) OVER(...)，否则默认 SUM(...) OVER(...)。
 * 两种方式都从第一条数据开始、按时间顺序逐行滚动计算，保证“累计”语义一致。
 * 注意：on_duration 聚合方式不走这个函数，见 querySingleOnDurationCumulative。
 */
function aggregationSql(metric) {
  const value = `CAST(NULLIF(\`${metric.source_field}\`, '') AS DECIMAL(20,6))`
  const aggregation = metric.aggregation === 'avg' ? 'AVG' : 'SUM'
  return `${aggregation}(${value}) OVER (ORDER BY c_time ASC, id ASC ROWS UNBOUNDED PRECEDING)`
}

/**
 * 单指标查询：根据一条 metric 配置生成并执行累计查询
 * @param {Object} metric     - 单条 CUMULATIVE_METRICS 配置
 * @param {Object} [options]  - 可选参数
 * @param {string} [options.d_no]     - 设备编号过滤
 * @param {number} [options.limit=300] - 返回最近 N 条
 * @param {string} [options.startTime] - 时间范围起点（含），历史图表页面的时间选择器传入
 * @param {string} [options.endTime]   - 时间范围终点（含），不传表示到当前时刻
 * @returns {Array<{c_time, value, cumulative}>}
 */
async function querySingleCumulative(metric, options = {}) {
  // on_duration / flow_integral 两类优先读累计快照表（预计算，避免每次在原始大表上跑窗口函数
  // 全表扫描）；快照还没数据（未回填 / 刚部署）时回退到下面的实时计算，页面不会空白。
  if (metric.aggregation === 'on_duration' || metric.aggregation === 'flow_integral') {
    const { d_no, limit, startTime, endTime } = options
    try {
      const snapshot = await querySnapshotSeries({ metric_key: metric.metric_key, d_no, limit, startTime, endTime })
      if (snapshot.length) return snapshot
    } catch (err) {
      console.error(`[CumulativeService] 读取 ${metric.metric_key} 累计快照失败，回退实时计算:`, err.message)
    }
    return metric.aggregation === 'on_duration'
      ? querySingleOnDurationCumulative(metric, options)
      : querySingleFlowIntegralCumulative(metric, options)
  }

  const { d_no, limit = 300, startTime, endTime } = options
  const table = metric.source_table
  const field = metric.source_field
  const precision = metric.precision ?? 2

  // 统一对数值型字段做 CAST 防止空串报错
  const valueExpr = `CAST(NULLIF(\`${field}\`, '') AS DECIMAL(20,6))`

  const safeLimit = Math.min(2000, Math.max(1, Number.parseInt(limit, 10) || 300))
  const conditions = []
  const subParams = []
  if (d_no) { conditions.push('d_no = ?'); subParams.push(d_no) }
  // 时间范围过滤必须放在窗口函数计算“累计值”之前（即下面最内层查询的 WHERE），
  // 否则窗口函数会扫到范围外的历史行，导致“累计”变成“从有数据以来的全部总和”，
  // 而不是所选时间范围内的累计——这是历史图表页面时间选择器要求的正确性前提。
  if (startTime) { conditions.push('c_time >= ?'); subParams.push(startTime) }
  if (endTime) { conditions.push('c_time <= ?'); subParams.push(endTime) }
  const whereExtra = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  // 累计值必须先在全部原始数据上逐行精确计算（窗口函数不能先分桶再算，否则语义错误：
  // 分桶后的“累计”会变成对已经丢失中间行的近似值累加，跟真实累计对不上），算好之后
  // 再按时间等宽分桶降采样，每桶只保留时间最新的一行——因为累计值单调递增，最能代表
  // 这段时间结束时的读数。SQL 里 ? 的物理出现顺序：FLOOR(...) 里的桶宽度最先出现
  // （calculated 的 SELECT 列表在文本上先于它 FROM 的子查询展开），然后是 WHERE 条件，
  // 最后是外层 LIMIT。
  const bucketSeconds = startTime ? calcBucketSeconds({ startTime, endTime, pointLimit: safeLimit }) : 1
  const params = [bucketSeconds, ...subParams, safeLimit]

  const sql = `
    SELECT c_time, value, cumulative
    FROM (
      SELECT
        c_time, value, cumulative,
        ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY c_time DESC, id DESC) AS rn
      FROM (
        SELECT
          id,
          c_time,
          FLOOR(UNIX_TIMESTAMP(c_time) / ?) AS bucket,
          ROUND(${valueExpr}, ${precision}) AS value,
          ROUND(${aggregationSql(metric)}, ${precision}) AS cumulative
        FROM ${table}
        WHERE 1=1 ${whereExtra}
      ) AS calculated
    ) AS bucketed
    WHERE rn = 1
    ORDER BY c_time ASC
    LIMIT ?
  `

  const [rows] = await promisePool.query(sql, params)
  return rows
}

/**
 * “开关状态持续时长累计”专用查询（aggregation === 'on_duration'）。
 *
 * 与 sum/avg 统计的是字段数值本身不同，这里统计的是开关字段处于“开启”（值为 '1'）
 * 状态期间，实际经过的时间（分钟）。实测本项目 t_behavior_data 正常上报间隔约 1 秒，
 * 故用 LAG() 取每行与上一行的时间差，超过 MAX_GAP_SEC（10 秒，即离线间隙）的部分
 * 不计入累计，避免设备离线期间被错误地算作“开启时长”。
 *
 * MySQL 不允许窗口函数直接嵌套在另一个窗口函数的参数里，所以必须先在内层子查询里
 * 用 LAG() 把逐行时间差落地成普通列，再在外层用 SUM() OVER() 做累计滚动求和。
 *
 * 仅支持 mode: 'standalone'（独立查询），不支持内嵌到传感器/行为历史表格（inline）。
 */
async function querySingleOnDurationCumulative(metric, options = {}) {
  const { d_no, limit = 300, startTime, endTime } = options
  const table = metric.source_table
  const field = metric.source_field
  const precision = metric.precision ?? 2
  const MAX_GAP_SEC = 10 // 单次采样间隔上限（秒），超出视为离线间隙，不计入累计时长

  const safeLimit = Math.min(2000, Math.max(1, Number.parseInt(limit, 10) || 300))
  const conditions = []
  const subParams = []
  if (d_no) { conditions.push('d_no = ?'); subParams.push(d_no) }
  if (startTime) { conditions.push('c_time >= ?'); subParams.push(startTime) }
  if (endTime) { conditions.push('c_time <= ?'); subParams.push(endTime) }
  const whereExtra = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  // 同 querySingleCumulative：先精确算出逐行累计时长，再按时间分桶，每桶取最新一行。
  // SQL 里 ? 的物理出现顺序：FLOOR(...) 的桶宽度（calculated 的 SELECT 列表）最先出现，
  // 然后是 with_dt 内层的 WHERE 条件，最后是外层 LIMIT。
  const bucketSeconds = startTime ? calcBucketSeconds({ startTime, endTime, pointLimit: safeLimit }) : 1
  const params = [bucketSeconds, ...subParams, safeLimit]

  const sql = `
    SELECT c_time, value, cumulative
    FROM (
      SELECT
        c_time, value, cumulative,
        ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY c_time DESC, id DESC) AS rn
      FROM (
        SELECT
          id, c_time,
          FLOOR(UNIX_TIMESTAMP(c_time) / ?) AS bucket,
          is_on AS value,
          ROUND(
            SUM(COALESCE(is_on * LEAST(dt_sec, ${MAX_GAP_SEC}), 0))
              OVER (ORDER BY c_time ASC, id ASC ROWS UNBOUNDED PRECEDING) / 60,
            ${precision}
          ) AS cumulative
        FROM (
          SELECT
            id,
            c_time,
            CASE WHEN TRIM(\`${field}\`) = '1' THEN 1 ELSE 0 END AS is_on,
            TIMESTAMPDIFF(SECOND, LAG(c_time) OVER (ORDER BY c_time ASC, id ASC), c_time) AS dt_sec
          FROM ${table}
          WHERE 1=1 ${whereExtra}
        ) AS with_dt
      ) AS calculated
    ) AS bucketed
    WHERE rn = 1
    ORDER BY c_time ASC
    LIMIT ?
  `

  const [rows] = await promisePool.query(sql, params)
  return rows
}

/**
 * 批量查询：为所有已启用的累计指标分别执行查询
 * @param {Object} [options] - 见 querySingleCumulative
 * @returns {Object} { cumulative_flow: [...], cumulative_heat_time: [...], ... }
 */
async function queryAllCumulative(options = {}) {
  const metrics = getEnabledCumulativeMetrics()
  if (metrics.length === 0) return {}

  const results = {}
  await Promise.all(metrics.map(async (metric) => {
    try {
      results[metric.metric_key] = await querySingleCumulative(metric, options)
    } catch (err) {
      console.error(`[CumulativeService] 查询 ${metric.metric_key} 失败:`, err.message)
      results[metric.metric_key] = []
    }
  }))
  return results
}

/**
 * "瞬时速率字段按时间积分"的累计查询（aggregation === 'flow_integral'）。
 *
 * 用于源字段是"每分钟速率量"的指标（如瞬时流量 L/min）。本条增量(单位=源字段积分后的量，
 * 如 L) = 值/60 × min(与上一条的秒差, MAX_GAP_SEC)，再逐行滚动累加。
 * 结构同 querySingleOnDurationCumulative：先在全量数据上用 LAG() 落地逐行秒差，再用
 * SUM() OVER() 精确算累计，最后按时间分桶降采样、每桶取最新一行。
 * value 列返回原始瞬时读数（供曲线悬浮查看），cumulative 才是积分累计值。
 */
async function querySingleFlowIntegralCumulative(metric, options = {}) {
  const { d_no, limit = 300, startTime, endTime } = options
  const table = metric.source_table
  const field = metric.source_field
  const precision = metric.precision ?? 2

  const safeLimit = Math.min(2000, Math.max(1, Number.parseInt(limit, 10) || 300))
  const conditions = []
  const subParams = []
  if (d_no) { conditions.push('d_no = ?'); subParams.push(d_no) }
  if (startTime) { conditions.push('c_time >= ?'); subParams.push(startTime) }
  if (endTime) { conditions.push('c_time <= ?'); subParams.push(endTime) }
  const whereExtra = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  const bucketSeconds = startTime ? calcBucketSeconds({ startTime, endTime, pointLimit: safeLimit }) : 1
  const params = [bucketSeconds, ...subParams, safeLimit]

  const sql = `
    SELECT c_time, value, cumulative
    FROM (
      SELECT
        c_time, value, cumulative,
        ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY c_time DESC, id DESC) AS rn
      FROM (
        SELECT
          id, c_time,
          FLOOR(UNIX_TIMESTAMP(c_time) / ?) AS bucket,
          ROUND(v, ${precision}) AS value,
          ROUND(
            SUM(GREATEST(COALESCE(v, 0), 0) / 60 * LEAST(COALESCE(dt_sec, 1), ${MAX_GAP_SEC}))
              OVER (ORDER BY c_time ASC, id ASC ROWS UNBOUNDED PRECEDING),
            ${precision}
          ) AS cumulative
        FROM (
          SELECT
            id,
            c_time,
            CAST(NULLIF(\`${field}\`, '') AS DECIMAL(20,6)) AS v,
            TIMESTAMPDIFF(SECOND, LAG(c_time) OVER (ORDER BY c_time ASC, id ASC), c_time) AS dt_sec
          FROM ${table}
          WHERE 1=1 ${whereExtra}
        ) AS with_dt
      ) AS calculated
    ) AS bucketed
    WHERE rn = 1
    ORDER BY c_time ASC
    LIMIT ?
  `
  const [rows] = await promisePool.query(sql, params)
  return rows
}

/**
 * flow_integral 的"积分累计总量"标量查询：不分桶、不 LIMIT，直接返回一个数。
 * 首页"累计流量"板块用它，跟历史图表页面 flow_integral 曲线同一套算法、同一个口径。
 * 不传 startTime 即"从第一条数据起的全量总量"（工业累计总量 / 累计器语义），且天然
 * 持久——后端重启也不会归零，因为是从数据库现算的。
 */
async function queryFlowIntegralTotal({ source_table, source_field, d_no = null, startTime = null, endTime = null, precision = 2 } = {}) {
  const p = Number.isInteger(precision) ? precision : 2
  const conditions = []
  const params = []
  if (d_no) { conditions.push('d_no = ?'); params.push(d_no) }
  if (startTime) { conditions.push('c_time >= ?'); params.push(startTime) }
  if (endTime) { conditions.push('c_time <= ?'); params.push(endTime) }
  const whereExtra = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  const sql = `
    SELECT ROUND(SUM(GREATEST(COALESCE(v, 0), 0) / 60 * LEAST(COALESCE(dt_sec, 1), ${MAX_GAP_SEC})), ${p}) AS total
    FROM (
      SELECT
        CAST(NULLIF(\`${source_field}\`, '') AS DECIMAL(20,6)) AS v,
        TIMESTAMPDIFF(SECOND, LAG(c_time) OVER (ORDER BY c_time ASC, id ASC), c_time) AS dt_sec
      FROM ${source_table}
      WHERE 1=1 ${whereExtra}
    ) AS with_dt
  `
  const [[row]] = await promisePool.query(sql, params)
  return row && row.total != null ? Number(row.total) : 0
}

/**
 * 为历史查询注入累计列 SQL 片段
 * 适用于 mode 为 "inline" 或 "both" 的情况。
 *
 * 返回 { selectFragment, metrics }，调用方拼入主查询的 SELECT 列表中。
 * selectFragment 示例：
 *   ROUND(SUM(CAST(NULLIF(field3,'') AS DECIMAL(20,6)))
 *     OVER (ORDER BY c_time ROWS UNBOUNDED PRECEDING), 2) AS `累计流量`
 *
 * 注意：此函数只生成 SQL 片段，不单独执行查询；窗口函数依赖完整结果集，
 * 由外层 ORDER BY c_time DESC 时需主查自行处理子查询包裹。
 * on_duration 聚合方式暂不支持 inline（其 SQL 需要额外子查询层，无法内联成单个片段）。
 *
 * @returns {{ selectFragment: string, metrics: Array }}
 */
function buildInlineCumulativeSql(sourceTable) {
  const metrics = getEnabledCumulativeMetrics()
    .filter(m => (m.mode === 'inline' || m.mode === 'both') && (!sourceTable || m.source_table === sourceTable) && m.aggregation !== 'on_duration' && m.aggregation !== 'flow_integral')

  if (metrics.length === 0) return { selectFragment: '', metrics: [] }

  const fragments = metrics.map(m => {
    const alias = String(m.metric_name).replace(/`/g, '``')
    return `ROUND(${aggregationSql(m)}, ${m.precision ?? 2}) AS \`${alias}\``
  })

  return { selectFragment: `, ${fragments.join(', ')}`, metrics }
}

module.exports = {
  getEnabledCumulativeMetrics,
  querySingleCumulative,
  queryAllCumulative,
  buildInlineCumulativeSql,
  queryFlowIntegralTotal,
}
