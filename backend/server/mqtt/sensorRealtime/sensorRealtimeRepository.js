const promisePool = require('../../config/dbPool')

async function saveSensorData(info) {
    // Map MQTT fields into the sensor history table.
    const params = [
        info.VID ?? null,
        info.PID ?? null,
        info.Tin ?? null,
        info.Tout ?? null,
        info.LXin ?? null,
        info.c_time ?? null,
        // 先转成字符串，去掉两边空格，再进行比对；同时兼容布尔值 true
        (String(info.online).trim() === '1' || info.online === true) ? '实时数据' : '保存数据'
    ]

    try {
        await promisePool.execute(
            `INSERT INTO t_sensor_data (d_no, pid,field1, field2, field3, c_time, online) VALUES (?, ?, ?, ?,?, ?,?)`,
            params
        )
        console.log('[SensorRealtime] Data saved to database successfully')
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
