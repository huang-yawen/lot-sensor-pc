/**
 * 【文件职责】加热能耗分析历史查询：瞬时实际加热功率、累计耗电量、累计换热量、
 * 单位流量能耗（比能耗 SEC）——四个跟"加热到底花了多少电、换来多少热"相关的
 * 工程指标，供历史图表页面画图。
 *
 * 跟"公式与图表"（DERIVED_METRICS）自定义公式引擎的边界：那套引擎只能对单行
 * t_sensor_data 的原始字段做四则运算，算不出这里的东西——一是要知道"加热这一刻
 * 有没有通电"（来自 t_behavior_data，公式引擎只认 t_sensor_data），二是要按时间
 * 积分（累计耗电量/换热量），三是要用到额定功率/介质密度/比热容这些配置中心常量
 * （公式引擎的标识符白名单只有传感器字段，不认配置项）。所以单独开一个文件，
 * 跟 averageChartQuery.js 是同一类"专用查询"，不往通用引擎里硬塞。
 *
 * 计算链路（由内向外四层）：
 *   ① s          — 从 t_sensor_data 取原始温度/流量读数，转数字类型；
 *                   读数达到或超过配置中心 SAFETY_INTERLOCK.abnormalMax（掉线/短路
 *                   哨兵值）时视为无效（NULL），不参与后续计算，避免掉线期间的
 *                   9999 之类异常值污染累计结果。
 *   ② with_state — 用 LAG() 算出每行与上一行的真实时间间隔 dt_sec；用相关子查询
 *                   （correlated subquery）取"这一刻或之前最近一条"t_behavior_data
 *                   的加热开关状态——这是关键设计：项目支持两种上报模式（单主题
 *                   合并上报 / 传感器与行为分开两个主题上报，见 mqtt/index.js 的
 *                   registerRoutes），两张表的 c_time 不保证能精确对上号，用"取
 *                   最近一次已知状态"而不是用 c_time 精确 JOIN，两种模式下都不会
 *                   查空。取不到任何历史行为记录时按"未通电"处理（COALESCE 0），
 *                   保守、不会把未知状态当成通电去累加耗电量。
 *   ③ with_power — 算每一行的瞬时功率、以及这一行相对上一行贡献的电能/热能/流量
 *                   增量（乘以 dt_sec，超过 MAX_GAP_SEC 的间隔视为离线间隙不计入，
 *                   跟 switchDurationService.js/cumulativeService.js on_duration
 *                   同一套护栏）。**三个增量都 gate 在 heater_on 上**——只统计"加热时段"，
 *                   口径完全对称，所以最外层 SEC = 加热电耗 ÷ 加热时段流量 = "每加热 1L 水
 *                   耗多少电"，不会被水泵空跑（没加热）时的流量把数值稀释偏低。
 *                   计算方法（每行增量，dt = min(与上一条读数的秒差, MAX_GAP_SEC)）：
 *                     瞬时功率  actual_power_w = heater_on ? P_额定 : 0                单位 W
 *                     电能增量  electric_wh_delta = heater_on × dt × P_额定 / 3600     单位 Wh
 *                     热能增量  heat_wh_delta = heater_on × dt × (ρ·Cp·(flow/60/1000)·|ΔT|) / 3600  单位 Wh
 *                     流量增量  flow_l_delta = heater_on × dt × (flow/60)              单位 L
 *                   （flow 声明单位 L/min：/60→L/s、/1000→m³/s；/3600 是 W·s→Wh。）
 *                   最外层 SEC = MAX(累计电能 Wh) / NULLIF(MAX(累计加热时段流量 L), 0)   单位 Wh/L
 *   ④ calculated — 用窗口函数把 ③ 的增量滚动累加成"从查询范围起点到这一行为止"
 *                   的累计值，语义上跟"累计流量"图表一致：先在全部原始数据上精确
 *                   逐行累加，再按时间分桶降采样、每桶取累计值最大的那一行（因为
 *                   累计值单调递增，MAX() 等价于"这个桶结束时的读数"，比 PID 跟踪
 *                   等图表用的 ROW_NUMBER 方式更简单）。
 *   最外层        — 按桶聚合：瞬时功率取桶内平均值（体现占空比意义上的平均功率，
 *                   不是取桶内最后一行——不然会是在满功率和 0 之间跳变的方波，
 *                   没法看），累计电耗/换热量取桶内最大值（即该桶结束时的累计值），
 *                   比能耗 = 该桶结束时的累计电耗 ÷ 累计流量（用 NULLIF 防止除以
 *                   0——查询范围内还没有过流量读数时不出现除零错误，返回 NULL）。
 *
 * 【配置中心关联】COMPUTED_METRICS.heaterRatedPower（额定功率）、waterDensity/
 * waterSpecificHeat（介质物性参数）、SAFETY_INTERLOCK.abnormalMax（异常哨兵值）
 * 每次查询实时读取。
 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')
const { calcBucketSeconds } = require('../../utils/timeRange')

/** 采样间隔上限（秒），超出视为离线间隙，不计入累计——跟项目里其他累计类查询
 * （cumulativeService.js on_duration、switchDurationService.js）同一个值。 */
const MAX_GAP_SEC = 10

/**
 * @param {Object} [options]
 * @param {string} [options.d_no]
 * @param {number} [options.limit=300]
 * @param {string} [options.startTime]
 * @param {string} [options.endTime]
 * @returns {Array<{c_time, actualPower, cumulativeElectric, cumulativeHeatEnergy, sec}>}
 */
async function queryHeaterEnergy(options = {}) {
  const { d_no, limit = 300, startTime, endTime } = options
  const safeLimit = Math.min(2000, Math.max(1, Number.parseInt(limit, 10) || 300))

  const config = systemConfig.getConfig()
  const heaterRatedPower = Number(config.COMPUTED_METRICS?.heaterRatedPower) > 0 ? Number(config.COMPUTED_METRICS.heaterRatedPower) : 0
  const waterDensity = Number(config.COMPUTED_METRICS?.waterDensity) > 0 ? Number(config.COMPUTED_METRICS.waterDensity) : 1000
  const waterSpecificHeat = Number(config.COMPUTED_METRICS?.waterSpecificHeat) > 0 ? Number(config.COMPUTED_METRICS.waterSpecificHeat) : 4200
  const abnormalMaxRaw = Number(config.SAFETY_INTERLOCK?.abnormalMax)
  const abnormalMax = Number.isFinite(abnormalMaxRaw) && abnormalMaxRaw > 0 ? abnormalMaxRaw : 9999

  // 加热额定功率没配置/是 0 时，电耗和换热量必然全是 0，直接短路返回空数组，
  // 不用跑一遍这套复杂查询。
  if (heaterRatedPower <= 0) return []

  const conditions = []
  const whereParams = []
  if (d_no) { conditions.push('d_no = ?'); whereParams.push(d_no) }
  if (startTime) { conditions.push('c_time >= ?'); whereParams.push(startTime) }
  if (endTime) { conditions.push('c_time <= ?'); whereParams.push(endTime) }
  const whereExtra = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  // 相关子查询（取加热开关最近状态）单独绑定一次 d_no——跟主查询的 d_no 过滤是
  //两个独立的 "?"，物理位置在主查询 WHERE 之前（with_state 的 SELECT 列表文本上
  // 先于它 FROM 的子查询 s 展开），下面 params 数组的顺序必须跟这个物理顺序对齐。
  const behaviorDNoCond = d_no ? 'AND b.d_no = ?' : ''

  const bucketSeconds = startTime ? calcBucketSeconds({ startTime, endTime, pointLimit: safeLimit }) : 1

  const sql = `
    SELECT
      MIN(c_time) AS c_time,
      ROUND(AVG(actual_power_w), 1) AS actualPower,
      ROUND(MAX(cumulative_electric_wh), 4) AS cumulativeElectric,
      ROUND(MAX(cumulative_heat_wh), 4) AS cumulativeHeatEnergy,
      ROUND(MAX(cumulative_electric_wh) / NULLIF(MAX(cumulative_flow_l), 0), 4) AS sec
    FROM (
      SELECT
        c_time,
        FLOOR(UNIX_TIMESTAMP(c_time) / ?) AS bucket,
        actual_power_w,
        SUM(electric_wh_delta) OVER (ORDER BY c_time ASC, id ASC ROWS UNBOUNDED PRECEDING) AS cumulative_electric_wh,
        SUM(heat_wh_delta)     OVER (ORDER BY c_time ASC, id ASC ROWS UNBOUNDED PRECEDING) AS cumulative_heat_wh,
        SUM(flow_l_delta)      OVER (ORDER BY c_time ASC, id ASC ROWS UNBOUNDED PRECEDING) AS cumulative_flow_l
      FROM (
        SELECT
          id, c_time,
          CASE WHEN heater_on = 1 THEN ${heaterRatedPower} ELSE 0 END AS actual_power_w,
          heater_on * LEAST(COALESCE(dt_sec, 0), ${MAX_GAP_SEC}) * ${heaterRatedPower} / 3600 AS electric_wh_delta,
          heater_on * LEAST(COALESCE(dt_sec, 0), ${MAX_GAP_SEC})
            * COALESCE(${waterDensity} * ${waterSpecificHeat} * (flow / 60 / 1000) * ABS(temp2 - temp1), 0) / 3600 AS heat_wh_delta,
          heater_on * LEAST(COALESCE(dt_sec, 0), ${MAX_GAP_SEC}) * COALESCE(flow / 60, 0) AS flow_l_delta
        FROM (
          SELECT
            s.id, s.c_time, s.temp1, s.temp2, s.flow,
            TIMESTAMPDIFF(SECOND, LAG(s.c_time) OVER (ORDER BY s.c_time ASC, s.id ASC), s.c_time) AS dt_sec,
            COALESCE((
              SELECT CASE WHEN TRIM(b.field2) = '1' THEN 1 ELSE 0 END
              FROM t_behavior_data b
              WHERE b.c_time <= s.c_time ${behaviorDNoCond}
              ORDER BY b.c_time DESC, b.id DESC
              LIMIT 1
            ), 0) AS heater_on
          FROM (
            SELECT
              id, c_time,
              CASE WHEN CAST(NULLIF(field1, '') AS DECIMAL(20,6)) >= ${abnormalMax} THEN NULL ELSE CAST(NULLIF(field1, '') AS DECIMAL(20,6)) END AS temp1,
              CASE WHEN CAST(NULLIF(field2, '') AS DECIMAL(20,6)) >= ${abnormalMax} THEN NULL ELSE CAST(NULLIF(field2, '') AS DECIMAL(20,6)) END AS temp2,
              CASE WHEN CAST(NULLIF(field3, '') AS DECIMAL(20,6)) >= ${abnormalMax} THEN NULL ELSE CAST(NULLIF(field3, '') AS DECIMAL(20,6)) END AS flow
            FROM t_sensor_data
            WHERE 1=1 ${whereExtra}
          ) AS s
        ) AS with_state
      ) AS with_power
    ) AS calculated
    GROUP BY bucket
    ORDER BY c_time ASC
    LIMIT ?
  `
  const params = [
    bucketSeconds,
    ...(d_no ? [d_no] : []),   // behaviorDNoCond 的绑定值（物理位置在 whereExtra 之前）
    ...whereParams,
    safeLimit,
  ]

  const [rows] = await promisePool.query(sql, params)
  return rows
}

module.exports = { queryHeaterEnergy }
