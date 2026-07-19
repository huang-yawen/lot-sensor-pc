const promisePool = require('../../config/dbPool')

/**
 * 添加设备记录
 * @param {Object} data - 设备数据
 * @param {number} data.id - 设备ID
 * @param {string} data['设备名称'] - 设备名称
 * @param {string} data['备注'] - 备注
 * @param {string} data['创立时间'] - 创建时间
 * @param {string} data['设备编号'] - 设备编号
 * @returns {Promise<{success: boolean, message: string}>}
 */
module.exports = async (data) => {
    const id = Number(data.id)
    const deviceNumber = String(data['设备编号'] ?? data['电车编号id'] ?? '').trim()
    if (!Number.isInteger(id) || !deviceNumber) {
        return { success: false, message: 'id 和设备编号必须有效' }
    }
    await promisePool.execute(
        `INSERT INTO \`t_device\` (id, device_name, remarks, ctime, number) VALUES (?, ?, ?, ?, ?)`,
        [id, data['设备名称'], data['备注'], data['创立时间'], deviceNumber]
    )
    return { success: true, message: '成功啦！', deviceNumber }
}
