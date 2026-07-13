const { saveBehaviorData } = require('./behaviorRealtimeRepository')

const BEHAVIOR_TOPIC = 'behavioral_data'

function parsePayload(payload) {
    // MQTT payloads arrive as Buffer objects, so decode and parse them first.
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
    if (topic !== BEHAVIOR_TOPIC) {
        return null
    }

    const info = parsePayload(payload)
    if (!info) {
        return null
    }

    info.c_time = normalizeDateTime(info.Time) || formatDateTime(new Date())

    console.log('[BehaviorRealtime] Received message:', { topic, data: info })

    try {
        await saveBehaviorData(info)
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
