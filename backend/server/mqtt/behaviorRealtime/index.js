/** 【文件职责】行为 MQTT 子模块导出入口。
 * 【配置中心关联】由 mqtt/index.js 按 MQTT_TOPICS.behavior 接入。 */
const { BEHAVIOR_TOPIC, handleMessage, parsePayload } = require('./behaviorRealtimeHandler')
const { saveBehaviorData, getBehaviorDataByDevice } = require('./behaviorRealtimeRepository')

module.exports = {
    BEHAVIOR_TOPIC,
    handleMessage,
    parsePayload,
    saveBehaviorData,
    getBehaviorDataByDevice
}
/** 【文件职责】行为实时 MQTT 子模块导出入口。
 * 【配置中心关联】无直接读取；由 mqtt/index.js 按 MQTT_TOPICS.behavior 调用。 */
