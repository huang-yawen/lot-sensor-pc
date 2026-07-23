/** 【文件职责】告警 MQTT 消息处理器。
 * 【配置中心关联】MQTT_TOPICS.alarm 及协议字段配置在消息处理时生效。 */
const { saveErrorMsg } = require('./errorHistoryRepository')
const { getReportedTime, getTopic } = require('../../utils/protocol')

const ERROR_TOPIC = 'abnormal_state'

function parsePayload(payload) {
    // MQTT 载荷以 Buffer 对象到达，必须先解码为文本再解析，避免把二进制直接写库。
    try {
        return JSON.parse(payload.toString())
    } catch (err) {
        console.error('[ErrorHistory] Failed to parse JSON:', err.message)
        return null
    }
}

function formatDateTime(date) {
    const d = new Date(date)
    if (Number.isNaN(d.getTime())) {
        return null
    }

    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    const seconds = String(d.getSeconds()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function normalizeDateTime(value) {
    if (value == null || value === '') {
        return null
    }

    if (value instanceof Date || typeof value === 'number') {
        return formatDateTime(value)
    }

    if (typeof value !== 'string') {
        return null
    }

    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
        return trimmed
    }

    return formatDateTime(trimmed)
}

async function handleMessage(topic, payload) {
    if (topic !== getTopic('alarm')) {
        return null
    }

    const info = parsePayload(payload)
    if (!info) {
        return null
    }

    info.c_time = normalizeDateTime(getReportedTime(info)) || formatDateTime(new Date())

    console.log('[ErrorHistory] Received message:', { topic, data: info })

    try {
        await saveErrorMsg(info)
        return info
    } catch (err) {
        console.error('[ErrorHistory] Error processing message:', err.message)
        return null
    }
}

module.exports = {
    ERROR_TOPIC,
    handleMessage,
    parsePayload,
    normalizeDateTime
}
/** 【文件职责】处理异常/告警 MQTT 消息，并保存异常历史和触发后续告警逻辑。
 * 【配置中心关联】MQTT_TOPICS.alarm 决定消息来源；字段解析使用 DEVICE_ID_FIELDS、TIME_FIELDS。 */
