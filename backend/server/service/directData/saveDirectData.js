const promisePool = require('../../config/promisepool')

const normalizeDeviceNo = (dNo) => {
    if (dNo === undefined || dNo === null || dNo === 'null' || dNo === '') {
        return null
    }
    return String(dNo)
}

const saveDirectData = async ({ config_id, value, d_no }) => {
    const finalDNo = normalizeDeviceNo(d_no)

    let updateQuery
    let updateParams

    if (finalDNo === null) {
        updateQuery = `UPDATE t_direct SET value = ? WHERE config_id = ? AND d_no IS NULL`
        updateParams = [value, config_id]
    } else {
        updateQuery = `UPDATE t_direct SET value = ? WHERE config_id = ? AND d_no = ?`
        updateParams = [value, config_id, finalDNo]
    }

    const [updateResult] = await promisePool.query(updateQuery, updateParams)

    if (updateResult.affectedRows > 0) {
        return { action: 'update', d_no: finalDNo }
    }

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

    if (existingRow) {
        return { action: 'no_change', d_no: finalDNo }
    }

    if (finalDNo === null) {
        await promisePool.query(
            `INSERT INTO t_direct (config_id, value, d_no) VALUES (?, ?, NULL)`,
            [config_id, value]
        )
        return { action: 'insert', d_no: finalDNo }
    }

    if (finalDNo !== null) {
        const insertQuery = `
            INSERT INTO t_direct (config_id, value, d_no)
            VALUES (?, ?, ?)
        `
        await promisePool.query(insertQuery, [config_id, value, finalDNo])
        return { action: 'insert', d_no: finalDNo }
    }

    return { action: 'none', d_no: finalDNo }
}

module.exports = {
    normalizeDeviceNo,
    saveDirectData
}
