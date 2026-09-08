/**
 * 【文件职责】"故障记录"页面的 2 个 HTTP 接口。业务/SQL 在 service/errorHistory.js（读 t_error_msg）。
 * 前端 ErrorStore 调这些。两个接口用同一套筛选参数、同一套 e_no→中文名 转换。
 *
 *  GET /api/errData       getErrorHistory   分页列表
 *    query { category?('fault'|'safety'|'linkage'|'alarm'，默认 fault), keyword?, startTime?, endTime?, page?=1, pageSize? }
 *    → { success:true, data:{ list:[{ id, 设备编号, 记录信息, 报警时间, 类型 }...], total, page, size } }
 *  GET /api/errTypeStats  getErrorTypeStats 类型分布（饼图），筛选参数同上（无分页）
 *    → { success:true, data:[{ type:中文名, count }...], total }
 *
 *  出错 500 { success:false, message }。
 * 【配置】无直接读取。
 */
const { getErrorHistory: queryErrorHistory, getErrorTypeStats: queryErrorTypeStats } = require('../service/errorHistory')

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

module.exports = { getErrorHistory, getErrorTypeStats }
