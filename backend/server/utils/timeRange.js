/**
 * 【文件职责】历史图表时间范围解析工具。把前端传的预设档位（5m/10m/30m/1h/3h/6h/24h/custom）
 * 统一转成 SQL 能直接比较的起止时间字符串，供 cumulativeService/timeWindowService/
 * averageChartQuery 共用，保证"选不同时间范围，数据跟着正确变化"这条逻辑只写一处。
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

module.exports = { resolveTimeRange, PRESET_MINUTES }
