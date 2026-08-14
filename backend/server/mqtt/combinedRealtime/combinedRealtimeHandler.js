/** 【文件职责】统一处理单条同时包含传感器字段和行为字段的 MQTT 消息。
 * 【配置中心关联】当 MQTT_TOPICS.sensor 与 MQTT_TOPICS.behavior 配置为同一个主题时，
 * mqtt/index.js 会用本处理器替代分开的 sensorRealtimeHandler/behaviorRealtimeHandler，
 * 两张表各自按自己的字段映射表（t_sensor_field_mapper/t_behavior_field_mapper）从同一条
 * 消息中挑出需要的字段落库，不需要设备分两条消息上报。 */
const { saveSensorData } = require('../sensorRealtime/sensorRealtimeRepository')
const { saveBehaviorData } = require('../behaviorRealtime/behaviorRealtimeRepository')
const { getReportedTime } = require('../../utils/protocol')
const { evaluateRules } = require('../../service/alarm/evaluateRules')

function parsePayload(payload) {
    // MQTT 载荷以 Buffer 对象到达，必须先解码为文本再解析，避免把二进制直接写库。
    try {
        return JSON.parse(payload.toString())
    } catch (err) {
        console.error('[CombinedRealtime] Failed to parse JSON:', err.message)
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
    const info = parsePayload(payload)
    if (!info) {
        return null
    }

    info.c_time = normalizeDateTime(getReportedTime(info)) || formatDateTime(new Date())

    console.log('[CombinedRealtime] Received message:', { topic, data: info })

    try {
        // 同一条消息里既有传感器字段又有行为字段，两张表各自按字段映射表挑选自己需要的字段。
        await saveSensorData(info)
        await saveBehaviorData(info)
        // 两类字段都已到齐，一次性评估告警规则即可，不必再分开各评估一次。
        const alarms = await evaluateRules(info)
        if (alarms.length) info._alarms = alarms
        return info
    } catch (err) {
        console.error('[CombinedRealtime] Error processing message:', err.message)
        return null
    }
}

module.exports = {
    handleMessage,
    normalizeDateTime
}
