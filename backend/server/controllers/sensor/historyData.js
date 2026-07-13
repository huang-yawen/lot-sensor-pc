const getHistoryDataByType = require('../../service/historyData/getHistoryDataByType')

// 控制器只负责接收请求、调用 service，然后返回 JSON。
module.exports = async (req, res) => {
    try {
        const payload = await getHistoryDataByType(req.query)
        res.json(payload)
    } catch (err) {
        console.error('分页查询失败:', err)
        res.status(500).json({ success: false, message: err.message })
    }
}
