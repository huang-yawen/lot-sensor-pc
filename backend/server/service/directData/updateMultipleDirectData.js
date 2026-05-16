// /service/directData/updateMultipleDirectData.js (处理 /multipleDirectData 接口)
const promisePool = require('../../config/promisepool')

module.exports = async (req, res) => {
    try {
        const { config_id, value, d_no } = req.body;
        console.log(`[Backend Update] 接收到更新请求 config_id: ${config_id}, value: ${value}, d_no: ${d_no}`);

        const final_d_no = d_no === 'null' ? null : d_no;

        let updateQuery;
        let updateParams;

        if (final_d_no === null) {
            updateQuery = `UPDATE t_direct SET value = ? WHERE config_id = ? AND d_no IS NULL`;
            updateParams = [value, config_id];
        } else {
            updateQuery = `UPDATE t_direct SET value = ? WHERE config_id = ? AND d_no = ?`;
            updateParams = [value, config_id, final_d_no];
        }

        const [updateResult] = await promisePool.query(updateQuery, updateParams);

        if (updateResult.affectedRows === 0 && final_d_no !== null) {
            const insertQuery = `
                INSERT INTO t_direct (config_id, value, d_no) 
                VALUES (?, ?, ?)
            `;
            const insertParams = [config_id, value, final_d_no];
            await promisePool.query(insertQuery, insertParams);
            console.log(`[Backend Update] 执行 INSERT: 成功插入新设备配置。`);
        } else if (updateResult.affectedRows > 0) {
            console.log(`[Backend Update] 执行 UPDATE: 成功更新现有配置。`);
        } else {
            console.warn(`[Backend Update] 未执行操作: 全局配置更新失败或无需操作。`);
        }

        res.json({ success: true, message: 'Configuration saved successfully.' });

    } catch (err) {
        console.error('Backend /multipleDirectData 错误:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}