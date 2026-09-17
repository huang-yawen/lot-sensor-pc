/** 【文件职责】"告警记录"页面的两个查询：分页列表 + 类型饼图统计，数据都来自 t_error_msg。
 * （原来是 service/errorHistory/ 下 4 个文件：类型名对照表 + 筛选条件构造 + 两个查询，
 *  合并到这里，逻辑没变。）
 * 列表和统计必须用同一套筛选口径（下面的 buildWhere），否则饼图和表格对不上。
 * 【配置】getErrorHistory 读 DEFAULT_PAGE_SIZE（config/appSettings.js）。 */
const promisePool = require('../config/dbPool')
const { DEFAULT_PAGE_SIZE } = require('../config/appSettings')
const { FAULT_TYPES } = require('./faultStatus/faultStatus')
const { LINKAGE_RULE_NAMES } = require('./linkageRules/linkageRules')
const { SPIKE_TYPES } = require('./dataQuality/spikeFilter')
const { RELAY_TYPES } = require('./dataQuality/relayStuck')
const { INVERTED_TYPES } = require('./dataQuality/sensorInverted')
const SAFETY_CONFIG = require('./safety/config')
const DATA_QUALITY_CONFIG = require('./dataQuality/config')

/* ==================== e_no -> 中文名 对照 ==================== */

/** 故障 e_no -> 中文名，直接复用 faultStatus.js 的定义，不重复写一份。 */
const FAULT_NAMES = Object.fromEntries(FAULT_TYPES.map(f => [f.id, f.name]))

/** 数据质量板块三条规则的 e_no -> 中文名，跟故障一样直接复用板块自己导出的类型表：
 * SPIKE_TYPES 是规则一（数值跳变/毛刺），RELAY_TYPES 是规则二（继电器粘连/控制失效），
 * INVERTED_TYPES 是规则三（逆温差/传感器装反）。 */
const DATA_QUALITY_NAMES = Object.fromEntries(
  [...SPIKE_TYPES, ...RELAY_TYPES, ...INVERTED_TYPES].map(t => [t.id, t.name])
)

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
  sensor_offline: '传感器掉线',
  heater_without_pump: '未开水泵却开启加热',
}

/** category=fault（默认）只看真正的硬故障；category=safety 看安全联锁记录；
 * category=linkage 看联动控制记录；category=spike 看数据质量（跳变/毛刺）记录；
 * category=alarm 看场景配置 ALARM_RULES 触发的
 * 规则告警——这类记录不属于前三类里任何一个固定 type，见下面 buildWhere 里
 * 对 alarm 类别的处理（排除掉这里列出的固定 type，不是再列一张新清单）。 */
const CATEGORY_TYPES = {
  system: ['system'],
  intelligent: ['intelligent'],
}

/** 类别 -> "全部"视图里"类别"列和饼图显示的中文名，跟前端下拉框的选项文字一致。 */
const CATEGORY_LABELS = {
  system: '系统检测',
  intelligent: '智能判定',
}

/**
 * 反查一条记录属于哪个类别："全部"视图一次查出所有记录，要逐行判断它该归哪一类。
 * type 命中 CATEGORY_TYPES 里的固定大类就是那一类；都没命中的就是 ALARM_RULES 规则告警
 * （它的 type 是规则自己的名字，比如"循环流量过低"）——跟 buildWhere 里 alarm 的口径一致。
 * 注意安全联锁里"没配动作"的规则写库时 type 是'安全告警'，这里按 CATEGORY_TYPES 归到
 * safety，"类别"列显示"安全联锁"，不会跟 ALARM_RULES 的"安全告警"混在一起。
 */
function categoryOfType(type) {
  const hit = Object.entries(CATEGORY_TYPES).find(([, types]) => types.includes(type))
  return hit ? hit[0] : 'alarm'
}

/** 配置里 showOnErrorPage=false 的类别，"全部"视图也不带出来，跟前端下拉框隐藏选项保持一致。 */
function hiddenCategories() {
  const hidden = []
  if (SAFETY_CONFIG.showOnErrorPage === false) hidden.push('safety')
  if (DATA_QUALITY_CONFIG.showOnErrorPage === false) hidden.push('spike')
  return hidden
}

function resolveCategory(query) {
  if (query?.category === 'all') return 'all'
  if (query?.category === 'system') return 'system'
  if (query?.category === 'intelligent') return 'intelligent'
  if (query?.category === 'fault' || query?.category === 'safety' || query?.category === 'linkage' || query?.category === 'spike' || query?.category === 'alarm') return 'system'
  return 'system'
}

/** e_no 命中不了名称表时（比如历史脏数据），退回原始 type，不让记录丢分类。 */
function friendlyName(category, eNo, fallbackType) {
  // alarm 类型（evaluateRules.js 触发）写库时 type 存的就是规则自己的 name
  // （比如"循环流量偏低预警"），已经是最终显示名，不需要再按 e_no 查表转换——
  // 跟 fault/safety/linkage 只存一个笼统大类、要靠 e_no 换成具体名称不是一回事。
  if (category === 'alarm') return fallbackType || '未知类型'
  const map = category === 'safety' ? SAFETY_TRIGGER_NAMES
    : category === 'linkage' ? LINKAGE_RULE_NAMES
    : category === 'spike' ? DATA_QUALITY_NAMES
    : FAULT_NAMES
  return (eNo && map[eNo]) || fallbackType || '未知类型'
}

/* ==================== 筛选条件构造（列表 + 统计共用） ==================== */

const isValidDateTime = (dateStr) => {
    if (!dateStr) return true
    const regex = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/
    return regex.test(dateStr)
}

const validateDateRange = (startTime, endTime) => {
    if (!startTime || !endTime) return true
    return new Date(startTime) <= new Date(endTime)
}

/**
 * 按查询参数拼出 WHERE 子句和参数数组。
 * 支持的筛选：category（fault/safety/linkage/alarm，决定 type 取值范围）、keyword
 * （设备编号或记录信息模糊匹配）、startTime/endTime（按 c_time 闭区间过滤）。只为
 * 实际传入的条件拼片段。
 */
const buildWhere = (query = {}) => {
    const keyword = query.keyword?.trim() || ''
    const startTime = query.startTime || ''
    const endTime = query.endTime || ''
    const category = resolveCategory(query)
    const conditions = []
    const params = []
    if (category === 'all') {
        // 全部类别一起查，只保留系统检测与智能判定两类来源；旧的安全联锁/故障状态等
        // 统一按 source 字段映射成 system，不再按 type 大类筛选。
    } else if (category === 'system' || category === 'intelligent') {
        conditions.push('source = ?')
        params.push(category)
    } else {
        conditions.push('source = ?')
        params.push('system')
    }

    if (startTime && !isValidDateTime(startTime)) {
        throw new Error('开始时间格式不正确，应为 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS')
    }
    if (endTime && !isValidDateTime(endTime)) {
        throw new Error('结束时间格式不正确，应为 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS')
    }
    if (!validateDateRange(startTime, endTime)) {
        throw new Error('开始时间不能大于结束时间')
    }

    if (keyword) {
        conditions.push('(d_no LIKE ? OR e_msg LIKE ?)')
        params.push(`%${keyword}%`, `%${keyword}%`)
    }
    if (startTime) {
        conditions.push('c_time >= ?')
        params.push(startTime)
    }
    if (endTime) {
        conditions.push('c_time <= ?')
        params.push(endTime)
    }

    // "全部"且没有任何筛选时 conditions 是空的，不能拼出一个光秃秃的 "WHERE"（SQL 语法错误）。
    return { whereClause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

/* ==================== 分页列表查询 ==================== */

// 查询带分页的故障历史记录，支持关键字和时间筛选。
async function getErrorHistory(query) {
    const page = parseInt(query.page) || 1
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize) || DEFAULT_PAGE_SIZE))
    const offset = (page - 1) * pageSize
    const category = resolveCategory(query)
    const { whereClause, params } = buildWhere(query)

    const [rows] = await promisePool.query(
        `SELECT id,
                d_no AS '设备编号',
                CASE WHEN source = 'intelligent' THEN '智能判定' ELSE '系统检测' END AS '信息来源',
                COALESCE(error_type, type, '未知类型') AS '类型',
                e_msg AS '记录信息',
                c_time AS '报警时间'
         FROM t_error_msg
         ${whereClause}
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
    )

    const list = rows.map((row) => ({
        id: row.id,
        '设备编号': row['设备编号'],
        '信息来源': row['信息来源'],
        '类别': row['类型'],
        '类型': row['类型'],
        '记录信息': row['记录信息'],
        '报警时间': row['报警时间'],
    }))

    const countSql = `
        SELECT COUNT(*) AS total
        FROM t_error_msg
        ${whereClause}
    `
    const [countResult] = await promisePool.query(countSql, params)

    return {
        success: true,
        data: {
            list,
            total: countResult[0].total,
            page,
            size: pageSize,
        },
    }
}

/* ==================== 类型分布统计（饼图） ==================== */

// 统计故障/安全联锁的具体类型分布（按 e_no 精确区分，而不是笼统的 type 大类），供图表展示使用。
// 筛选条件跟列表查询共用 buildWhere：同样支持关键字和时间范围，保证饼图统计的就是
// 表格里筛出来的那批记录；不传时间范围时统计该类型的全部记录。
async function getErrorTypeStats(query) {
  const category = resolveCategory(query)
  const { whereClause, params } = buildWhere(query)

  const [rows] = await promisePool.query(
    `SELECT source,
            e_no,
            COALESCE(error_type, type, '未知类型') AS type,
            COUNT(*) AS count
     FROM t_error_msg
     ${whereClause}
     GROUP BY source, e_no, error_type, type`,
    params
  )

  const merged = new Map()
  for (const row of rows) {
    const typeName = row.type || '未知类型'
    const sourceName = row.source === 'intelligent' ? '智能判定' : '系统检测'
    const groupName = category === 'all' ? sourceName : typeName
    merged.set(groupName, (merged.get(groupName) || 0) + Number(row.count))
  }

  const data = [...merged.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  return {
    success: true,
    data,
    total: data.reduce((sum, item) => sum + item.count, 0),
  }
}

module.exports = { getErrorHistory, getErrorTypeStats }
