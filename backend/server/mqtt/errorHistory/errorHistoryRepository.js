const promisePool = require('../../config/dbPool')
const { getDeviceNo: getConfiguredDeviceNo, getReportedTime } = require('../../utils/protocol')
const systemConfig = require('../../config/systemConfig')

function warningFields() {
    return systemConfig.getConfig().ALARM_FIELD_MAP || {}
}

function buildErrorType(info) {
    if (info.type) return String(info.type)
    const types = []
    for (const [key, label] of Object.entries(warningFields())) {
        if (info[key] == 1) {
            types.push(label+'异常')
        }
    }
    return types.join(',')
}

function buildErrorMessage(info) {
    if (info.e_msg || info.message) return String(info.e_msg || info.message)
    const messages = []
    for (const [key, label] of Object.entries(warningFields())) {
        const value = info[key]
        if (value != null && value !== '') {
            messages.push(value == 1 ? label+'异常' : `${label}正常`)
        }
    }
    return messages.join('，')
}

async function getDeviceNo(info) {
    const reported = getConfiguredDeviceNo(info)
    if (reported !== undefined && reported !== null && String(reported).trim()) {
        return String(reported).trim()
    }

    const [rows] = await promisePool.query(
        'SELECT `number` FROM `t_device` ORDER BY `id` ASC LIMIT 1'
    )
    return rows.length > 0 ? String(rows[0].number).trim() : null
}

async function saveErrorMsg(info) {
    const deviceNo = await getDeviceNo(info)
    const params = [
        deviceNo,
        info.c_time ?? getReportedTime(info) ?? null,
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
