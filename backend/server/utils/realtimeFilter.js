/** 【文件职责】把前端"实时数据/保存数据"筛选值换算成基于最新记录的 SQL 条件。
 * 不再依赖设备上报时自带的 online 字段（新设备的上报数据里可能根本没有这个字段），
 * 实时数据固定等于该表当前最新的 N 条记录（按自增 id 排序），历史数据就是除了这
 * N 条记录之外的其余记录。
 * 【配置中心关联】无直接读取。 */

const REALTIME_LABEL = '实时数据'
const HISTORY_LABEL = '保存数据'
// 实时页面（传感器/行为的实时数据页、下拉框、图表）统一展示最新这么多条。
const REALTIME_WINDOW = 5

/**
 * @param {string} table - 数据表名（调用方传入的固定字符串，不接受外部输入，避免拼接注入）
 * @param {string} [onlineFilter] - 前端传入的筛选值：'实时数据' | '保存数据' | 其他/空
 * @returns {{ whereClause: string, dataTypeExpr: string, isLatest: string }}
 *   whereClause  - 拼在 SQL 里的 WHERE 片段（可能为空字符串，表示不筛选）
 *   dataTypeExpr - 可作为查询列使用的表达式，等价于原来的 "online AS 数据类型"
 *   isLatest     - 判断某一行是否落在最新 N 条窗口内的裸条件，供需要自定义拼接的调用方使用
 */
function buildRecencyFilter(table, onlineFilter) {
    const latestIdsExpr = `(SELECT id FROM (SELECT id FROM ${table} ORDER BY id DESC LIMIT ${REALTIME_WINDOW}) AS recent_${table})`
    const isLatest = `id IN ${latestIdsExpr}`
    const dataTypeExpr = `IF(${isLatest}, '${REALTIME_LABEL}', '${HISTORY_LABEL}')`

    let whereClause = ''
    if (onlineFilter === REALTIME_LABEL) {
        whereClause = ` WHERE ${isLatest}`
    } else if (onlineFilter === HISTORY_LABEL) {
        whereClause = ` WHERE id NOT IN ${latestIdsExpr}`
    }

    return { whereClause, dataTypeExpr, isLatest }
}

module.exports = { buildRecencyFilter, REALTIME_LABEL, HISTORY_LABEL, REALTIME_WINDOW }
