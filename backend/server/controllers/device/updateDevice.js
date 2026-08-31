/** 【文件职责】更新设备 API 控制器。
 * 【配置中心关联】无直接读取；更新编号后需刷新 MQTT 设备追踪。 */
const updateDeviceManageData = require('../../service/deviceData/updateDeviceManageData')
const mqttClient = require('../../mqtt')

module.exports = async (req, res) => {
    try {
        const result = await updateDeviceManageData(req.body)
        if (result.success) {
            mqttClient.renameDevice(result.oldDNo, result.dNo, {
                id: result.id,
                deviceName: result.deviceName,
                deviceNumber: result.deviceNumber,
            })
        }
        res.json(result)
    } catch (err) {
        console.error('更新设备失败:', err)
        res.status(500).json({
            success: false,
            message: '更新设备失败：' + err.message,
        })
    }
}
/** 【文件职责】更新设备资料接口，并同步 DeviceManager 中的设备元数据。
 * 【配置中心关联】无直接读取；设备编号变更会影响后续 MQTT 心跳匹配。 */
