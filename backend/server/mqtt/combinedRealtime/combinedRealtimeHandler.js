/** 【文件职责】统一处理单条同时包含传感器字段和行为字段的 MQTT 消息。
 * 【配置】当 MQTT_TOPICS.sensor 与 MQTT_TOPICS.behavior 配置为同一个主题时，
 * mqtt/index.js 会用本处理器替代分开的 sensorRealtimeHandler/behaviorRealtimeHandler，
 * 两张表各自按自己的字段映射表（t_sensor_field_mapper/t_behavior_field_mapper）从同一条
 * 消息中挑出需要的字段落库，不需要设备分两条消息上报。 */
const { saveSensorData } = require('../sensorRealtime/sensorRealtimeRepository')
const { saveBehaviorData } = require('../behaviorRealtime/behaviorRealtimeRepository')
const { getReportedTime } = require('../../utils/protocol')
const { evaluateRules } = require('../../service/alarm/evaluateRules')
const { evaluateSafety } = require('../../service/safety/safetyInterlock')
const { evaluateLinkageRules } = require('../../service/linkageRules/linkageRules')
const { evaluateFaultStatus } = require('../../service/faultStatus/faultStatus')
const { evaluatePidHeating, getPidHeatingStatus } = require('../../service/pidHeating/pidHeating')
const { evaluatePumpVelocityControl } = require('../../service/pumpVelocityControl/pumpVelocityControl')
const { evaluateQuantityShutdown } = require('../../service/quantityShutdown/quantityShutdown')
const { compute: computeMetrics } = require('../../service/computedMetrics/computedMetrics')
const { evaluateSpikeFilter } = require('../../service/spikeFilter/spikeFilter')
const { evaluateRelayStuck } = require('../../service/spikeFilter/relayStuck')

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

    // 下面这一串按固定顺序依次执行：
    //   1. 数据质量过滤 + 存库（evaluateSpikeFilter -> saveSensorData/saveBehaviorData）：
    //      传感器数值里的跳变/毛刺先拦下不入库，行为数据不过滤、照常落库。
    //   2. 本地告警规则（evaluateRules）：按阈值判断，只记录不动手。
    //   3. 安全联锁（evaluateSafety）→ 故障状态机（evaluateFaultStatus）：异常时强制关闭水泵和加热。
    //   4. 正常状况联动（evaluateLinkageRules，9 条独立规则自由勾选组合）→ PID 恒温
    //      （evaluatePidHeating）→ 水泵恒流速（evaluatePumpVelocityControl）→ 定量停机
    //      （evaluateQuantityShutdown）：按目标温度/流速/流量调节水泵和加热。
    //   5. 派生指标计算（computeMetrics）：计算首页展示用的派生指标，不涉及硬件控制。
    // 这几步共享同一个 try/catch：中间某一步抛异常，后面的步骤这一轮就不会再执行了
    // （比如 evaluateSafety 出错，后面的自动控制、PID 都会被跳过）。排查问题时如果发现
    // "控制逻辑好像没生效"，先看日志里前面有没有某一步先报错了。
    try {
        // 同一条消息里既有传感器字段又有行为字段，两张表各自按字段映射表挑选自己需要的字段。
        // 数据质量（跳变/毛刺过滤）：只过滤传感器数值，行为数据（开关状态）照常入库。
        const spike = await evaluateSpikeFilter(info)
        for (const row of spike.flush) await saveSensorData(row)
        if (spike.triggers.length) info._spikeTriggers = spike.triggers
        // 数据质量规则二：继电器触点粘连/控制失效——指令已关但传感器显示仍在工作时，
        // 自动重发关闭指令尝试恢复，重试无效则判定硬件故障、提示人工断电检修。
        const relayTriggers = await evaluateRelayStuck(info)
        if (relayTriggers.length) info._relayStuckTriggers = relayTriggers
        await saveBehaviorData(info)
        // 两类字段都已到齐，一次性评估告警规则即可，不必再分开各评估一次。
        const alarms = await evaluateRules(info)
        if (alarms.length) info._alarms = alarms
        // 安全联锁：触发任一启用条件时关闭水泵和加热（自动模式），或仅记录告警（手动模式）。
        const safetyTriggers = await evaluateSafety(info)
        if (safetyTriggers.length) info._safetyTriggers = safetyTriggers
        // 故障状态：加热模块故障/水泵故障/管道堵塞/管道漏水，触发时关闭水泵和加热并自动切回手动模式。
        const faultTriggers = await evaluateFaultStatus(info)
        if (faultTriggers.length) info._faultTriggers = faultTriggers
        // 正常状况联动：自动模式下按 LINKAGE_RULES 里逐条勾选的规则自动启停水泵和加热。
        const linkageActions = await evaluateLinkageRules(info)
        if (linkageActions.length) info._linkageActions = linkageActions
        // PID 恒温控制：仅接管加热这一个执行器，时间比例控制模拟 PWM 占空比。
        const pidActions = await evaluatePidHeating(info)
        if (pidActions.length) info._pidActions = pidActions
        // PID 本周期加热时长：仅供指令页面展示，不影响控制。
        const pidHeatingStatus = await getPidHeatingStatus(info)
        if (pidHeatingStatus) info._pidHeating = pidHeatingStatus
        // 水泵恒流速控制：仅接管水泵这一个执行器，滞环通断或占空比二选一。
        const pumpVelocityActions = await evaluatePumpVelocityControl(info)
        if (pumpVelocityActions.length) info._pumpVelocityActions = pumpVelocityActions
        // 用入库的 c_time（而不是服务器处理消息的墙钟时间）换算成毫秒时间戳，定量停机和
        // “需要计算的数据”两处按真实时间差积分流量时共用同一个基准，避免 MQTT 排队延迟/
        // 设备时钟漂移让各处对同一段时间算出不同的时间差。
        const cTimeMs = info.c_time ? new Date(String(info.c_time).replace(' ', 'T')).getTime() : NaN
        const flowTimestampMs = Number.isFinite(cTimeMs) ? cTimeMs : Date.now()
        // 定量停机：累计流量达到目标后关闭水泵和加热。
        const qtyResult = await evaluateQuantityShutdown(info, flowTimestampMs)
        if (qtyResult) info._quantityShutdown = qtyResult
        // “需要计算的数据”实时派生指标。
        await computeMetrics(info, flowTimestampMs)
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
