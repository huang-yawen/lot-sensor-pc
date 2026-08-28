/**
 * 【文件职责】历史图表时间范围解析工具。把前端传的预设档位（5m/10m/30m/1h/3h/6h/24h/custom）
 * 统一转成 SQL 能直接比较的起止时间字符串，供 cumulativeService/timeWindowService/
 * averageChartQuery 共用，保证"选不同时间范围，数据跟着正确变化"这条逻辑只写一处。
 * 同时提供 calcBucketSeconds，供各查询服务把选定范围切成约 pointLimit 个等宽时间桶做
 * 降采样聚合——否则时间范围内数据量一旦超过 pointLimit，单纯"取最新 N 条"会导致不同
 * 时间范围选出的其实是同一批挤在末尾的数据，选大范围看不到跨度趋势。
 * 【配置中心关联】无直接读取。
 */

/** 预设档位 -> 往前推多少分钟。 */
const PRESET_MINUTES = {
  '5m': 5,
  '10m': 10,
  '30m': 30,
  '1h': 60,
  '3h': 180,
  '6h': 360,
  '24h': 1440,
}

function formatDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * 解析时间范围。
 * @param {Object} query - { range, startTime, endTime }
 * @returns {{ startTime: string, endTime: string|null }} endTime 为 null 表示不限制上界（到当前时刻）
 */
function resolveTimeRange(query = {}) {
  const range = query.range || '1h'

  if (range === 'custom') {
    const start = query.startTime ? new Date(query.startTime) : null
    const end = query.endTime ? new Date(query.endTime) : null
    if (!start || Number.isNaN(start.getTime())) {
      throw new Error('自定义时间范围缺少合法的开始时间')
    }
    if (end && Number.isNaN(end.getTime())) {
      throw new Error('自定义时间范围的结束时间格式不正确')
    }
    if (end && start > end) {
      throw new Error('开始时间不能大于结束时间')
    }
    return { startTime: formatDateTime(start), endTime: end ? formatDateTime(end) : null }
  }

  const minutes = PRESET_MINUTES[range]
  if (!minutes) {
    throw new Error(`不支持的时间范围: ${range}`)
  }
  const start = new Date(Date.now() - minutes * 60 * 1000)
  return { startTime: formatDateTime(start), endTime: null }
}

/**
 * 根据时间范围和目标点数，计算分桶宽度（秒）。把 startTime~endTime 这段时间切成约
 * pointLimit 个等宽桶，SQL 侧用 FLOOR(UNIX_TIMESTAMP(c_time) / 桶宽度) 分组聚合。
 * 用 Math.ceil 保证桶数不会超过 pointLimit（宁可略少，不会超）。
 * 范围内数据本来就稀疏（比如选"5分钟"只有几条）时，桶宽度会算出很小的值（最小 1 秒），
 * 这时候基本等于不聚合，直接展示全部原始点，这也是预期行为。
 * @param {Object} options
 * @param {string} options.startTime - 范围起点（历史图表的时间选择器保证一定有值）
 * @param {string|null} [options.endTime] - 范围终点，不传表示到当前时刻
 * @param {number} options.pointLimit - 目标桶数上限
 * @returns {number} 桶宽度（秒），最小为 1
 */
function calcBucketSeconds({ startTime, endTime, pointLimit }) {
  const start = new Date(String(startTime).replace(' ', 'T'))
  const end = endTime ? new Date(String(endTime).replace(' ', 'T')) : new Date()
  const totalSeconds = Math.max(1, (end.getTime() - start.getTime()) / 1000)
  const limit = Math.max(1, Number(pointLimit) || 300)
  return Math.max(1, Math.ceil(totalSeconds / limit))
}

module.exports = { resolveTimeRange, PRESET_MINUTES, calcBucketSeconds }
