const promisePool = require('../../config/dbPool')

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
            ? 'number LIKE ? OR device_name COLLATE utf8mb4_general_ci LIKE ?'
            : 'number LIKE ? OR device_name LIKE ?',
        params: [keywordLike, keywordLike],
    }
}

// 查询设备列表，并保留一个简单的模糊匹配降级逻辑。
module.exports = async function getDeviceManageList(query) {
    const input = (query.input || '').trim()
    const searchMode = query.searchMode || 'all'
    const keywordLike = `%${input}%`

    // 分页参数
    const currentPage = Math.max(1, parseInt(query.currentPage, 10) || 1)
    const pageSize = Math.max(1, parseInt(query.pageSize, 10) || 5)
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
        `SELECT id, number AS '设备编号', device_name AS '设备名称',
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
                    number AS '设备编号', ctime AS '创建时间'
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
