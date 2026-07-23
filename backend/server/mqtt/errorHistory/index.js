/** 【文件职责】异常 MQTT 子模块导出入口。
 * 【配置中心关联】由 mqtt/index.js 按 MQTT_TOPICS.alarm 接入。 */
const { ERROR_TOPIC, handleMessage, parsePayload } = require('./errorHistoryHandler')
const { saveErrorMsg, getErrorMsgByDevice } = require('./errorHistoryRepository')

module.exports = {
    ERROR_TOPIC,
    handleMessage,
    parsePayload,
    saveErrorMsg,
    getErrorMsgByDevice
}
/** 【文件职责】异常历史 MQTT 子模块导出入口。
 * 【配置中心关联】无直接读取；由 mqtt/index.js 依据 MQTT_TOPICS.alarm 接入。 */
