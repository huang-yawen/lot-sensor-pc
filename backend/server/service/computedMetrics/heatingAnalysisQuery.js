/**
 * 【文件职责】"加热效率 / 加热速度"历史图表查询（供历史图表页面的"加热效率与加热速度"一节）。
 *
 * 加热效率 = 实际升温ΔT ÷ 理论升温ΔT × 100%（单位 %）
 *   实际升温ΔT_实 = 出水温度 − 进水温度                       （℃）
 *   理论升温ΔT_理 = P_额定 / (ρ · Cp · Q)                      （℃）
 *                   ——加热器额定电功率如果全部进入当前流量 Q 的水里，能把水升多少度
 *   Q = 流量(L/min) / 60 / 1000                                （m³/s）
 *   ρ 介质密度 kg/m³，Cp 比热容 J/(kg·℃)，P_额定 加热额定电功率 W
 *   只在"加热开启 + 有流量 + 有进/出水温度 + 额定功率>0"的行计算。
 *   数值上等于换热效率 η（(温差·ρ·Cp·Q)/P_额定），这里换成温度域的直观表达：
 *   实际升温 vs 理论升温 两条 ℃ 曲线，两者的差距就是损失。
 *
 * 加热速度 = 加热开启时出水温度的升温速率（单位 ℃/min）
 *   rate = (本行出水温度 − 上一行出水温度) / (Δt_秒 / 60)
 *   只在"本行和上一行都在加热"时计算（避开加热刚开启那一跳），Δt 上限 MAX_GAP_SEC
 *   （超过视为离线间隙，不计入）。
 *
 * 跟 heaterEnergyQuery.js 是同一类"专用查询"：都要用到 t_behavior_data 的加热开关状态、
 * 配置中心的额定功率/介质物性参数——通用公式引擎（只认单行 t_sensor_data 字段）算不出。
 * 跟历史图表页其它接口一样不按设备号过滤（页面本身没有设备选择器）。
 *
 * 【配置】COMPUTED_METRICS.heaterRatedPower / waterDensity / waterSpecificHeat、
 * SAFETY_INTERLOCK.abnormalMax，每次查询实时读取。
 */
const promisePool = require('../../config/dbPool')
const { COMPUTED_METRICS } = require('../../config/metrics')
const SAFETY_CONFIG = require('../safety/config')
const { calcBucketSeconds } = require('../../utils/timeRange')

/** 采样间隔上限（秒），超出视为离线间隙——跟 heaterEnergyQuery.js / cumulativeService.js 一致。 */
const MAX_GAP_SEC = 10

function readParams() {
  const cm = COMPUTED_METRICS || {}
  const heaterRatedPower = Number(cm.heaterRatedPower) > 0 ? Number(cm.heaterRatedPower) : 0
  const waterDensity = Number(cm.waterDensity) > 0 ? Number(cm.waterDensity) : 1000
  const waterSpecificHeat = Number(cm.waterSpecificHeat) > 0 ? Number(cm.waterSpecificHeat) : 4200
  const abnRaw = Number(SAFETY_CONFIG.abnormalMax)
  const abnormalMax = Number.isFinite(abnRaw) && abnRaw > 0 ? abnRaw : 9999
  return { heaterRatedPower, waterDensity, waterSpecificHeat, abnormalMax }
}

/** 时间范围条件 + 参数（供两个查询共用）。 */
function timeWhere(startTime, endTime) {
  const parts = []
  const params = []
  if (startTime) { parts.push('c_time >= ?'); params.push(startTime) }
  if (endTime) { parts.push('c_time <= ?'); params.push(endTime) }
  return { clause: parts.length ? `AND ${parts.join(' AND ')}` : '', params }
}

/**
 * 每行：过滤哨兵异常值后的温度/流量 + 与上一行的秒差 dt_sec + 上一行出水温度 prev_temp2
 * + "这一刻或之前最近一条" t_behavior_data 的加热开关状态 heater_on（跟 heaterEnergyQuery.js
 * 同一套：两张表 c_time 不保证精确对齐，取最近一次已知状态）。
 *
 * 状态用"事件流 + 前向填充"取，不用每行一次相关子查询——理由见 heaterEnergyQuery.js
 * 文件头 ②：相关子查询的边界依赖外层列，进不了索引 range，是平方级开销。
 * 因为要带绑定参数，这里返回 { sql, params }，调用方把 params 按文本顺序拼进去。
 */
function baseRowsSql(abnormalMax, tw, startTime, endTime) {
  const num = (f) =>
    `CASE WHEN CAST(NULLIF(\`${f}\`, '') AS DECIMAL(20,6)) >= ${abnormalMax} ` +
    `THEN NULL ELSE CAST(NULLIF(\`${f}\`, '') AS DECIMAL(20,6)) END`

  // 行为记录只取窗口内的状态变化点，窗口之前的由 seed 行代表（边界是常量，走索引 range + LIMIT 1）
  const behaviorParts = []
  const behaviorParams = []
  if (startTime) { behaviorParts.push('c_time >= ?'); behaviorParams.push(startTime) }
  if (endTime) { behaviorParts.push('c_time <= ?'); behaviorParams.push(endTime) }
  const behaviorWhere = behaviorParts.length ? `AND ${behaviorParts.join(' AND ')}` : ''

  const seedParams = []
  let seedTimeSql = `CAST('1000-01-01 00:00:00' AS DATETIME)`
  let seedStateSql = '0'
  if (startTime) {
    seedTimeSql = 'CAST(? AS DATETIME)'
    seedParams.push(startTime)
    seedStateSql = `COALESCE((
            SELECT CASE WHEN TRIM(b.field2) = '1' THEN 1 ELSE 0 END
            FROM t_behavior_data b
            WHERE b.c_time < ?
            ORDER BY b.c_time DESC, b.id DESC
            LIMIT 1
          ), 0)`
    seedParams.push(startTime)
  }

  const sql = `
    SELECT
      id, c_time, temp1, temp2, flow, heater_on,
      TIMESTAMPDIFF(SECOND, LAG(c_time) OVER (ORDER BY c_time ASC, id ASC), c_time) AS dt_sec,
      LAG(temp2)  OVER (ORDER BY c_time ASC, id ASC) AS prev_temp2
    FROM (
      SELECT
        kind, id, c_time, temp1, temp2, flow,
        -- 一个 grp 里只有开头那行（行为记录或 seed）带状态，MAX 取到的就是这组的状态
        MAX(st) OVER (PARTITION BY grp) AS heater_on
      FROM (
        SELECT
          kind, id, c_time, temp1, temp2, flow, st,
          -- 每遇到一条带状态的行就开一个新组，后面的传感器行都归进这一组
          SUM(CASE WHEN st IS NOT NULL THEN 1 ELSE 0 END)
            OVER (ORDER BY c_time ASC, pri ASC, id ASC ROWS UNBOUNDED PRECEDING) AS grp
        FROM (
          -- pri 让同一时刻的行为记录排在传感器行之前，等价于原来 b.c_time <= s.c_time 的"含等于"
          SELECT
            'seed' AS kind, -1 AS pri, 0 AS id, ${seedTimeSql} AS c_time,
            CAST(NULL AS DECIMAL(20,6)) AS temp1,
            CAST(NULL AS DECIMAL(20,6)) AS temp2,
            CAST(NULL AS DECIMAL(20,6)) AS flow,
            ${seedStateSql} AS st
          UNION ALL
          SELECT
            'b', 0, id, c_time,
            CAST(NULL AS DECIMAL(20,6)), CAST(NULL AS DECIMAL(20,6)), CAST(NULL AS DECIMAL(20,6)),
            CASE WHEN TRIM(field2) = '1' THEN 1 ELSE 0 END
          FROM t_behavior_data
          WHERE 1=1 ${behaviorWhere}
          UNION ALL
          SELECT 's', 1, id, c_time, temp1, temp2, flow, NULL
          FROM (
            SELECT id, c_time, ${num('field1')} AS temp1, ${num('field2')} AS temp2, ${num('field3')} AS flow
            FROM t_sensor_data
            WHERE 1=1 ${tw.clause}
          ) AS s
        ) AS events
      ) AS grouped
    ) AS filled
    -- WHERE 先于窗口函数求值，所以上面的 dt_sec / prev_temp2 只在传感器行之间算，跟原来一致
    WHERE kind = 's'
  `
  return { sql, params: [...seedParams, ...behaviorParams, ...tw.params] }
}

/**
 * 加热效率历史：每桶取实际升温、理论升温、效率(%) 的桶内平均。
 * @returns {Array<{c_time, actualRiseC, theoreticalRiseC, efficiencyPct}>}
 */
async function queryHeatingEfficiency({ limit = 300, startTime, endTime } = {}) {
  const safeLimit = Math.min(2000, Math.max(1, Number.parseInt(limit, 10) || 300))
  const { heaterRatedPower, waterDensity, waterSpecificHeat, abnormalMax } = readParams()
  const tw = timeWhere(startTime, endTime)
  const bucketSeconds = startTime ? calcBucketSeconds({ startTime, endTime, pointLimit: safeLimit }) : 1

  // ρ·Cp·Q（W/℃）：Q 由 L/min → m³/s。理论升温 = P_额定 ÷ (ρ·Cp·Q)。
  const rhoCpQ = `(${waterDensity} * ${waterSpecificHeat} * (flow / 60 / 1000))`
  const canEff = `heater_on = 1 AND flow > 0 AND ${heaterRatedPower} > 0`
  const base = baseRowsSql(abnormalMax, tw, startTime, endTime)

  const sql = `
    SELECT
      MIN(c_time) AS c_time,
      ROUND(AVG(actual_rise), 3)      AS actualRiseC,
      ROUND(AVG(theoretical_rise), 3) AS theoreticalRiseC,
      ROUND(AVG(eff_pct), 2)          AS efficiencyPct
    FROM (
      SELECT
        c_time,
        FLOOR(UNIX_TIMESTAMP(c_time) / ?) AS bucket,
        CASE WHEN ${canEff} AND temp1 IS NOT NULL AND temp2 IS NOT NULL
             THEN (temp2 - temp1) ELSE NULL END AS actual_rise,
        CASE WHEN ${canEff}
             THEN ${heaterRatedPower} / NULLIF(${rhoCpQ}, 0) ELSE NULL END AS theoretical_rise,
        CASE WHEN ${canEff} AND temp1 IS NOT NULL AND temp2 IS NOT NULL
             THEN (temp2 - temp1) / NULLIF(${heaterRatedPower} / NULLIF(${rhoCpQ}, 0), 0) * 100
             ELSE NULL END AS eff_pct
      FROM ( ${base.sql} ) AS r
    ) AS calculated
    GROUP BY bucket
    HAVING actualRiseC IS NOT NULL OR theoreticalRiseC IS NOT NULL
    ORDER BY c_time ASC
    LIMIT ?
  `
  const [rows] = await promisePool.query(sql, [bucketSeconds, ...base.params, safeLimit])
  return rows
}

/**
 * 加热速度历史：每桶取"加热时出水升温速率(℃/min)"的桶内平均；整桶没加热则不出点。
 * @returns {Array<{c_time, heatingRate}>}
 */
async function queryHeatingRate({ limit = 300, startTime, endTime } = {}) {
  const safeLimit = Math.min(2000, Math.max(1, Number.parseInt(limit, 10) || 300))
  const { abnormalMax } = readParams()
  const tw = timeWhere(startTime, endTime)
  const bucketSeconds = startTime ? calcBucketSeconds({ startTime, endTime, pointLimit: safeLimit }) : 1
  const base = baseRowsSql(abnormalMax, tw, startTime, endTime)

  const sql = `
    SELECT
      MIN(c_time) AS c_time,
      ROUND(AVG(rate_c_per_min), 3) AS heatingRate
    FROM (
      SELECT
        c_time,
        FLOOR(UNIX_TIMESTAMP(c_time) / ?) AS bucket,
        CASE WHEN heater_on = 1 AND prev_heater_on = 1
                  AND temp2 IS NOT NULL AND prev_temp2 IS NOT NULL
                  AND dt_sec IS NOT NULL AND dt_sec > 0 AND dt_sec <= ${MAX_GAP_SEC}
             THEN (temp2 - prev_temp2) / (dt_sec / 60)
             ELSE NULL END AS rate_c_per_min
      FROM (
        SELECT r.*, LAG(r.heater_on) OVER (ORDER BY r.c_time ASC, r.id ASC) AS prev_heater_on
        FROM ( ${base.sql} ) AS r
      ) AS with_prev
    ) AS calculated
    GROUP BY bucket
    HAVING heatingRate IS NOT NULL
    ORDER BY c_time ASC
    LIMIT ?
  `
  const [rows] = await promisePool.query(sql, [bucketSeconds, ...base.params, safeLimit])
  return rows
}

/**
 * 换热效率历史：η = (ρ·Cp·Q·max(0,出水−进水)) / P_额定 × 100%。
 * 跟 heatingEfficiency（加热效率，有向 ΔT）的区别只在 ΔT 取 max(0, ΔT)（非负），
 * 数值上当出水温度高于进水时两者相等；换热效率强调"水实际带走的热功率占比"。
 * 只在加热开启 + 有流量 + 有进出水温度 + 额定功率>0 的行计算。每桶取换热功率(W)
 * 与效率(%)的桶内平均。
 * @returns {Array<{c_time, heatTransferredW, efficiencyPct}>}
 */
async function queryHeatExchangeEfficiency({ limit = 300, startTime, endTime } = {}) {
  const safeLimit = Math.min(2000, Math.max(1, Number.parseInt(limit, 10) || 300))
  const { heaterRatedPower, waterDensity, waterSpecificHeat, abnormalMax } = readParams()
  const tw = timeWhere(startTime, endTime)
  const bucketSeconds = startTime ? calcBucketSeconds({ startTime, endTime, pointLimit: safeLimit }) : 1

  // 水每秒带走的热功率 ρ·Cp·Q·max(0,ΔT)，单位 W；效率 = 该功率 ÷ 额定功率 ×100%。
  const heatTransferredW = `${waterDensity} * ${waterSpecificHeat} * (flow / 60 / 1000) * GREATEST(temp2 - temp1, 0)`
  const canEff = `heater_on = 1 AND flow > 0 AND ${heaterRatedPower} > 0`
  const base = baseRowsSql(abnormalMax, tw, startTime, endTime)

  const sql = `
    SELECT
      MIN(c_time) AS c_time,
      ROUND(AVG(heat_w), 2) AS heatTransferredW,
      ROUND(AVG(eff_pct), 2) AS efficiencyPct
    FROM (
      SELECT
        c_time,
        FLOOR(UNIX_TIMESTAMP(c_time) / ?) AS bucket,
        CASE WHEN ${canEff} AND temp1 IS NOT NULL AND temp2 IS NOT NULL
             THEN ${heatTransferredW} ELSE NULL END AS heat_w,
        CASE WHEN ${canEff} AND temp1 IS NOT NULL AND temp2 IS NOT NULL
             THEN ${heatTransferredW} / ${heaterRatedPower} * 100 ELSE NULL END AS eff_pct
      FROM ( ${base.sql} ) AS r
    ) AS calculated
    GROUP BY bucket
    HAVING heatTransferredW IS NOT NULL OR efficiencyPct IS NOT NULL
    ORDER BY c_time ASC
    LIMIT ?
  `
  const [rows] = await promisePool.query(sql, [bucketSeconds, ...base.params, safeLimit])
  return rows
}

/**
 * 温度变化率历史：进水/出水温度各自的 dT/dt（℃/min），相邻两条读数之差 ÷ 时间差，
 * 不依赖加热状态（每条读数都算）。Δt 上限 MAX_GAP_SEC，超出视为离线间隙不计入，
 * 避免断线期间两条读数之间隔着几分钟却算出"巨大变化率"。每桶取进水/出水变化率的桶内平均。
 * @returns {Array<{c_time, temp1Rate, temp2Rate}>}
 */
async function queryTempChangeRate({ limit = 300, startTime, endTime } = {}) {
  const safeLimit = Math.min(2000, Math.max(1, Number.parseInt(limit, 10) || 300))
  const { abnormalMax } = readParams()
  const tw = timeWhere(startTime, endTime)
  const bucketSeconds = startTime ? calcBucketSeconds({ startTime, endTime, pointLimit: safeLimit }) : 1
  const num = (f) =>
    `CASE WHEN CAST(NULLIF(\`${f}\`, '') AS DECIMAL(20,6)) >= ${abnormalMax} ` +
    `THEN NULL ELSE CAST(NULLIF(\`${f}\`, '') AS DECIMAL(20,6)) END`

  const sql = `
    SELECT
      MIN(c_time) AS c_time,
      ROUND(AVG(temp1_rate), 3) AS temp1Rate,
      ROUND(AVG(temp2_rate), 3) AS temp2Rate
    FROM (
      SELECT
        c_time,
        FLOOR(UNIX_TIMESTAMP(c_time) / ?) AS bucket,
        CASE WHEN dt_sec IS NOT NULL AND dt_sec > 0 AND dt_sec <= ${MAX_GAP_SEC}
                   AND temp1 IS NOT NULL AND prev_temp1 IS NOT NULL
             THEN (temp1 - prev_temp1) / (dt_sec / 60) ELSE NULL END AS temp1_rate,
        CASE WHEN dt_sec IS NOT NULL AND dt_sec > 0 AND dt_sec <= ${MAX_GAP_SEC}
                   AND temp2 IS NOT NULL AND prev_temp2 IS NOT NULL
             THEN (temp2 - prev_temp2) / (dt_sec / 60) ELSE NULL END AS temp2_rate
      FROM (
        SELECT
          id, c_time, temp1, temp2,
          TIMESTAMPDIFF(SECOND, LAG(c_time) OVER (ORDER BY c_time ASC, id ASC), c_time) AS dt_sec,
          LAG(temp1) OVER (ORDER BY c_time ASC, id ASC) AS prev_temp1,
          LAG(temp2) OVER (ORDER BY c_time ASC, id ASC) AS prev_temp2
        FROM (
          SELECT id, c_time, ${num('field1')} AS temp1, ${num('field2')} AS temp2
          FROM t_sensor_data
          WHERE 1=1 ${tw.clause}
        ) AS s
      ) AS with_prev
    ) AS calculated
    GROUP BY bucket
    HAVING temp1Rate IS NOT NULL OR temp2Rate IS NOT NULL
    ORDER BY c_time ASC
    LIMIT ?
  `
  const [rows] = await promisePool.query(sql, [bucketSeconds, ...tw.params, safeLimit])
  return rows
}

module.exports = { queryHeatingEfficiency, queryHeatingRate, queryHeatExchangeEfficiency, queryTempChangeRate }
