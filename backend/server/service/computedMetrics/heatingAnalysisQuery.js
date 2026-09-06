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
 * 【配置中心关联】COMPUTED_METRICS.heaterRatedPower / waterDensity / waterSpecificHeat、
 * SAFETY_INTERLOCK.abnormalMax，每次查询实时读取。
 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')
const { calcBucketSeconds } = require('../../utils/timeRange')

/** 采样间隔上限（秒），超出视为离线间隙——跟 heaterEnergyQuery.js / cumulativeService.js 一致。 */
const MAX_GAP_SEC = 10

function readParams() {
  const config = systemConfig.getConfig()
  const cm = config.COMPUTED_METRICS || {}
  const heaterRatedPower = Number(cm.heaterRatedPower) > 0 ? Number(cm.heaterRatedPower) : 0
  const waterDensity = Number(cm.waterDensity) > 0 ? Number(cm.waterDensity) : 1000
  const waterSpecificHeat = Number(cm.waterSpecificHeat) > 0 ? Number(cm.waterSpecificHeat) : 4200
  const abnRaw = Number(config.SAFETY_INTERLOCK?.abnormalMax)
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
 * + "这一刻或之前最近一条" t_behavior_data 的加热开关状态 heater_on（相关子查询，跟
 * heaterEnergyQuery.js 同一套：两张表 c_time 不保证精确对齐，取最近一次已知状态）。
 */
function baseRowsSql(abnormalMax, tw) {
  const num = (f) =>
    `CASE WHEN CAST(NULLIF(\`${f}\`, '') AS DECIMAL(20,6)) >= ${abnormalMax} ` +
    `THEN NULL ELSE CAST(NULLIF(\`${f}\`, '') AS DECIMAL(20,6)) END`
  return `
    SELECT
      s.id, s.c_time, s.temp1, s.temp2, s.flow,
      TIMESTAMPDIFF(SECOND, LAG(s.c_time) OVER (ORDER BY s.c_time ASC, s.id ASC), s.c_time) AS dt_sec,
      LAG(s.temp2)  OVER (ORDER BY s.c_time ASC, s.id ASC) AS prev_temp2,
      COALESCE((
        SELECT CASE WHEN TRIM(b.field2) = '1' THEN 1 ELSE 0 END
        FROM t_behavior_data b
        WHERE b.c_time <= s.c_time
        ORDER BY b.c_time DESC, b.id DESC
        LIMIT 1
      ), 0) AS heater_on
    FROM (
      SELECT id, c_time, ${num('field1')} AS temp1, ${num('field2')} AS temp2, ${num('field3')} AS flow
      FROM t_sensor_data
      WHERE 1=1 ${tw.clause}
    ) AS s
  `
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
      FROM ( ${baseRowsSql(abnormalMax, tw)} ) AS r
    ) AS calculated
    GROUP BY bucket
    HAVING actualRiseC IS NOT NULL OR theoreticalRiseC IS NOT NULL
    ORDER BY c_time ASC
    LIMIT ?
  `
  const [rows] = await promisePool.query(sql, [bucketSeconds, ...tw.params, safeLimit])
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
        FROM ( ${baseRowsSql(abnormalMax, tw)} ) AS r
      ) AS with_prev
    ) AS calculated
    GROUP BY bucket
    HAVING heatingRate IS NOT NULL
    ORDER BY c_time ASC
    LIMIT ?
  `
  const [rows] = await promisePool.query(sql, [bucketSeconds, ...tw.params, safeLimit])
  return rows
}

module.exports = { queryHeatingEfficiency, queryHeatingRate }
