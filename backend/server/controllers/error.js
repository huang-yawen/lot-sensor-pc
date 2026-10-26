/**
 * 【文件职责】"告警记录"（故障记录）页面的 3 个 HTTP 接口。业务/SQL 在 service/errorHistory.js（读 t_error_msg）。
 * 前端 useErrorStore 调这些。三个接口用同一套筛选口径（service/errorHistory.js 的 buildWhere）。
 *
 *  GET /api/errData       getErrorHistory    分页列表
 *    query {
 *      category?  'all' | 'system' | 'intelligent'（默认 system；旧值 fault/safety/linkage/alarm/spike 也接受，一律当 system）
 *      type?      **具体类型**，如 "传感器掉线" / "干烧" / "管路堵塞"；不传=不按类型筛
 *                 （取值列表来自 GET /api/errTypes，比较口径 = COALESCE(error_type, type, '未知类型')）
 *      keyword?   设备编号或记录信息模糊匹配
 *      startTime? / endTime?  按报警时间闭区间
 *      page?=1, pageSize?(≤100)
 *    }
 *    → { success:true, data:{ list:[{ id, 设备编号, 信息来源, 类型, 记录信息, 报警时间 }...], total, page, size } }
 *
 *  GET /api/errTypeStats  getErrorTypeStats  类型分布（饼图），筛选参数同 errData（无分页）
 *    → { success:true, data:[{ type:中文名, count }...], total }
 *      category=all 时按"信息来源"统计（系统检测/智能判定）；其它 category 按具体类型统计
 *
 *  GET /api/errTypes      getErrorTypes      **"类型"下拉框的选项列表**（本条是为新增的类型筛选加的）
 *    query { category? 'all' | 'system' | 'intelligent' }
 *    → { success:true, data:[{ type:'传感器掉线', count:3395 }, ...], total }  按条数从多到少
 *    特点：**不带** keyword / startTime / endTime / type 筛选 —— 不管当前筛成什么样，
 *          下拉框始终列出该来源下全部可选类型，选了一个还能切到别的。
 *
 *  三个接口出错都是 500 { success:false, message }。
 * 【配置】getErrorHistory 读 DEFAULT_PAGE_SIZE（config/appSettings.js）。
 */
const { getErrorHistory: queryErrorHistory, getErrorTypeStats: queryErrorTypeStats, getErrorTypes: queryErrorTypes } = require('../service/errorHistory')

// GET /api/errData —— 分页故障历史
async function getErrorHistory(req, res) {
    try {
        res.json(await queryErrorHistory(req.query))
    } catch (err) {
        console.error('错误历史查询出错:', err)
        res.status(500).json({ success: false, message: '错误数据查询失败' })
    }
}

// GET /api/errTypeStats —— 类型分布统计（饼图）
async function getErrorTypeStats(req, res) {
    try {
        res.json(await queryErrorTypeStats(req.query))
    } catch (err) {
        console.error('故障类型统计查询出错:', err)
        res.status(500).json({ success: false, message: '故障类型统计查询失败' })
    }
}

// GET /api/errTypes —— "类型"下拉框的选项列表（按来源给全部可选类型 + 各自条数）
async function getErrorTypes(req, res) {
    try {
        res.json(await queryErrorTypes(req.query))
    } catch (err) {
        console.error('故障类型选项查询出错:', err)
        res.status(500).json({ success: false, message: '故障类型选项查询失败' })
    }
}

module.exports = { getErrorHistory, getErrorTypeStats, getErrorTypes }
