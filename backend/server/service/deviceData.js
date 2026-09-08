/** 【文件职责】设备表 t_device 的增删改查数据访问，供 controllers/device.js 调用。
 * （原来是 service/deviceData/ 下 4 个单函数文件，合并到这里，逻辑没变。）
 * 【配置】getDeviceManageList 读 DEFAULT_PAGE_SIZE（config/appSettings.js），其余不读配置。 */
const promisePool = require('../config/dbPool')
const { DEFAULT_PAGE_SIZE } = require('../config/appSettings')

/* ==================== 新增 ==================== */
/**
 * 添加设备记录
 * @param {Object} data - 设备数据
 * @param {string} data['设备名称'] - 设备名称
 * @param {string} data['备注'] - 备注
 * @param {string} data['创立时间'] - 创建时间
 * @param {string} data['设备编号'] - 设备编号（d_no，系统内部统一使用，展示给用户看的编号）
 * @param {string} [data['内部编号']] - 身份识别编号（number，MQTT 上报匹配用），不填则跟设备编号一致
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function addDeviceManageData(data) {
    const deviceName = String(data['设备名称'] ?? '').trim()
    const dNo = String(data['设备编号'] ?? data['电车编号id'] ?? '').trim()
    const deviceNumber = String(data['内部编号'] ?? '').trim() || dNo
    const remarks = String(data['备注'] ?? '').trim() || null
    if (!deviceName || !dNo) {
        return { success: false, message: '设备名称和设备编号不能为空' }
    }

    const [[duplicate]] = await promisePool.execute(
        'SELECT id FROM `t_device` WHERE TRIM(`d_no`) = ? LIMIT 1',
        [dNo]
    )
    if (duplicate) return { success: false, message: `设备编号“${dNo}”已存在` }

    // id 使用 AUTO_INCREMENT，创建时间以数据库服务器为准，避免浏览器本地格式无法写入。
    const [result] = await promisePool.execute(
        'INSERT INTO `t_device` (device_name, remarks, ctime, number, d_no) VALUES (?, ?, NOW(), ?, ?)',
        [deviceName, remarks, deviceNumber, dNo]
    )
    return {
        success: true,
        message: '设备添加成功',
        id: result.insertId,
        deviceName,
        deviceNumber,
        dNo,
    }
}

/* ==================== 删除 ==================== */
/**
 * 根据主键删除设备记录
 * @param {Object} data - 请求数据
 * @param {number} data.id - 设备ID
 * @returns {Promise<{success: boolean}>}
 */
async function deleteDeviceManageData(data) {
    const deleteId = Number(data.id)
    if (!Number.isInteger(deleteId)) {
        return { success: false, message: 'id 无效' }
    }
    const [[device]] = await promisePool.execute(
        'SELECT `number`, `d_no` FROM `t_device` WHERE `id` = ? LIMIT 1',
        [deleteId]
    )
    if (!device) return { success: false, message: '未找到该设备' }

    const [result] = await promisePool.execute('DELETE FROM `t_device` WHERE `id` = ?', [deleteId])
    const dNo = String(device.d_no ?? '').trim() || device.number
    return { success: result.affectedRows > 0, deviceNumber: device.number, dNo }
}

/* ==================== 更新 ==================== */
/**
 * 更新设备信息
 * @param {Object} data - 设备数据
 * @param {number} data.oldId - 原设备ID
 * @param {number} data.id - 新设备ID
 * @param {string} data['设备名称'] - 设备名称
 * @param {string} data['设备编号'] - 设备编号（d_no，系统内部统一使用，展示给用户看的编号）
 * @param {string} [data['内部编号']] - 身份识别编号（number，MQTT 上报匹配用），不填则跟设备编号一致
 * @param {string} [data['备注']] - 备注
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function updateDeviceManageData(data) {
    const oldId = Number(data.oldId)
    const deviceName = String(data['设备名称'] ?? '').trim()
    const dNo = String(data['设备编号'] ?? data['电车编号id'] ?? '').trim()
    const number = String(data['内部编号'] ?? '').trim() || dNo
    const remarks = String(data['备注'] ?? '').trim() || null

    if (!Number.isInteger(oldId) || oldId <= 0) {
        return { success: false, message: 'oldId 无效' }
    }
    if (!deviceName || !dNo) {
        return { success: false, message: '设备名称和设备编号不能为空' }
    }
    const [[existingDevice]] = await promisePool.execute(
        'SELECT `number`, `d_no` FROM `t_device` WHERE `id` = ? LIMIT 1',
        [oldId]
    )
    if (!existingDevice) {
        return { success: false, message: '未找到该设备' }
    }

    const [[duplicate]] = await promisePool.execute(
        'SELECT id FROM `t_device` WHERE TRIM(`d_no`) = ? AND `id` <> ? LIMIT 1',
        [dNo, oldId]
    )
    if (duplicate) return { success: false, message: `设备编号“${dNo}”已存在` }

    const [result] = await promisePool.execute(
        `UPDATE t_device SET
            device_name = ?,
            number = ?,
            d_no = ?,
            remarks = ?
         WHERE id = ?`,
        [deviceName, number, dNo, remarks, oldId]
    )

    if (result.affectedRows === 0) {
        return { success: false, message: '未找到该设备，或数据未变化' }
    }

    return {
        success: true,
        message: '修改成功！',
        id: oldId,
        deviceName,
        oldDeviceNumber: existingDevice.number,
        deviceNumber: number,
        oldDNo: String(existingDevice.d_no ?? '').trim() || existingDevice.number,
        dNo,
    }
}

/* ==================== 列表查询 ==================== */
const buildDeviceQuery = (searchMode, keywordLike, useCollate = false) => {
    if (searchMode === 'deviceName') {
        return {
            where: useCollate
                ? 'device_name COLLATE utf8mb4_general_ci LIKE ?'
                : 'device_name LIKE ?',
            params: [keywordLike],
        }
    }

    return {
        where: useCollate
            ? 'd_no LIKE ? OR device_name COLLATE utf8mb4_general_ci LIKE ?'
            : 'd_no LIKE ? OR device_name LIKE ?',
        params: [keywordLike, keywordLike],
    }
}

// 查询设备列表，并保留一个简单的模糊匹配降级逻辑。
async function getDeviceManageList(query) {
    const input = (query.input || '').trim()
    const searchMode = query.searchMode || 'all'
    const keywordLike = `%${input}%`

    // 分页参数
    const currentPage = Math.max(1, parseInt(query.currentPage, 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE))
    const offset = (currentPage - 1) * pageSize

    const queryFields = buildDeviceQuery(searchMode, keywordLike)

    // 先查总数
    const [[{ total }]] = await promisePool.query(
        `SELECT COUNT(*) AS total
         FROM t_device
         WHERE ${queryFields.where}`,
        queryFields.params
    )

    let [deviceData] = await promisePool.query(
        `SELECT id, d_no AS '设备编号', number AS '内部编号', device_name AS '设备名称',
                remarks AS '备注', ctime AS '创建时间'
         FROM t_device
         WHERE ${queryFields.where}
         ORDER BY id
         LIMIT ? OFFSET ?`,
        [...queryFields.params, pageSize, offset]
    )

    if ((!deviceData || deviceData.length === 0) && /\D/.test(input)) {
        // 如果默认匹配没有结果，再尝试更宽松的排序规则。
        const fallbackFields = buildDeviceQuery(searchMode, keywordLike, true)
        ;[deviceData] = await promisePool.query(
            `SELECT id, device_name AS '设备名称',
                    remarks AS '备注',
                    d_no AS '设备编号', number AS '内部编号', ctime AS '创建时间'
             FROM t_device
             WHERE ${fallbackFields.where}
             ORDER BY id
             LIMIT ? OFFSET ?`,
            [...fallbackFields.params, pageSize, offset]
        )
    }

    let diagnostics = null
    if ((!deviceData || deviceData.length === 0) && input) {
        // 方便排查数据库里到底存了什么，返回少量样本信息。
        try {
            const [samples] = await promisePool.query(
                `SELECT id, device_name, HEX(device_name) AS name_hex, CHAR_LENGTH(device_name) AS name_len
                 FROM t_device
                 ORDER BY id
                 LIMIT 10`
            )
            diagnostics = samples
        } catch (diagErr) {
            console.warn('failed to fetch diagnostics samples:', diagErr.message)
        }
    }

    const responsePayload = {
        success: true,
        data: {
            list: deviceData,
            total,
            currentPage,
            pageSize,
        },
    }

    if (query.debug === '1') {
        try {
            responsePayload.receivedInput = input
            responsePayload.receivedInputHex = Buffer.from(input || '').toString('hex')
            if (diagnostics) responsePayload.diagnostics = diagnostics
        } catch (hexErr) {
            console.warn('failed to compute input hex:', hexErr.message)
        }
    }

    return responsePayload
}

module.exports = {
    addDeviceManageData,
    deleteDeviceManageData,
    updateDeviceManageData,
    getDeviceManageList,
}
