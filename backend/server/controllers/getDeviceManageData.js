const promisePool = require('../config/promisepool')

module.exports = async (req, res) => {
    try {
        const input = (req.query.input || '').trim() // 去掉前后空格
        const keywordLike = `%${input}%`
            console.log('getDeviceManageData params (no pagination):', { input, keywordLike });

      
        let [deviceData] = await promisePool.query(
             `SELECT id, number AS '电车编号id', device_name AS '设备名称', 
             remarks AS '备注', ctime AS '创建时间' 
             FROM t_device
             WHERE number LIKE ? OR device_name LIKE ?
             ORDER BY id`,
                [keywordLike, keywordLike]
        );

        if ((!deviceData || deviceData.length === 0) && /\D/.test(input)) {
            console.log('no results with default LIKE, trying COLLATE fallback for input:', input);
            [deviceData] = await promisePool.query(
                `SELECT id, device_name AS '设备名称', remarks AS '备注', 
                        number AS '电车编号id', ctime AS '创建时间' 
                 FROM t_device
                 WHERE number LIKE ? OR device_name COLLATE utf8mb4_general_ci LIKE ?
                 ORDER BY id`,
                [keywordLike, keywordLike]
            );
        }

        let diagnostics = null;
        if ((!deviceData || deviceData.length === 0) && input) {
            try {
                const [samples] = await promisePool.query(
                    `SELECT id, device_name, HEX(device_name) AS name_hex, CHAR_LENGTH(device_name) AS name_len
                     FROM t_device
                     ORDER BY id
                     LIMIT 10`
                );
                diagnostics = samples;
                console.log('device name samples for diagnostics:', samples);
            } catch (diagErr) {
                console.warn('failed to fetch diagnostics samples:', diagErr.message);
            }
        }

            const total = Array.isArray(deviceData) ? deviceData.length : 0;

        const responsePayload = {
            success: true,
            data: {
                list: deviceData,
                    total
            }
        };

        // 在 debug 模式下，返回更多关于 input 的信息，便于诊断传输/编码问题
        if (req.query.debug === '1') {
            try {
                const inputHex = Buffer.from(input || '').toString('hex');
                responsePayload.receivedInput = input;
                responsePayload.receivedInputHex = inputHex;
                if (diagnostics) responsePayload.diagnostics = diagnostics;
            } catch (hexErr) {
                console.warn('failed to compute input hex:', hexErr.message);
            }
        }

        res.json(responsePayload);
    } catch (err) {
        console.error('设备查询失败:', err)
        res.status(500).json({
            success: false,
            message: '设备数据查询失败',
            error: err.message
        })
    }
}
