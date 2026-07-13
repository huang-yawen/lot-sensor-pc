const deleteDeviceManageData = require('../../service/deviceData/deleteDeviceManageData')

module.exports = async (req, res) => {
    try {
        const result = await deleteDeviceManageData(req.body)
        res.json(result)
    } catch (err) {
        console.error('删除设备失败:', err)
        res.status(500).json({
            success: false,
            message: '删除设备失败：' + err.message,
        })
    }
}