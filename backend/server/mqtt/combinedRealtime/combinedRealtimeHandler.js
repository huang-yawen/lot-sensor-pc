/** 【文件职责】统一处理单条同时包含传感器字段和行为字段的 MQTT 消息。
 * 【配置中心关联】当 MQTT_TOPICS.sensor 与 MQTT_TOPICS.behavior 配置为同一个主题时，
 * mqtt/index.js 会用本处理器替代分开的 sensorRealtimeHandler/behaviorRealtimeHandler，
 * 两张表各自按自己的字段映射表（t_sensor_field_mapper/t_behavior_field_mapper）从同一条
 * 消息中挑出需要的字段落库，不需要设备分两条消息上报。 */
const { saveSensorData } = require('../sensorRealtime/sensorRealtimeRepository')
const { saveBehaviorData } = require('../behaviorRealtime/behaviorRealtimeRepository')
const { getReportedTime } = require('../../utils/protocol')
const { evaluateRules } = require('../../service/alarm/evaluateRules')
const { evaluateSafety } = require('../../service/safety/safetyInterlock')
const { evaluateAutoControl } = require('../../service/autoControl/autoControl')
const { evaluateLayeredControl } = require('../../service/layeredControl/layeredControl')
const { evaluateFaultStatus } = require('../../service/faultStatus/faultStatus')
const { evaluatePidHeating } = require('../../service/pidHeating/pidHeating')
const { evaluateQuantityShutdown } = require('../../service/quantityShutdown/quantityShutdown')
const { compute: computeMetrics } = require('../../service/computedMetrics/computedMetrics')

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

    // 【为什么下面这一长串评估要按这个固定顺序执行】这个顺序本身就是整个系统的安全
    // 优先级设计，从"先把数据存下来"到"保护类判断"再到"控制类判断"最后到"纯展示指标"：
    //   1. 先存库（saveSensorData/saveBehaviorData）：不管后面哪个评估环节出没出问题、
    //      有没有触发故障，这条原始数据本身都应该先被记录下来，供历史查询/图表展示，
    //      不能因为评估逻辑出错就连这条数据都丢了。
    //   2. 本地告警规则（evaluateRules）：最轻量的阈值判断，只记录不动手。
    //   3. 安全联锁（evaluateSafety）→ 故障状态机（evaluateFaultStatus）：两套独立的
    //      保护机制，都是"异常时强制关闭"，必须排在前面——如果先跑了自动控制把水泵
    //      加热打开，回头才发现该保护关闭，等于先开错了再关，不如提前判断好。
    //   4. 正常状况联动（evaluateAutoControl/evaluateLayeredControl）→ PID 恒温
    //      （evaluatePidHeating）→ 定量停机（evaluateQuantityShutdown）：这几个是
    //      "正常情况下按目标调节"的控制逻辑，建立在前面已经确认没有需要保护性关闭
    //      的故障基础上（它们内部也会各自检查故障锁定状态，双重保险）。
    //   5. 派生指标计算（computeMetrics）放最后：这一步纯粹是为了首页展示，不涉及
    //      任何硬件控制，所以排在所有真正影响执行器开关的判断之后也没关系。
    // 注意：这几步共享同一个 try/catch，如果中间某一步抛异常，后面的步骤这一轮就不会
    // 再执行了（比如 evaluateSafety 出错，后面的自动控制、PID 都会被跳过）——考虑到
    // 这些模块之间本来就有优先级依赖，这种"一步出错、宁可全跳过"某种程度上也是偏
    // 保守安全的，但排查问题时要留意：如果发现"控制逻辑好像没生效"，先看日志里前面
    // 有没有某一步先报错了。
    try {
        // 同一条消息里既有传感器字段又有行为字段，两张表各自按字段映射表挑选自己需要的字段。
        await saveSensorData(info)
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
        // 正常状况联动（自动控制）：自动模式下按目标温度自动启停水泵和加热。
        // CONTROL_MODE 决定用这套简化版还是下面的分层联动，二者互斥不会同时下发指令。
        const autoActions = await evaluateAutoControl(info)
        if (autoActions.length) info._autoActions = autoActions
        // 分层联动：单一传感器独立控制层 + 多传感器融合联动层，仅 CONTROL_MODE='layered' 时生效。
        const layeredActions = await evaluateLayeredControl(info)
        if (layeredActions.length) info._layeredActions = layeredActions
        // PID 恒温控制：仅接管加热这一个执行器，时间比例控制模拟 PWM 占空比。
        const pidActions = await evaluatePidHeating(info)
        if (pidActions.length) info._pidActions = pidActions
        // 定量停机：累计流量达到目标后关闭水泵和加热。
        const qtyResult = await evaluateQuantityShutdown(info)
        if (qtyResult) info._quantityShutdown = qtyResult
        // “需要计算的数据”实时派生指标。
        await computeMetrics(info)
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
