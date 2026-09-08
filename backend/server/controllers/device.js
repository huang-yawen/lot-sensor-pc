/** 【文件职责】设备管理 4 个 HTTP 接口：列表 / 新增 / 删除 / 更新。
 * （原来是 controllers/device/ 下 4 个文件，合并到这里，逻辑没变。）
 * 每个接口只做：解析 req → 调 service/deviceData → 成功时同步 mqtt 的设备追踪 → 返回 JSON。
 * 【配置】无直接读取。 */
const deviceData = require('../service/deviceData')
const mqttClient = require('../mqtt')

// GET /api/deviceData —— 设备列表（分页 + 模糊搜索）
async function getDeviceManageList(req, res) {
    try {
        const payload = await deviceData.getDeviceManageList(req.query)
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

// POST /api/deviceData/add —— 新增设备，成功后让 mqtt 开始追踪它
async function addDevice(req, res) {
    try {
        const result = await deviceData.addDeviceManageData(req.body)
        if (result.success) {
            mqttClient.registerDevice(result.dNo, { id: result.id, deviceName: result.deviceName, deviceNumber: result.deviceNumber })
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

// POST /api/deviceData/delete —— 删除设备，成功后让 mqtt 停止追踪它
async function deleteDevice(req, res) {
    try {
        const result = await deviceData.deleteDeviceManageData(req.body)
        if (result.success) mqttClient.removeDevice(result.dNo)
        res.json(result)
    } catch (err) {
        console.error('删除设备失败:', err)
        res.status(500).json({
            success: false,
            message: '删除设备失败：' + err.message,
        })
    }
}

// POST /api/deviceData/update —— 更新设备，成功后同步 mqtt 里的设备编号/元数据
async function updateDevice(req, res) {
    try {
        const result = await deviceData.updateDeviceManageData(req.body)
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

module.exports = { getDeviceManageList, addDevice, deleteDevice, updateDevice }
