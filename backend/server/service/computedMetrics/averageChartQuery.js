/**
 * 【文件职责】历史图表页面的传感器趋势查询服务，一次查询同一批 t_sensor_data 行，
 * 供"平均温度与平均流速""温度曲线""瞬时流量与压力"三张图共用：
 *   平均温度 = (温度1 + 温度2) / 2
 *   平均流速 = 流量(L/s -> m³/s) / 管道横截面积(cm² -> m²)
 *   温度1/温度2/瞬时流量/压力 = 原始读数，不做二次计算
 * 平均温度/平均流速的公式跟 service/computedMetrics/computedMetrics.js 里实时计算用的
 * 完全一致，区别是那边是内存里的实时滚动缓冲区（最多 60 点，不认时间范围）；这里改成
 * 按时间范围直接查数据库，供历史图表页面的时间选择器使用。
 * 【配置中心关联】COMPUTED_METRICS.pipeAreaCm2 用于计算平均流速，
 * PUMP_VELOCITY_CONTROL.defaultTargetVelocity 用作目标流速兜底，每次查询实时读取。
 */
const promisePool = require('../../config/dbPool')
const { SINGLE_DEVICE_MODE, DEFAULT_TARGET_TEMP } = require('../../config/appSettings')
const { COMPUTED_METRICS } = require('../../config/metrics')
const PUMP_VELOCITY_CONFIG = require('../pumpVelocityControl/config')
const { getTargetTemp } = require('../pidHeating/pidHeating')
const { getTargetVelocity } = require('../pumpVelocityControl/pumpVelocityControl')
const { calcBucketSeconds } = require('../../utils/timeRange')
const { getDefaultDeviceId } = require('../../utils/mappedData')

/**
 * @param {Object} [options]
 * @param {string} [options.d_no]
 * @param {number} [options.limit=300]
 * @param {string} [options.startTime]
 * @param {string} [options.endTime]
 * @returns {Array<{c_time, averageTemp, averageVelocity, temp1, temp2, flow, pressure}>}
 */
async function queryAverageChart(options = {}) {
  const { d_no, limit = 300, startTime, endTime } = options
  const safeLimit = Math.min(2000, Math.max(1, Number.parseInt(limit, 10) || 300))

  const areaCm2 = Number(COMPUTED_METRICS?.pipeAreaCm2)
  const hasArea = Number.isFinite(areaCm2) && areaCm2 > 0
  // 跟 computedMetrics.js 的"平均流速 v = Q / A"完全一致的单位链条：
  // field3 管路流量按 t_sensor_field_mapper 的声明是 L/min，先 /60 转 L/s，
  // 再 /1000 转 m³/s；管道面积 cm² -> m² 除以 10000。
  const velocityExpr = hasArea
    ? `ROUND(((CAST(NULLIF(field3, '') AS DECIMAL(20,6)) / 60) / 1000) / (${areaCm2} / 10000), 4)`
    : 'NULL'

  const conditions = []
  const whereParams = []
  if (d_no) { conditions.push('d_no = ?'); whereParams.push(d_no) }
  if (startTime) { conditions.push('c_time >= ?'); whereParams.push(startTime) }
  if (endTime) { conditions.push('c_time <= ?'); whereParams.push(endTime) }
  const whereExtra = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  // 按时间等宽分桶聚合降采样：把选定范围切成约 safeLimit 个桶，每桶取均值。保证不管
  // 选多大的时间范围，图表都能展现横跨整个范围的趋势，而不会因为范围内数据量超过
  // safeLimit，被"取最新 N 条"吃成同一批挤在末尾的数据（跟工业监控里 Grafana/InfluxDB
  // 的按时间桶聚合思路一致）。范围内数据本来就稀疏时桶宽度会算得很小，等于不聚合。
  const bucketSeconds = startTime ? calcBucketSeconds({ startTime, endTime, pointLimit: safeLimit }) : 1
  const params = [bucketSeconds, ...whereParams]

  const sql = `
    SELECT
      MIN(c_time) AS c_time,
      AVG(averageTemp) AS averageTemp,
      AVG(averageVelocity) AS averageVelocity,
      AVG(temp1) AS temp1,
      AVG(temp2) AS temp2,
      AVG(flow) AS flow,
      AVG(pressure) AS pressure
    FROM (
      SELECT
        c_time,
        FLOOR(UNIX_TIMESTAMP(c_time) / ?) AS bucket,
        CASE WHEN NULLIF(field1, '') IS NOT NULL AND NULLIF(field2, '') IS NOT NULL
          THEN ROUND((CAST(field1 AS DECIMAL(20,6)) + CAST(field2 AS DECIMAL(20,6))) / 2, 2)
          ELSE NULL END AS averageTemp,
        ${velocityExpr} AS averageVelocity,
        CAST(NULLIF(field1, '') AS DECIMAL(20,6)) AS temp1,
        CAST(NULLIF(field2, '') AS DECIMAL(20,6)) AS temp2,
        CAST(NULLIF(field3, '') AS DECIMAL(20,6)) AS flow,
        CAST(NULLIF(field4, '') AS DECIMAL(20,6)) AS pressure
      FROM t_sensor_data
      WHERE 1=1 ${whereExtra}
    ) AS calculated
    GROUP BY bucket
    ORDER BY c_time ASC
  `
  const [rows] = await promisePool.query(sql, params)
  return rows
}

/**
 * 当前生效的目标温度（PID 跟踪对比图用作水平参考线）。指令中心只存"当前值"，
 * 没有历史记录，所以没法画成随时间变化的曲线，只能取当前值画一条参考线。
 * @param {string} [d_no] 多设备模式下由调用方指定；单设备模式下会被忽略，改用真实
 *   默认设备号查询——前端在单设备模式下通常不传 d_no（传 null/undefined），但指令
 *   中心里保存目标温度时用的是真实设备号，拿 null 去查会一直查空，误以为没配置。
 * @returns {Promise<number>}
 */
async function getCurrentTargetTemp(d_no) {
  const resolvedDNo = SINGLE_DEVICE_MODE === true
    ? await getDefaultDeviceId()
    : d_no
  const fallback = DEFAULT_TARGET_TEMP
  return getTargetTemp(resolvedDNo, fallback)
}

/**
 * 当前生效的目标流速（恒流速跟踪对比图用作水平参考线）。跟目标温度一样，指令中心
 * 只存"当前值"没有历史，只能取当前值画一条参考线。
 * 恒流速控制的两套算法（滞环通断/占空比）共用这一个设定值，来源也只有这一处
 * （指令中心 target_velocity，没配就退回 PUMP_VELOCITY_CONTROL.defaultTargetVelocity）。
 * @param {string} [d_no] 单设备模式下忽略传入值，改用真实默认设备号——指令中心保存
 *   目标流速时用的是真实设备号，拿 null 去查会一直查空，误以为没配置。
 * @returns {Promise<number>}
 */
async function getCurrentTargetVelocity(d_no) {
  const resolvedDNo = SINGLE_DEVICE_MODE === true
    ? await getDefaultDeviceId()
    : d_no
  const fallback = PUMP_VELOCITY_CONFIG.defaultTargetVelocity
  return getTargetVelocity(resolvedDNo, fallback)
}

module.exports = { queryAverageChart, getCurrentTargetTemp, getCurrentTargetVelocity }
