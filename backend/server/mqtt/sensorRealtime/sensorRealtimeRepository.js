/** 【文件职责】传感器实时/保存数据仓储层（项目里没有独立的"历史数据"概念）。
 * 【配置】无直接读取。
 * 【合并版说明】走 utils/mappedData.js 的 saveSceneData（三表同时写），本函数只处理传感器侧：
 *   - 合并表 t_scene_data：写 field1~field10，行为槽位留空、has_behavior = 0；
 *   - 旧真表 t_sensor_data：同样写一份（分开版的所有旧代码读的就是它）。 */
const promisePool = require('../../config/dbPool')
const { saveSceneData } = require('../../utils/mappedData')

// 出错时先打印一条"保存传感器数据失败"的日志，方便定位是哪一步出的问题，
// 然后把异常继续往上抛，交给调用方（combinedRealtimeHandler.js 的大 try/catch）统一处理。
async function saveSensorData(info) {
    try {
        const result = await saveSceneData({
            info,
            dateTime: info.c_time ?? null,
            withSensor: true,
            withBehavior: false,
        })
        console.log('[SensorRealtime] Data saved to database successfully:', result)
        return true
    } catch (err) {
        console.error('[SensorRealtime] Failed to save data:', err.message)
        throw err
    }
}

async function getSensorDataByDevice(limit = 100) {
    try {
        const [rows] = await promisePool.query(
            `SELECT * FROM t_sensor_data ORDER BY c_time DESC LIMIT ?`,
            [limit]
        )
        return rows
    } catch (err) {
        console.error('[SensorRealtime] Failed to query data:', err.message)
        throw err
    }
}

module.exports = {
    saveSensorData,
    getSensorDataByDevice
}
