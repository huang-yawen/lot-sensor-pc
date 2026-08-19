/** 【文件职责】异常历史数据仓储层。
 * 【配置中心关联】无直接读取。 */
const promisePool = require('../../config/dbPool')
const { getReportedTime } = require('../../utils/protocol')
const { resolveDeviceNo } = require('../../utils/mappedData')
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

async function saveErrorMsg(info) {
    // 设备编号必须能在 t_device.number 匹配上（见 utils/mappedData.js resolveDeviceNo），
    // 匹配不上就跳过保存，不再兜底成数据库里第一个设备。
    const deviceNo = await resolveDeviceNo(info)
    if (!deviceNo) {
        console.warn('[ErrorHistory] 设备编号未匹配已注册设备，跳过保存')
        return false
    }
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
/** 【文件职责】异常历史仓储层，封装异常记录的数据库读写。
 * 【配置中心关联】无直接读取；只保存上游已解析的业务数据。 */
