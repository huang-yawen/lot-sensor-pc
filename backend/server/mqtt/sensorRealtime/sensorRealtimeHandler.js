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

/** 把日期对象/时间戳格式化成 "YYYY-MM-DD HH:mm:ss"，本地时区，不是 UTC。 */
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

/**
 * 把设备上报的时间字段统一成 "YYYY-MM-DD HH:mm:ss" 格式，兼容三种输入：
 * Date 对象、时间戳数字、已经是标准格式的字符串（直接放行，不用再转一次），
 * 其它格式的字符串会尝试用 formatDateTime 再解析一次；解析不出来统一返回
 * null，交给调用方（handleMessage）退回用服务器当前时间兜底。
 */
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

    // 下面这一串按固定顺序依次执行，跟 combinedRealtimeHandler.js 是同一套评估
    // 流程（那边多了行为数据入库，因为处理的是"传感器+行为"合并上报的消息，
    // 这里只有纯传感器数据——这意味着下面这些评估里凡是要读"当前水泵/加热
    // 开关状态"的判断，读到的都是未知（null），因为这条纯传感器消息本身不
    // 携带那两个字段，各处对未知状态都做了保守处理，不会因此报错或误触发，
    // 但这类交叉判断在这种分开上报模式下能力有限，详见
    // behaviorRealtimeHandler.js 文件头的说明）：
    //   1. 先存库（saveSensorData）：把这条原始数据落库，供历史查询/图表展示。
    //   2. 本地告警规则（evaluateRules）：按阈值判断，只记录不动手。
    //   3. 安全联锁（evaluateSafety）→ 故障状态机（evaluateFaultStatus）：异常时强制关闭水泵和加热。
    //   4. 正常状况联动（evaluateLinkageRules）→ PID 恒温（evaluatePidHeating）→
    //      水泵恒流速（evaluatePumpVelocityControl）→ 定量停机（evaluateQuantityShutdown）：
    //      按目标温度/流速/流量调节水泵和加热。
    //   5. 派生指标计算（computeMetrics）：计算首页展示用的派生指标，不涉及硬件控制。
    // 这几步共享同一个 try/catch：中间某一步抛异常，后面的步骤这一轮就不会再执行了
    // （比如 evaluateSafety 出错，后面的自动控制、PID 都会被跳过）。排查问题时如果发现
    // "控制逻辑好像没生效"，先看日志里前面有没有某一步先报错了。
    try {
        await saveSensorData(info)
        // 告警规则：按配置中心 ALARM_RULES 逐条判断，触发时写记录、可选自动联锁。
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
        // 水泵恒流速控制：仅接管水泵这一个执行器，滞环通断或占空比二选一。
        const pumpVelocityActions = await evaluatePumpVelocityControl(info)
        if (pumpVelocityActions.length) info._pumpVelocityActions = pumpVelocityActions
        // 定量停机：累计流量达到目标后关闭水泵和加热。
        const qtyResult = await evaluateQuantityShutdown(info)
        if (qtyResult) info._quantityShutdown = qtyResult
        // "需要计算的数据"实时派生指标，仅用于展示，不参与硬件控制。
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
