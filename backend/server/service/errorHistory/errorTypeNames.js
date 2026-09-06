/** 【文件职责】故障 / 安全联锁 / 联动控制记录的 e_no -> 中文名称对照表，供告警历史查询和
 * 类型统计共用，避免 getErrorHistory.js / getErrorTypeStats.js 两处各维护一份、改名时漏改。
 * 【配置中心关联】无直接读取。 */
const { FAULT_TYPES } = require('../faultStatus/faultStatus')
const { LINKAGE_RULE_NAMES } = require('../linkageRules/linkageRules')

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
  flow_volatility: '流量剧烈波动（疑似水锤/湍流）',
  manual_mode: '进入手动模式（人工修复）',
  sensor_offline: '传感器掉线（无数据上报）',
  heater_without_pump: '未开水泵却开启加热',
}

/** category=fault（默认）只看真正的硬故障；category=safety 看安全联锁记录；
 * category=linkage 看联动控制记录；category=alarm 看场景配置 ALARM_RULES 触发的
 * 规则告警——这类记录不属于前三类里任何一个固定 type，见 errorQueryFilter.js 里
 * 对 alarm 类别的处理（排除掉这里列出的固定 type，不是再列一张新清单）。 */
const CATEGORY_TYPES = {
  fault: ['故障保护'],
  safety: ['安全联锁', '安全告警'],
  linkage: ['联动控制'],
}

function resolveCategory(query) {
  if (query?.category === 'safety') return 'safety'
  if (query?.category === 'linkage') return 'linkage'
  if (query?.category === 'alarm') return 'alarm'
  return 'fault'
}

/** e_no 命中不了名称表时（比如历史脏数据），退回原始 type，不让记录丢分类。 */
function friendlyName(category, eNo, fallbackType) {
  // alarm 类型（evaluateRules.js 触发）写库时 type 存的就是规则自己的 name
  // （比如"循环流量偏低预警"），已经是最终显示名，不需要再按 e_no 查表转换——
  // 跟 fault/safety/linkage 只存一个笼统大类、要靠 e_no 换成具体名称不是一回事。
  if (category === 'alarm') return fallbackType || '未知类型'
  const map = category === 'safety' ? SAFETY_TRIGGER_NAMES
    : category === 'linkage' ? LINKAGE_RULE_NAMES
    : FAULT_NAMES
  return (eNo && map[eNo]) || fallbackType || '未知类型'
}

module.exports = { CATEGORY_TYPES, resolveCategory, friendlyName }
