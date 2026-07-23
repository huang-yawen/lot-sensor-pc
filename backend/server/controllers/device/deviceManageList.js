/** 【文件职责】设备管理列表 API 控制器。
 * 【配置中心关联】无直接读取。 */
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
/** 【文件职责】设备列表接口，返回 t_device 的管理数据和必要展示字段。
 * 【配置中心关联】无直接读取；页面显示名称通常由配置中心的 DEVICE_LABEL 决定。 */
