const getDeviceManageList = require('../../service/deviceData/getDeviceManageList')

// 控制器只负责接收请求、调用 service，然后返回 JSON。
module.exports = async (req, res) => {
    try {
        const payload = await getDeviceManageList(req.query)
        res.json(payload)
    } catch (err) {
        console.error('设备列表查询失败:', err)
        res.status(500).json({
            success: false,
            message: '设备列表查询失败',
            error: err.message,
        })
    }
}
