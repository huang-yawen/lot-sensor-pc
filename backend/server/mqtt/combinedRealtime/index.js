/** 【文件职责】合并主题 MQTT 子模块导出入口。
 * 【配置中心关联】仅当 MQTT_TOPICS.sensor === MQTT_TOPICS.behavior 时由 mqtt/index.js 接入。 */
const { handleMessage, normalizeDateTime } = require('./combinedRealtimeHandler')

module.exports = {
    handleMessage,
    normalizeDateTime
}
