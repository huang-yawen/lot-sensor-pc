/**
 * 【文件职责】加热能耗分析历史查询：瞬时实际加热功率、累计耗电量、累计换热量、
 * 单位流量能耗（比能耗 SEC）——四个跟"加热到底花了多少电、换来多少热"相关的
 * 工程指标，供历史图表页面画图。
 *
 * 【页面/图表】历史图表页 →「加热能耗分析」一节，一个接口 GET /api/heater-energy 出 3 张图：
 *   · 「瞬时加热功率」            ← actualPowerW（= heater_on ? P_额定 : 0）
 *   · 「累计耗电量 / 累计换热量」 ← cumulativeEnergyWh / cumulativeHeatWh
 *   · 「单位流量能耗（SEC）」     ← secWhPerL（= 加热电耗 ÷ 加热时段流量，Wh/L）
 *   需要 COMPUTED_METRICS.heaterRatedPower > 0，否则三张图都返回空（页面显示"暂无数据"）。
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
 *   ② with_state — 用 LAG() 算出每行与上一行的真实时间间隔 dt_sec；取"这一刻或之前
 *                   最近一条"t_behavior_data 的加热开关状态——这是关键设计：项目支持
 *                   两种上报模式（单主题合并上报 / 传感器与行为分开两个主题上报，见
 *                   mqtt/index.js 的 registerRoutes），两张表的 c_time 不保证能精确
 *                   对上号，用"取最近一次已知状态"而不是用 c_time 精确 JOIN，两种模式
 *                   下都不会查空。取不到任何历史行为记录时按"未通电"处理（seed 行兜底
 *                   给 0），保守、不会把未知状态当成通电去累加耗电量。
 *                   取状态的实现是"事件流 + 前向填充"（events/grouped/filled 三层），
 *                   不是每行一次相关子查询——后者的边界依赖外层列，进不了索引 range，
 *                   是 O(传感器行数 × 行为行数) 的平方级开销，24h 范围实测要 170 秒以上。
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
 * 【配置】COMPUTED_METRICS.heaterRatedPower（额定功率）、waterDensity/
 * waterSpecificHeat（介质物性参数）、SAFETY_INTERLOCK.abnormalMax（异常哨兵值）
 * 每次查询实时读取。
 */
const promisePool = require('../../config/dbPool')
const { COMPUTED_METRICS } = require('../../config/metrics')
const SAFETY_CONFIG = require('../safety/config')
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

  const heaterRatedPower = Number(COMPUTED_METRICS?.heaterRatedPower) > 0 ? Number(COMPUTED_METRICS.heaterRatedPower) : 0
  const waterDensity = Number(COMPUTED_METRICS?.waterDensity) > 0 ? Number(COMPUTED_METRICS.waterDensity) : 1000
  const waterSpecificHeat = Number(COMPUTED_METRICS?.waterSpecificHeat) > 0 ? Number(COMPUTED_METRICS.waterSpecificHeat) : 4200
  const abnormalMaxRaw = Number(SAFETY_CONFIG.abnormalMax)
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

  // 加热开关状态用"事件流 + 前向填充"取，不用"每行一次相关子查询"：相关子查询的边界
  // （b.c_time <= s.c_time）依赖外层列，MySQL 没法把它下推成索引扫描的起点，只能从索引
  // 最大端反向扫描再逐行过滤，每个传感器行都要重来一次，复杂度 O(传感器行数 × 行为行数)。
  // 做法：把窗口内的行为记录（带状态）和传感器行（状态留空）UNION 成一条按时间排序的事件流，
  // 用窗口函数把状态向后填充到每个传感器行，一次扫描算完。
  const behaviorConditions = []
  const behaviorParams = []
  if (d_no) { behaviorConditions.push('d_no = ?'); behaviorParams.push(d_no) }
  if (startTime) { behaviorConditions.push('c_time >= ?'); behaviorParams.push(startTime) }
  if (endTime) { behaviorConditions.push('c_time <= ?'); behaviorParams.push(endTime) }
  const behaviorWhere = behaviorConditions.length ? `AND ${behaviorConditions.join(' AND ')}` : ''

  // 窗口起点之前的状态由一条 seed 行代表：它排在事件流最前面，负责给"第一条行为记录
  // 之前的那些传感器行"兜底。这条子查询的边界是常量（不依赖外层），能正常走索引
  // range + LIMIT 1，整个查询只执行一次。
  // 不限时间范围时整段数据都在窗口内，seed 退化成"最早时刻 + 未通电"，跟原来取不到
  // 历史状态就 COALESCE(..., 0) 的保守口径一致。
  const seedParams = []
  let seedTimeSql = `CAST('1000-01-01 00:00:00' AS DATETIME)`
  let seedStateSql = '0'
  if (startTime) {
    seedTimeSql = 'CAST(? AS DATETIME)'
    seedParams.push(startTime)
    seedStateSql = `COALESCE((
                    SELECT CASE WHEN TRIM(b.field2) = '1' THEN 1 ELSE 0 END
                    FROM t_behavior_data b
                    WHERE b.c_time < ? ${d_no ? 'AND b.d_no = ?' : ''}
                    ORDER BY b.c_time DESC, b.id DESC
                    LIMIT 1
                  ), 0)`
    seedParams.push(startTime)
    if (d_no) seedParams.push(d_no)
  }

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
            id, c_time, temp1, temp2, flow, heater_on,
            TIMESTAMPDIFF(SECOND, LAG(c_time) OVER (ORDER BY c_time ASC, id ASC), c_time) AS dt_sec
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
                  SELECT
                    id, c_time,
                    CASE WHEN CAST(NULLIF(field1, '') AS DECIMAL(20,6)) >= ${abnormalMax} THEN NULL ELSE CAST(NULLIF(field1, '') AS DECIMAL(20,6)) END AS temp1,
                    CASE WHEN CAST(NULLIF(field2, '') AS DECIMAL(20,6)) >= ${abnormalMax} THEN NULL ELSE CAST(NULLIF(field2, '') AS DECIMAL(20,6)) END AS temp2,
                    CASE WHEN CAST(NULLIF(field3, '') AS DECIMAL(20,6)) >= ${abnormalMax} THEN NULL ELSE CAST(NULLIF(field3, '') AS DECIMAL(20,6)) END AS flow
                  FROM t_sensor_data
                  WHERE 1=1 ${whereExtra}
                ) AS s
              ) AS events
            ) AS grouped
          ) AS filled
          -- WHERE 先于窗口函数求值，所以上面的 dt_sec 只在传感器行之间算，跟原来一致
          WHERE kind = 's'
        ) AS with_state
      ) AS with_power
    ) AS calculated
    GROUP BY bucket
    ORDER BY c_time ASC
    LIMIT ?
  `
  // 顺序必须跟 "?" 在 SQL 文本里出现的先后一致：分桶宽度 → seed 行 → 行为记录分支 → 传感器分支 → LIMIT
  const params = [
    bucketSeconds,
    ...seedParams,
    ...behaviorParams,
    ...whereParams,
    safeLimit,
  ]

  const [rows] = await promisePool.query(sql, params)
  return rows
}

module.exports = { queryHeaterEnergy }
