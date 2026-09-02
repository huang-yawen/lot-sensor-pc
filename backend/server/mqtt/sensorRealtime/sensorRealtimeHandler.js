/** 【文件职责】传感器 MQTT 消息处理器。
 * 【配置中心关联】DEVICE_ID_FIELDS、TIME_FIELDS 等协议项在每条消息处理时读取。 */
const { saveSensorData } = require('./sensorRealtimeRepository')
const { getReportedTime, getTopic } = require('../../utils/protocol')
const { evaluateRules } = require('../../service/alarm/evaluateRules')
const { evaluateSafety } = require('../../service/safety/safetyInterlock')
const { evaluateLinkageRules } = require('../../service/linkageRules/linkageRules')
const { evaluateFaultStatus } = require('../../service/faultStatus/faultStatus')
const { evaluatePidHeating } = require('../../service/pidHeating/pidHeating')
const { evaluatePumpVelocityControl } = require('../../service/pumpVelocityControl/pumpVelocityControl')
const { evaluateQuantityShutdown } = require('../../service/quantityShutdown/quantityShutdown')
const { compute: computeMetrics } = require('../../service/computedMetrics/computedMetrics')

const SENSOR_TOPIC = 'sensor_data'

function parsePayload(payload) {
    // MQTT 载荷以 Buffer 对象到达，必须先解码为文本再解析，避免把二进制直接写库。
    try {
        return JSON.parse(payload.toString())
    } catch (err) {
        console.error('[SensorRealtime] Failed to parse JSON:', err.message)
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
    if (topic !== getTopic('sensor')) {
        return null
    }

    const info = parsePayload(payload)
    if (!info) {
        return null
    }

    info.c_time = normalizeDateTime(getReportedTime(info)) || formatDateTime(new Date())

    console.log('[SensorRealtime] Received message:', { topic, data: info })

    try {
        await saveSensorData(info)
        const alarms = await evaluateRules(info)
        if (alarms.length) info._alarms = alarms
        const safetyTriggers = await evaluateSafety(info)
        if (safetyTriggers.length) info._safetyTriggers = safetyTriggers
        const faultTriggers = await evaluateFaultStatus(info)
        if (faultTriggers.length) info._faultTriggers = faultTriggers
        const linkageActions = await evaluateLinkageRules(info)
        if (linkageActions.length) info._linkageActions = linkageActions
        const pidActions = await evaluatePidHeating(info)
        if (pidActions.length) info._pidActions = pidActions
        const pumpVelocityActions = await evaluatePumpVelocityControl(info)
        if (pumpVelocityActions.length) info._pumpVelocityActions = pumpVelocityActions
        const qtyResult = await evaluateQuantityShutdown(info)
        if (qtyResult) info._quantityShutdown = qtyResult
        await computeMetrics(info)
        return info
    } catch (err) {
        console.error('[SensorRealtime] Error processing message:', err.message)
        return null
    }
}

module.exports = {
    SENSOR_TOPIC,
    handleMessage,
    parsePayload,
    normalizeDateTime
}
/** 【文件职责】处理传感器 MQTT 消息：解析设备号和时间、规范化字段并入库（写入后是当前
 * 最新记录时展示为"实时数据"，之后自然变成"保存数据"，项目里没有单独的"历史数据"）。
 * 【配置中心关联】DEVICE_ID_FIELDS、TIME_FIELDS、字段映射在每条消息处理时读取，支持热更新。 */
