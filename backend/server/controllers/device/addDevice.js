/** 【文件职责】新增设备 API 控制器。
 * 【配置中心关联】无直接读取；设备编号影响 MQTT 在线状态匹配。 */
const addDeviceManageData = require('../../service/deviceData/addDeviceManageData')
const mqttClient = require('../../mqtt')

module.exports = async (req, res) => {
    try {
        const result = await addDeviceManageData(req.body)
        if (result.success) {
            mqttClient.registerDevice(result.deviceNumber, { id: result.id, deviceName: result.deviceName })
        }
        res.json(result)
    } catch (err) {
        console.error('添加设备失败:', err)
        res.status(500).json({
            success: false,
            message: '添加设备失败：' + err.message,
        })
    }
}
/** 【文件职责】新增设备接口：校验设备资料、写入 t_device，并刷新在线设备清单。
 * 【配置中心关联】无直接读取；设备编号字段由数据库 t_device.number 统一管理。 */
