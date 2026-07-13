const getErrorHistory = require('../../service/errorHistory/getErrorHistory')

// 控制器只负责接收请求、调用 service，然后返回 JSON。
module.exports = async (req, res) => {
    try {
        const payload = await getErrorHistory(req.query)
        res.json(payload)
    } catch (err) {
        console.error('错误历史查询出错:', err)
        res.status(500).json({
            success: false,
            message: '错误数据查询失败',
        })
    }
}
