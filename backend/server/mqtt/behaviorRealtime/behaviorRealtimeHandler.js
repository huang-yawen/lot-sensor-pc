/** 【文件职责】行为 MQTT 消息处理器。
 * 【配置中心关联】DEVICE_ID_FIELDS、TIME_FIELDS 由协议工具动态读取。 */
const { saveBehaviorData } = require('./behaviorRealtimeRepository')
const { getReportedTime, getTopic } = require('../../utils/protocol')
const { evaluateRules } = require('../../service/alarm/evaluateRules')

const BEHAVIOR_TOPIC = 'behavioral_data'

function parsePayload(payload) {
    // MQTT 载荷以 Buffer 对象到达，必须先解码为文本再解析，避免把二进制直接写库。
    try {
        return JSON.parse(payload.toString())
    } catch (err) {
        console.error('[BehaviorRealtime] Failed to parse JSON:', err.message)
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
    if (topic !== getTopic('behavior')) {
        return null
    }

    const info = parsePayload(payload)
    if (!info) {
        return null
    }

    info.c_time = normalizeDateTime(getReportedTime(info)) || formatDateTime(new Date())

    console.log('[BehaviorRealtime] Received message:', { topic, data: info })

    try {
        await saveBehaviorData(info)
        const alarms = await evaluateRules(info)
        if (alarms.length) info._alarms = alarms
        return info
    } catch (err) {
        console.error('[BehaviorRealtime] Error processing message:', err.message)
        return null
    }
}

module.exports = {
    BEHAVIOR_TOPIC,
    handleMessage,
    parsePayload,
    normalizeDateTime
}
/** 【文件职责】处理行为/运行状态 MQTT 消息：解析、校验并交给仓储层落库。
 * 【配置中心关联】DEVICE_ID_FIELDS、TIME_FIELDS 通过协议工具解析，配置热更新后新消息立即采用新规则。 */
