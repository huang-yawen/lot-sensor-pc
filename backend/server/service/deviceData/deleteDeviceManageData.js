const promisePool = require('../../config/dbPool')

/**
 * 根据主键删除设备记录
 * @param {Object} data - 请求数据
 * @param {number} data.id - 设备ID
 * @returns {Promise<{success: boolean}>}
 */
module.exports = async (data) => {
    const deleteId = Number(data.id)
    if (!Number.isInteger(deleteId)) {
        return { success: false, message: 'id 无效' }
    }
    const [[device]] = await promisePool.execute(
        'SELECT `number` FROM `t_device` WHERE `id` = ? LIMIT 1',
        [deleteId]
    )
    if (!device) return { success: false, message: '未找到该设备' }

    const [result] = await promisePool.execute('DELETE FROM `t_device` WHERE `id` = ?', [deleteId])
    return { success: result.affectedRows > 0, deviceNumber: device.number }
}
