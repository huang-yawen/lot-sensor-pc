const promisePool = require('../../config/dbPool')
const { saveMappedData } = require('../../utils/mappedData')

async function saveSensorData(info) {
    try {
        const result = await saveMappedData({
            table: 't_sensor_data',
            mapperTable: 't_sensor_field_mapper',
            info,
            dateTime: info.c_time ?? null,
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
