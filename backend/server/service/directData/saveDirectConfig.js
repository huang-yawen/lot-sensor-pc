/**
 * 配置数据持久化服务
 * 负责将设备配置保存到数据库，支持更新和插入操作
 */

const promisePool = require('../../config/dbPool')

/**
 * 标准化设备编号
 * 将空值、null、'null'字符串统一转换为数据库NULL
 * @param {string|number|null} dNo - 设备编号
 * @returns {string|null} 标准化后的设备编号
 */
const normalizeDeviceNo = (dNo) => {
    if (dNo === undefined || dNo === null || dNo === 'null' || dNo === '') {
        return null
    }
    return String(dNo)
}

/**
 * 保存配置数据到数据库
 * 优先更新已存在的配置，不存在则插入新记录
 * @param {Object} params - 参数对象
 * @param {number} params.config_id - 配置项ID
 * @param {*} params.value - 配置值
 * @param {string|null} params.d_no - 设备编号（全局配置时为null）
 * @returns {Object} 操作结果
 */
const saveDirectData = async ({ config_id, value, d_no }) => {
    const finalDNo = normalizeDeviceNo(d_no)

    let updateQuery
    let updateParams

    // 1. 先尝试更新已有配置
    if (finalDNo === null) {
        // 全局配置：匹配 config_id 且 d_no IS NULL
        updateQuery = `UPDATE t_direct SET value = ? WHERE config_id = ? AND d_no IS NULL`
        updateParams = [value, config_id]
    } else {
        // 设备专属配置：匹配 config_id 和 d_no
        updateQuery = `UPDATE t_direct SET value = ? WHERE config_id = ? AND d_no = ?`
        updateParams = [value, config_id, finalDNo]
    }

    const [updateResult] = await promisePool.query(updateQuery, updateParams)

    // 更新成功
    if (updateResult.affectedRows > 0) {
        return { action: 'update', d_no: finalDNo }
    }

    // 2. 更新失败，检查记录是否存在（用于处理并发场景）
    let existsQuery
    let existsParams

    if (finalDNo === null) {
        existsQuery = `SELECT id FROM t_direct WHERE config_id = ? AND d_no IS NULL LIMIT 1`
        existsParams = [config_id]
    } else {
        existsQuery = `SELECT id FROM t_direct WHERE config_id = ? AND d_no = ? LIMIT 1`
        existsParams = [config_id, finalDNo]
    }

    const [[existingRow]] = await promisePool.query(existsQuery, existsParams)

    // 记录已存在但未更新成功（并发场景）
    if (existingRow) {
        return { action: 'no_change', d_no: finalDNo }
    }

    // 3. 记录不存在，插入新记录
    if (finalDNo === null) {
        await promisePool.query(
            `INSERT INTO t_direct (config_id, value, d_no) VALUES (?, ?, NULL)`,
            [config_id, value]
        )
        return { action: 'insert', d_no: finalDNo }
    }

    // 设备专属配置插入
    const insertQuery = `
        INSERT INTO t_direct (config_id, value, d_no)
        VALUES (?, ?, ?)
    `
    await promisePool.query(insertQuery, [config_id, value, finalDNo])
    return { action: 'insert', d_no: finalDNo }
}

module.exports = {
    normalizeDeviceNo,
    saveDirectData
}