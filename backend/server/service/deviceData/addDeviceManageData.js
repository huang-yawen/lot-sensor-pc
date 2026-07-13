const promisePool = require('../../config/dbPool')

/**
 * 添加设备记录
 * @param {Object} data - 设备数据
 * @param {number} data.id - 设备ID
 * @param {string} data['设备名称'] - 设备名称
 * @param {string} data['备注'] - 备注
 * @param {string} data['创立时间'] - 创建时间
 * @param {string} data['电车编号id'] - 电车编号
 * @returns {Promise<{success: boolean, message: string}>}
 */
module.exports = async (data) => {
    await promisePool.execute(
        `INSERT INTO \`t_device\` (id, device_name, remarks, ctime, number) VALUES (?, ?, ?, ?, ?)`,
        [Number(data.id), data['设备名称'], data['备注'], data['创立时间'], data['电车编号id']]
    )
    return { success: true, message: '成功啦！' }
}