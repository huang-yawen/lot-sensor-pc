const promisePool = require('../../config/dbPool')

/**
 * 添加设备记录
 * @param {Object} data - 设备数据
 * @param {string} data['设备名称'] - 设备名称
 * @param {string} data['备注'] - 备注
 * @param {string} data['创立时间'] - 创建时间
 * @param {string} data['设备编号'] - 设备编号
 * @returns {Promise<{success: boolean, message: string}>}
 */
module.exports = async (data) => {
    const deviceName = String(data['设备名称'] ?? '').trim()
    const deviceNumber = String(data['设备编号'] ?? data['电车编号id'] ?? '').trim()
    const remarks = String(data['备注'] ?? '').trim() || null
    if (!deviceName || !deviceNumber) {
        return { success: false, message: '设备名称和设备编号不能为空' }
    }

    const [[duplicate]] = await promisePool.execute(
        'SELECT id FROM `t_device` WHERE TRIM(`number`) = ? LIMIT 1',
        [deviceNumber]
    )
    if (duplicate) return { success: false, message: `设备编号“${deviceNumber}”已存在` }

    // id 使用 AUTO_INCREMENT，创建时间以数据库服务器为准，避免浏览器本地格式无法写入。
    const [result] = await promisePool.execute(
        'INSERT INTO `t_device` (device_name, remarks, ctime, number) VALUES (?, ?, NOW(), ?)',
        [deviceName, remarks, deviceNumber]
    )
    return {
        success: true,
        message: '设备添加成功',
        id: result.insertId,
        deviceName,
        deviceNumber,
    }
}
