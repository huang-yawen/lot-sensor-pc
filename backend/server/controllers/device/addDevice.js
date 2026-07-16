const addDeviceManageData = require('../../service/deviceData/addDeviceManageData')
const mqttClient = require('../../mqtt')

module.exports = async (req, res) => {
    try {
        const result = await addDeviceManageData(req.body)
        if (result.success) mqttClient.registerDevice(result.deviceNumber)
        res.json(result)
    } catch (err) {
        console.error('添加设备失败:', err)
        res.status(500).json({
            success: false,
            message: '添加设备失败：' + err.message,
        })
    }
}
