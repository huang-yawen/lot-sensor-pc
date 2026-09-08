/** 【文件职责】首页仪表盘用：查询最新一条出水温度（SENSOR_FIELD_MAP.temp2）读数。
 * 【配置】SENSOR_FIELD_MAP.temp2 决定查 t_sensor_data 哪个物理字段；
 * 每次请求实时读取，跟其他模块用同一份映射，改了字段布局这里自动跟着变。 */
const promisePool = require('../../config/dbPool')
const { SENSOR_FIELD_MAP } = require('../../config/appSettings')

module.exports = async (req, res) => {
    try {
        // SENSOR_FIELD_MAP.temp2 在配置中心保存时已经校验过必须是 field1~field10
        // 这样的格式（见 systemConfig.js validate），可以安全拼进 SQL。
        const field = SENSOR_FIELD_MAP?.temp2
        if (!field) {
            return res.json({ success: true, data: null })
        }
        const [[row]] = await promisePool.query(
            `SELECT CAST(NULLIF(\`${field}\`, '') AS DECIMAL(20, 2)) AS value FROM t_sensor_data ORDER BY id DESC LIMIT 1`
        )
        res.json({ success: true, data: row?.value ?? null })
    } catch (err) {
        console.error('[CurrentTempController] 查询失败:', err)
        res.status(500).json({ success: false, message: err.message })
    }
}
