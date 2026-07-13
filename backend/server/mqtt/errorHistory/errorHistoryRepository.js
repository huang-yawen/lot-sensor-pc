const promisePool = require('../../config/dbPool')

const WARNING_FIELDS = {
    humi_warn: '湿度',
    smog_warn: '烟雾',
    fan_warn: '风机',
    air_warn: '空调',
    outage_overtime: '电源'
}

function buildErrorType(info) {
    const types = []
    for (const [key, label] of Object.entries(WARNING_FIELDS)) {
        if (info[key] == 1) {
            types.push(label+'异常')
        }
    }
    return types.join(',')
}

function buildErrorMessage(info) {
    const messages = []
    for (const [key, label] of Object.entries(WARNING_FIELDS)) {
        const value = info[key]
        if (value != null && value !== '') {
            messages.push(value == 1 ? label+'异常' : `${label}正常`)
        }
    }
    return messages.join('，')
}

async function saveErrorMsg(info) {
    const params = [
        '202177',
        info.Time ?? null,
        buildErrorMessage(info),
        info.e_no ?? info.error_no ?? null,
        buildErrorType(info),
    ]

    try {
        await promisePool.execute(
            `INSERT INTO t_error_msg (d_no, c_time, e_msg, e_no, type) VALUES (?, ?, ?, ?, ?)`,
            params
        )
        console.log('[ErrorHistory] Data saved to database successfully')
        return true
    } catch (err) {
        console.error('[ErrorHistory] Failed to save data:', err.message)
        throw err
    }
}

async function getErrorMsgByDevice(limit = 100) {
    try {
        const [rows] = await promisePool.query(
            `SELECT * FROM t_error_msg ORDER BY c_time DESC LIMIT ?`,
            [limit]
        )
        return rows
    } catch (err) {
        console.error('[ErrorHistory] Failed to query data:', err.message)
        throw err
    }
}

module.exports = {
    saveErrorMsg,
    getErrorMsgByDevice
}
