/**
 * 【文件职责】"历史图表"页面的 6 个查询接口（HistoryCharts.vue 直接调，没走 store）。
 * 每个只做：解析 d_no / 时间范围 / limit → 调 service/computedMetrics 里对应的 *Query → 包成 { success, data }。
 * 公式全在 service 层，这里不写计算。出错统一 500 { success:false, message }。
 *
 * 公共 query：d_no?（单设备可不传）、limit?、range?('1h'|'6h'|'24h'|'custom')、
 *            startTime?/endTime?（range=custom 时用）。heatingAnalysis 不吃 d_no。
 *
 *  GET /api/average-chart      averageChart     平均温度/流速时间线 + 当前目标温度/目标流速（PID/恒流速跟踪图参考线）
 *     → data:{ rows:[...], targetTemp, targetVelocity }
 *  GET /api/temp-flow-scatter  scatterChart     温度-流量相关性散点
 *     → data:[ 散点... ]
 *  GET /api/current-temp       currentTemp      首页：最新一条出水温度（读 SENSOR_FIELD_MAP.temp2 对应槽位）
 *     → data: number | null
 *  GET /api/device-state-trend deviceStateTrend 水泵/加热开关阶梯图
 *     → data:[ 时间点... ]
 *  GET /api/heater-energy      heaterEnergy     加热能耗分析（需 COMPUTED_METRICS.heaterRatedPower > 0，否则 rows 为空）
 *     → data:{ rows:[...] }
 *  GET /api/heating-analysis   heatingAnalysis  加热效率 + 加热速度，一次返回两条画两张图
 *     → data:{ efficiency:[...], rate:[...] }
 * 【配置】currentTemp 读 SENSOR_FIELD_MAP（config/appSettings.js），其余靠 service 层实时读。
 */
const promisePool = require('../config/dbPool')
const { SENSOR_FIELD_MAP } = require('../config/appSettings')
const { BACKFILL_LABEL } = require('../utils/recencyFilter')
const { resolveTimeRange } = require('../utils/timeRange')
const { queryAverageChart, getCurrentTargetTemp, getCurrentTargetVelocity } = require('../service/computedMetrics/averageChartQuery')
const { queryTempFlowScatter } = require('../service/computedMetrics/scatterChartQuery')
const { queryDeviceStateTrend } = require('../service/computedMetrics/deviceStateQuery')
const { queryHeaterEnergy } = require('../service/computedMetrics/heaterEnergyQuery')
const { queryHeatingEfficiency, queryHeatingRate, queryHeatExchangeEfficiency, queryTempChangeRate } = require('../service/computedMetrics/heatingAnalysisQuery')

// GET /api/average-chart —— 平均温度/平均流速时间线，附带当前目标温度、目标流速（给 PID/恒流速跟踪图当参考线）
async function averageChart(req, res) {
  try {
    const d_no = req.query.d_no || null
    const limit = req.query.limit
    const { startTime, endTime } = resolveTimeRange(req.query)
    const [rows, targetTemp, targetVelocity] = await Promise.all([
      queryAverageChart({ d_no, limit, startTime, endTime }),
      getCurrentTargetTemp(d_no),
      getCurrentTargetVelocity(d_no),
    ])
    res.json({ success: true, data: { rows, targetTemp, targetVelocity } })
  } catch (err) {
    console.error('[AverageChartController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}

// GET /api/temp-flow-scatter —— 温度-流量相关性散点图
async function scatterChart(req, res) {
  try {
    const d_no = req.query.d_no || null
    const limit = req.query.limit
    const { startTime, endTime } = resolveTimeRange(req.query)
    const rows = await queryTempFlowScatter({ d_no, limit, startTime, endTime })
    res.json({ success: true, data: rows })
  } catch (err) {
    console.error('[ScatterChartController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}

// GET /api/current-temp —— 首页仪表盘：最新一条出水温度读数
async function currentTemp(req, res) {
    try {
        const field = SENSOR_FIELD_MAP?.temp2
        if (!field) {
            return res.json({ success: true, data: null })
        }
        // 排除补传数据：它是设备断线期间缓存、恢复后补传上来的旧值，自增 id 却是最大的，
        // 不排除的话首页显示的"当前出水温度"会变成断线那段时间的历史温度。
        const [[row]] = await promisePool.query(
            `SELECT CAST(NULLIF(\`${field}\`, '') AS DECIMAL(20, 2)) AS value FROM t_sensor_data
             WHERE COALESCE(online, '') <> ? ORDER BY id DESC LIMIT 1`,
            [BACKFILL_LABEL]
        )
        res.json({ success: true, data: row?.value ?? null })
    } catch (err) {
        console.error('[CurrentTempController] 查询失败:', err)
        res.status(500).json({ success: false, message: err.message })
    }
}

// GET /api/device-state-trend —— 设备状态时间线（水泵/加热开关阶梯图）
async function deviceStateTrend(req, res) {
  try {
    const d_no = req.query.d_no || null
    const limit = req.query.limit
    const { startTime, endTime } = resolveTimeRange(req.query)
    const data = await queryDeviceStateTrend({ d_no, limit, startTime, endTime })
    res.json({ success: true, data })
  } catch (err) {
    console.error('[DeviceStateTrendController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}

// GET /api/heater-energy —— 加热能耗分析（瞬时功率 / 累计耗电 / 累计换热量）
async function heaterEnergy(req, res) {
  try {
    const d_no = req.query.d_no || null
    const limit = req.query.limit
    const { startTime, endTime } = resolveTimeRange(req.query)
    const rows = await queryHeaterEnergy({ d_no, limit, startTime, endTime })
    res.json({ success: true, data: { rows } })
  } catch (err) {
    console.error('[HeaterEnergyController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}

// GET /api/heating-analysis —— 热分析统一接口：加热效率 / 加热速度 / 换热效率 / 温度变化率，
//   一次请求返回四条历史序列，避免前端为每个热相关指标各打一个接口。
async function heatingAnalysis(req, res) {
  try {
    const limit = req.query.limit
    const { startTime, endTime } = resolveTimeRange(req.query)
    const [efficiency, rate, heatExchangeEfficiency, tempChangeRate] = await Promise.all([
      queryHeatingEfficiency({ limit, startTime, endTime }),
      queryHeatingRate({ limit, startTime, endTime }),
      queryHeatExchangeEfficiency({ limit, startTime, endTime }),
      queryTempChangeRate({ limit, startTime, endTime }),
    ])
    res.json({ success: true, data: { efficiency, rate, heatExchangeEfficiency, tempChangeRate } })
  } catch (err) {
    console.error('[HeatingAnalysisController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}

module.exports = { averageChart, scatterChart, currentTemp, deviceStateTrend, heaterEnergy, heatingAnalysis }
