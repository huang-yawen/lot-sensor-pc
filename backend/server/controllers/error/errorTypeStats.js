/** 【文件职责】异常类型统计 API 控制器。
 * 【配置中心关联】无直接读取。 */
const getErrorTypeStats = require('../../service/errorHistory/getErrorTypeStats')

// 控制器只负责接收请求、调用 service，然后返回 JSON。
module.exports = async (req, res) => {
    try {
        const payload = await getErrorTypeStats(req.query)
        res.json(payload)
    } catch (err) {
        console.error('故障类型统计查询出错:', err)
        res.status(500).json({
            success: false,
            message: '故障类型统计查询失败',
        })
    }
}
/** 【文件职责】异常类型统计接口，为仪表盘或图表提供聚合结果。
 * 【配置中心关联】无直接读取；统计对象来自已保存的异常历史。 */
