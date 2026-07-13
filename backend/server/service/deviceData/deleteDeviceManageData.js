const promisePool = require('../../config/dbPool')

/**
 * 根据主键删除设备记录
 * @param {Object} data - 请求数据
 * @param {number} data.id - 设备ID
 * @returns {Promise<{success: boolean}>}
 */
module.exports = async (data) => {
    const deleteId = Number(data.id)
    await promisePool.execute('DELETE FROM `t_device` WHERE `id` = ?', [deleteId])
    return { success: true }
}