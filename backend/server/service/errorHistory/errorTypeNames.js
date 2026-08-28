/** 【文件职责】故障 / 安全联锁记录的 e_no -> 中文名称对照表，供告警历史查询和类型统计
 * 共用，避免 getErrorHistory.js / getErrorTypeStats.js 两处各维护一份、改名时漏改。
 * 【配置中心关联】无直接读取。 */
const { FAULT_TYPES } = require('../faultStatus/faultStatus')

/** 故障 e_no -> 中文名，直接复用 faultStatus.js 的定义，不重复写一份。 */
const FAULT_NAMES = Object.fromEntries(FAULT_TYPES.map(f => [f.id, f.name]))

/**
 * 安全联锁 e_no -> 中文名。safetyInterlock.js 里的触发条件是内联写在函数里的，没有像
 * FAULT_TYPES 那样导出一张表，这里单独维护一份；改动 safetyInterlock.js 的触发文案时
 * 要记得同步这里。
 */
const SAFETY_TRIGGER_NAMES = {
  flow_low: '流量异常（低于下限/为0/掉线）',
  pressure_high: '压力异常（高于上限/为0/掉线）',
  temp_high: '任一温度高于上限',
  temp_diff: '温差过大',
  manual_mode: '进入手动模式（人工修复）',
  sensor_offline: '传感器掉线（无数据上报）',
  heater_without_pump: '未开水泵却开启加热',
}

/** category=fault（默认）只看真正的硬故障；category=safety 看安全联锁记录，两者互不混淆。 */
const CATEGORY_TYPES = {
  fault: ['故障保护'],
  safety: ['安全联锁', '安全告警'],
}

function resolveCategory(query) {
  return query?.category === 'safety' ? 'safety' : 'fault'
}

/** e_no 命中不了名称表时（比如历史脏数据），退回原始 type，不让记录丢分类。 */
function friendlyName(category, eNo, fallbackType) {
  const map = category === 'safety' ? SAFETY_TRIGGER_NAMES : FAULT_NAMES
  return (eNo && map[eNo]) || fallbackType || '未知类型'
}

module.exports = { CATEGORY_TYPES, resolveCategory, friendlyName }
