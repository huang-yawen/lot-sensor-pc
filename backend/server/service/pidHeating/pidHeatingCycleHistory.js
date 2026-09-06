/**
 * 【文件职责】PID PWM 周期历史记录：把 pidHeating.js 每个周期算出的开关计划（周期起始时间、
 * 周期长度、本周期加热应开启的时长）落库，供"历史图表"页面画"PID周期加热开关阶梯图"——
 * 按周期边界精确复原每个周期内先开后关的真实波形，而不是按设备行为上报的采样频率取样。
 * 表结构懒加载建表（跟 derivedMetricService.js 一致），不需要额外手动跑迁移脚本。
 * 【配置中心关联】无直接读取。
 */
const promisePool = require('../../config/dbPool')

let ensurePromise = null
/** 首次调用时建表，建表失败清空缓存以便下次重试（同 derivedMetricService.js 的做法）。 */
function ensureTable() {
  if (ensurePromise) return ensurePromise
  ensurePromise = promisePool.query(`CREATE TABLE IF NOT EXISTS t_pid_heating_cycle (
    id INT NOT NULL AUTO_INCREMENT,
    d_no VARCHAR(64) DEFAULT NULL COMMENT '设备编号',
    cycle_index INT NOT NULL COMMENT 'PWM周期序号（进程内自增，重启清零，不作跨重启对比）',
    window_start DATETIME(3) NOT NULL COMMENT '本周期起始时间',
    window_ms INT NOT NULL COMMENT '周期长度(ms)',
    on_duration_ms INT NOT NULL COMMENT '本周期内加热应开启的时长(ms)',
    duty DECIMAL(5,1) NOT NULL COMMENT '占空比(%)',
    c_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '写入时间',
    PRIMARY KEY (id),
    KEY idx_d_no_window_start (d_no, window_start)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8`).catch((err) => {
    ensurePromise = null
    throw err
  })
  return ensurePromise
}

/** 把毫秒时间戳格式化成 MySQL DATETIME(3) 能接受的 "YYYY-MM-DD HH:mm:ss.SSS"（本地时区）。 */
function formatDateTimeMs(ms) {
  const d = new Date(ms)
  const pad = (n, len = 2) => String(n).padStart(len, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

/**
 * 保存一个已经排定的 PWM 周期计划。仅供展示用的历史记录，失败只打日志不抛错，
 * 避免历史落库故障影响 PID 主控制流程。
 */
async function saveCycleRecord({ d_no, cycleIndex, windowStart, windowMs, onDurationMs, duty }) {
  try {
    await ensureTable()
    await promisePool.query(
      'INSERT INTO t_pid_heating_cycle (d_no, cycle_index, window_start, window_ms, on_duration_ms, duty) VALUES (?, ?, ?, ?, ?, ?)',
      [d_no || null, cycleIndex, formatDateTimeMs(windowStart), windowMs, Math.round(onDurationMs), duty]
    )
  } catch (err) {
    console.error('[PidHeatingCycleHistory] 保存周期历史失败:', err.message)
  }
}

/**
 * 查询时间范围内的周期记录，供历史图表按周期边界复原阶梯波形。
 * 跟本页面其它历史图表接口一样不按设备号过滤（这个项目的历史图表页面本身不提供设备选择器）。
 * @returns {Array<{cycle_index, window_start, window_ms, on_duration_ms, duty}>}
 */
async function queryCycles({ startTime, endTime, limit = 1000 } = {}) {
  await ensureTable()
  const safeLimit = Math.min(5000, Math.max(1, Number.parseInt(limit, 10) || 1000))
  const conditions = []
  const params = []
  if (startTime) { conditions.push('window_start >= ?'); params.push(startTime) }
  if (endTime) { conditions.push('window_start <= ?'); params.push(endTime) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(safeLimit)
  const [rows] = await promisePool.query(
    `SELECT cycle_index, window_start, window_ms, on_duration_ms, duty
     FROM t_pid_heating_cycle ${where}
     ORDER BY window_start ASC
     LIMIT ?`,
    params
  )
  return rows
}

module.exports = { saveCycleRecord, queryCycles }
