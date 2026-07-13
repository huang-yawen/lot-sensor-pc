const addDeviceManageData = require('../../service/deviceData/addDeviceManageData')

module.exports = async (req, res) => {
    try {
        const result = await addDeviceManageData(req.body)
        res.json(result)
    } catch (err) {
        console.error('添加设备失败:', err)
        res.status(500).json({
            success: false,
            message: '添加设备失败：' + err.message,
        })
    }
}