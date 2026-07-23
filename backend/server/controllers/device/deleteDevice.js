/** 【文件职责】删除设备 API 控制器。
 * 【配置中心关联】无直接读取；删除后会同步运行时设备状态。 */
const deleteDeviceManageData = require('../../service/deviceData/deleteDeviceManageData')
const mqttClient = require('../../mqtt')

module.exports = async (req, res) => {
    try {
        const result = await deleteDeviceManageData(req.body)
        if (result.success) mqttClient.removeDevice(result.deviceNumber)
        res.json(result)
    } catch (err) {
        console.error('删除设备失败:', err)
        res.status(500).json({
            success: false,
            message: '删除设备失败：' + err.message,
        })
    }
}
/** 【文件职责】删除设备接口：删除数据库记录并让 DeviceManager 停止追踪该设备。
 * 【配置中心关联】无直接读取；删除后离线缓存指令也不应再面向该设备发送。 */
