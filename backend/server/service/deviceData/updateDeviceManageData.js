/** 【文件职责】更新设备资料的数据访问服务。
 * 【配置中心关联】无直接读取。 */
const promisePool = require('../../config/dbPool')

/**
 * 更新设备信息
 * @param {Object} data - 设备数据
 * @param {number} data.oldId - 原设备ID
 * @param {number} data.id - 新设备ID
 * @param {string} data['设备名称'] - 设备名称
 * @param {string} data['设备编号'] - 设备编号
 * @param {string} [data['内部编号']] - 系统内部统一使用的编号（d_no），不填则跟设备编号一致
 * @param {string} [data['备注']] - 备注
 * @returns {Promise<{success: boolean, message: string}>}
 */
module.exports = async (data) => {
    const oldId = Number(data.oldId)
    const deviceName = String(data['设备名称'] ?? '').trim()
    const number = String(data['设备编号'] ?? data['电车编号id'] ?? '').trim()
    const dNo = String(data['内部编号'] ?? '').trim() || number
    const remarks = String(data['备注'] ?? '').trim() || null

    if (!Number.isInteger(oldId) || oldId <= 0) {
        return { success: false, message: 'oldId 无效' }
    }
    if (!deviceName || !number) {
        return { success: false, message: '设备名称和设备编号不能为空' }
    }
    const [[existingDevice]] = await promisePool.execute(
        'SELECT `number`, `d_no` FROM `t_device` WHERE `id` = ? LIMIT 1',
        [oldId]
    )
    if (!existingDevice) {
        return { success: false, message: '未找到该设备' }
    }

    const [[duplicate]] = await promisePool.execute(
        'SELECT id FROM `t_device` WHERE TRIM(`number`) = ? AND `id` <> ? LIMIT 1',
        [number, oldId]
    )
    if (duplicate) return { success: false, message: `设备编号“${number}”已存在` }

    const [result] = await promisePool.execute(
        `UPDATE t_device SET
            device_name = ?,
            number = ?,
            d_no = ?,
            remarks = ?
         WHERE id = ?`,
        [deviceName, number, dNo, remarks, oldId]
    )

    if (result.affectedRows === 0) {
        return { success: false, message: '未找到该设备，或数据未变化' }
    }

    return {
        success: true,
        message: '修改成功！',
        id: oldId,
        deviceName,
        oldDeviceNumber: existingDevice.number,
        deviceNumber: number,
        oldDNo: String(existingDevice.d_no ?? '').trim() || existingDevice.number,
        dNo,
    }
}
/** 【文件职责】更新设备管理资料的数据访问服务。
 * 【配置中心关联】无直接读取；编号更新后调用方需刷新 MQTT 设备追踪。 */
