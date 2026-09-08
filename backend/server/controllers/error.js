/** 【文件职责】"告警记录"页面的 2 个 HTTP 接口：分页列表 + 类型统计。
 * （原来是 controllers/error/ 下 2 个文件，合并到这里。）
 * 只做：解析 req → 调 service/errorHistory → 返回 JSON。
 * 【配置】无直接读取。 */
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
