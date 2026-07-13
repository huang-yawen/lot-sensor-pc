const updateDeviceManageData = require('../../service/deviceData/updateDeviceManageData')

module.exports = async (req, res) => {
    try {
        const result = await updateDeviceManageData(req.body)
        res.json(result)
    } catch (err) {
        console.error('更新设备失败:', err)
        res.status(500).json({
            success: false,
            message: '更新设备失败：' + err.message,
        })
    }
}