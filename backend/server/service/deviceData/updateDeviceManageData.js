const promisePool = require('../../config/dbPool')

/**
 * 更新设备信息
 * @param {Object} data - 设备数据
 * @param {number} data.oldId - 原设备ID
 * @param {number} data.id - 新设备ID
 * @param {string} data['设备名称'] - 设备名称
 * @param {string} data['电车编号id'] - 电车编号
 * @param {string} [data['备注']] - 备注
 * @returns {Promise<{success: boolean, message: string}>}
 */
module.exports = async (data) => {
    const oldId = Number(data.oldId)
    const newId = Number(data.id)
    const deviceName = data['设备名称'] ?? ''
    const number = data['电车编号id'] ?? ''
    const remarks = data['备注'] ?? null

    if (isNaN(oldId)) {
        return { success: false, message: 'oldId 无效' }
    }
    if (!deviceName || !number) {
        return { success: false, message: '设备名称和电车编号id 不能为空' }
    }
    if (!Number.isInteger(newId)) {
        return { success: false, message: 'id 无效' }
    }

    const [[existingDevice]] = await promisePool.execute(
        'SELECT `number` FROM `t_device` WHERE `id` = ? LIMIT 1',
        [oldId]
    )
    if (!existingDevice) {
        return { success: false, message: '未找到该设备' }
    }

    const [result] = await promisePool.execute(
        `UPDATE t_device SET 
            device_name = ?, 
            number = ?,
            remarks = ?,
            id = ?
         WHERE id = ?`,
        [deviceName, number, remarks, newId, oldId]
    )

    if (result.affectedRows === 0) {
        return { success: false, message: '未找到该设备，或数据未变化' }
    }

    return {
        success: true,
        message: '修改成功！',
        oldDeviceNumber: existingDevice.number,
        deviceNumber: String(number).trim(),
    }
}
