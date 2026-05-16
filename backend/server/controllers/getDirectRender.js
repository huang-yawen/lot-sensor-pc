const promisePool = require('../config/promisepool')

module.exports = async (req, res) => {
    try {
        const d_no = req.query.d_no;
        console.log(`[Backend Render] 接收到请求 d_no: ${d_no}`);

        let queryGlobal = `SELECT config_id, value FROM t_direct WHERE d_no IS NULL`;
        const [globalResult] = await promisePool.query(queryGlobal);

        let deviceResult = [];

        if (d_no && d_no !== 'null') {
            let queryDevice = `SELECT config_id, value FROM t_direct WHERE d_no = ?`;
            [deviceResult] = await promisePool.query(queryDevice, [d_no]);
        }

        const finalMap = new Map();

        globalResult.forEach(item => {
            finalMap.set(String(item.config_id), item.value);
        });

        deviceResult.forEach(item => {
            finalMap.set(String(item.config_id), item.value);
        });

        const finalResult = Array.from(finalMap, ([config_id, value]) => ({
            config_id: Number(config_id),
            value: value
        }));

        console.log(`[Backend Render] 全局配置项数: ${globalResult.length}, 设备特定项数: ${deviceResult.length}, 合并后项数: ${finalResult.length}`);

        res.json({ success: true, data: finalResult });

    } catch (err) {
        console.error('Backend /directRender 错误:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}