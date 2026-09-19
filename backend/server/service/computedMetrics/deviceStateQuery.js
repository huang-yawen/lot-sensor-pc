/**
 * 【文件职责】水泵/加热运行状态历史查询：按时间范围从 t_behavior_data 取水泵、加热的
 * 开关状态，供历史图表页面画"设备状态时间线"（阶梯图），直观展示自动控制/安全联锁
 * 的实际动作历史。字段槽位（field1=水泵、field2=加热）跟 safetyInterlock.js/
 * faultStatus.js/pidHeating.js 保持一致。
 * 【页面/图表】历史图表页 →「设备状态时间线」，接口 GET /api/device-state-trend。
 *   y 轴只有 开(1) / 关(0) 两档，前端用 step:'end' 画阶梯线，每段宽度=该状态的真实持续时长。
 *   跟「PID 周期加热开关」那张图的区别：那张按 PID 自己的 PWM 周期边界精确复原（不看上报
 *   频率），这张按设备实际上报的采样点画，反映的是"设备真实动作历史"。两张图互补。
 * 【公式】无二次计算：把 t_behavior_data 的开关字段归一成 1 / 0 / null（见 toOnValue），
 *   兼容 on/open/1/true 与 off/close/0/false 两套写法。
 * 【配置】无直接读取。
 */
const promisePool = require('../../config/dbPool')
const { calcBucketSeconds } = require('../../utils/timeRange')

/** 兼容多种上报格式：on/open/1/true -> 1，off/close/closed/0/false -> 0，其余 -> null。 */
function toOnValue(raw) {
  if (raw == null) return null
  const s = String(raw).trim().toLowerCase()
  if (['on', 'open', '1', 'true'].includes(s)) return 1
  if (['off', 'close', 'closed', '0', 'false'].includes(s)) return 0
  return null
}

/**
 * @param {Object} [options]
 * @param {string} [options.d_no]
 * @param {number} [options.limit=300]
 * @param {string} [options.startTime]
 * @param {string} [options.endTime]
 * @returns {Array<{c_time, pumpOn, heaterOn}>} pumpOn/heaterOn 为 1/0/null
 */
async function queryDeviceStateTrend(options = {}) {
  const { d_no, limit = 300, startTime, endTime } = options
  const safeLimit = Math.min(2000, Math.max(1, Number.parseInt(limit, 10) || 300))

  const conditions = []
  const whereParams = []
  if (d_no) { conditions.push('d_no = ?'); whereParams.push(d_no) }
  if (startTime) { conditions.push('c_time >= ?'); whereParams.push(startTime) }
  if (endTime) { conditions.push('c_time <= ?'); whereParams.push(endTime) }
  const whereExtra = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  // 开关状态是离散量（0/1），均值没有意义；按时间等宽分桶后每桶取时间最新的一行，
  // 代表这段时间结束时的真实开关状态，跟阶梯图（step 模式）的展示方式也更贴合。
  const bucketSeconds = startTime ? calcBucketSeconds({ startTime, endTime, pointLimit: safeLimit }) : 1
  const params = [bucketSeconds, ...whereParams, safeLimit]

  const sql = `
    SELECT c_time, field1 AS pumpRaw, field2 AS heaterRaw
    FROM (
      SELECT
        c_time, field1, field2,
        ROW_NUMBER() OVER (PARTITION BY FLOOR(UNIX_TIMESTAMP(c_time) / ?) ORDER BY c_time DESC, id DESC) AS rn
      FROM t_behavior_data
      WHERE 1=1 ${whereExtra}
    ) AS bucketed
    WHERE rn = 1
    ORDER BY c_time ASC
    LIMIT ?
  `
  const [rows] = await promisePool.query(sql, params)
  return rows.map((r) => ({
    c_time: r.c_time,
    pumpOn: toOnValue(r.pumpRaw),
    heaterOn: toOnValue(r.heaterRaw),
  }))
}

module.exports = { queryDeviceStateTrend }
