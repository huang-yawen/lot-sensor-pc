/**
 * 【文件职责】历史图表页面的传感器趋势查询服务，一次查询同一批 t_sensor_data 行，
 * 供"平均温度与平均流速""温度曲线""瞬时流量与压力"三张图共用：
 *   平均温度 = (温度1 + 温度2) / 2
 *   平均流速 = 流量(L/s -> m³/s) / 管道横截面积(cm² -> m²)
 *   温度1/温度2/瞬时流量/压力 = 原始读数，不做二次计算
 * 平均温度/平均流速的公式跟 service/computedMetrics/computedMetrics.js 里实时计算用的
 * 完全一致，区别是那边是内存里的实时滚动缓冲区（最多 60 点，不认时间范围）；这里改成
 * 按时间范围直接查数据库，供历史图表页面的时间选择器使用。
 * 【配置中心关联】COMPUTED_METRICS.pipeAreaCm2 用于计算平均流速，每次查询实时读取。
 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')
const { getTargetTemp } = require('../pidHeating/pidHeating')

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

  const areaCm2 = Number(systemConfig.getConfig().COMPUTED_METRICS?.pipeAreaCm2)
  const hasArea = Number.isFinite(areaCm2) && areaCm2 > 0
  // 跟 computedMetrics.js 一致：L/s -> m³/s 除以 1000，管道面积 cm² -> m² 除以 10000。
  const velocityExpr = hasArea
    ? `ROUND((CAST(NULLIF(field3, '') AS DECIMAL(20,6)) / 1000) / (${areaCm2} / 10000), 4)`
    : 'NULL'

  const conditions = []
  const params = []
  if (d_no) { conditions.push('d_no = ?'); params.push(d_no) }
  if (startTime) { conditions.push('c_time >= ?'); params.push(startTime) }
  if (endTime) { conditions.push('c_time <= ?'); params.push(endTime) }
  const whereExtra = conditions.length ? `AND ${conditions.join(' AND ')}` : ''
  params.push(safeLimit)

  const sql = `
    SELECT c_time, averageTemp, averageVelocity, temp1, temp2, flow, pressure
    FROM (
      SELECT
        id, c_time,
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
      ORDER BY c_time DESC, id DESC
      LIMIT ?
    ) AS recent
    ORDER BY c_time ASC, id ASC
  `
  const [rows] = await promisePool.query(sql, params)
  return rows
}

/**
 * 当前生效的目标温度（PID 跟踪对比图用作水平参考线）。指令中心只存"当前值"，
 * 没有历史记录，所以没法画成随时间变化的曲线，只能取当前值画一条参考线。
 * @param {string} [d_no]
 * @returns {Promise<number>}
 */
async function getCurrentTargetTemp(d_no) {
  const fallback = systemConfig.getConfig().PID_HEATING?.targetTemp ?? 22
  return getTargetTemp(d_no, fallback)
}

module.exports = { queryAverageChart, getCurrentTargetTemp }
