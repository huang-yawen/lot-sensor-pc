/** 【文件职责】传感器 MQTT 子模块导出入口。
 * 【配置中心关联】由 mqtt/index.js 按 MQTT_TOPICS.sensor 接入。 */
const { SENSOR_TOPIC, handleMessage, parsePayload } = require('./sensorRealtimeHandler')
const { saveSensorData, getSensorDataByDevice } = require('./sensorRealtimeRepository')

module.exports = {
    SENSOR_TOPIC,
    handleMessage,
    parsePayload,
    saveSensorData,
    getSensorDataByDevice
}
/** 【文件职责】实时传感器 MQTT 子模块导出入口。
 * 【配置中心关联】无直接读取；由 mqtt/index.js 根据 MQTT_TOPICS.sensor 接入。 */
