/** 【文件职责】传感器 MQTT 消息处理器。
 * 【配置】DEVICE_ID_FIELDS、TIME_FIELDS 等协议项在每条消息处理时读取。 */
const { saveSensorData } = require('./sensorRealtimeRepository')
const { getReportedTime, getTopic } = require('../../utils/protocol')
const { evaluateRules } = require('../../service/alarm/evaluateRules')
const { evaluateSafety } = require('../../service/safety/safetyInterlock')
const { evaluateLinkageRules } = require('../../service/linkageRules/linkageRules')
const { evaluateFaultStatus } = require('../../service/faultStatus/faultStatus')
const { evaluatePidHeating, getPidHeatingStatus } = require('../../service/pidHeating/pidHeating')
const { evaluatePumpVelocityControl } = require('../../service/pumpVelocityControl/pumpVelocityControl')
const { evaluateQuantityShutdown } = require('../../service/quantityShutdown/quantityShutdown')
const { evaluateTempShutdown } = require('../../service/tempShutdown/tempShutdown')
const { compute: computeMetrics } = require('../../service/computedMetrics/computedMetrics')
const { evaluateSpikeFilter } = require('../../service/dataQuality/spikeFilter')
const { evaluateRelayStuck } = require('../../service/dataQuality/relayStuck')
const { evaluateSensorInverted } = require('../../service/dataQuality/sensorInverted')
const { runStep } = require('../runStep')

const TAG = '[SensorRealtime]'

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
    //   1. 数据质量过滤 + 存库（evaluateSpikeFilter -> saveSensorData）：跳变/毛刺值先拦下
    //      不入库，确认是真实变化后才补写；其余步骤仍然拿原始值评估，不受缓冲影响。
    //   2. 本地告警规则（evaluateRules）：按阈值判断，只记录不动手。
    //   3. 安全联锁（evaluateSafety）→ 故障状态机（evaluateFaultStatus）：异常时强制关闭水泵和加热。
    //   4. 正常状况联动（evaluateLinkageRules）→ PID 恒温（evaluatePidHeating）→
    //      水泵恒流速（evaluatePumpVelocityControl）→ 定量停机（evaluateQuantityShutdown）：
    //      按目标温度/流速/流量调节水泵和加热。
    //   5. 派生指标计算（computeMetrics）：计算首页展示用的派生指标，不涉及硬件控制。
    // 每一步用 runStep 单独包一层：某一步抛异常（比如数据库抖一下写记录失败、MQTT 刚好断线
    // 下发失败）只打一行"xxx出错，本步跳过"日志，后面的步骤照常执行——不能因为存库或
    // 写记录失败，就让同一条消息里的安全联锁、故障保护跳过。排查"控制逻辑好像没生效"时，
    // 先搜日志里有没有"出错，本步跳过"。
    // 数据质量（跳变/毛刺过滤）：跳变值不直接入库，先进缓冲区等连续确认；判定为毛刺的
    // 整批丢弃，判定为真实变化的按原顺序补写。flush 就是本轮真正该落库的行。
    // 过滤本身出错时按"不过滤"处理（跟数据质量开关关着一样），这条数据原样入库。
    const spike = await runStep(TAG, '数据质量-跳变过滤', () => evaluateSpikeFilter(info), { flush: [info], blocked: false, triggers: [] })
    for (const row of spike.flush) await runStep(TAG, '保存传感器数据', () => saveSensorData(row), null)
    if (spike.triggers.length) info._spikeTriggers = spike.triggers
    // 数据质量规则二：继电器触点粘连/控制失效——指令已关但传感器显示仍在工作时，
    // 自动重发关闭指令尝试恢复，重试无效则判定硬件故障、提示人工断电检修。
    const relayTriggers = await runStep(TAG, '数据质量-继电器粘连', () => evaluateRelayStuck(info), [])
    if (relayTriggers.length) info._relayStuckTriggers = relayTriggers
    // 数据质量规则三：逆温差/传感器装反——加热开够久了出水反而比进水冷，判定两路接反，
    // 提示检查硬件拓扑并暂停自动恒温控制（PID 被控量方向反了会正反馈超温）。
    const invertedTriggers = await runStep(TAG, '数据质量-传感器装反', () => evaluateSensorInverted(info), [])
    if (invertedTriggers.length) info._sensorInvertedTriggers = invertedTriggers
    // 告警规则：按配置中心 ALARM_RULES 逐条判断，触发时写记录、可选自动联锁。
    const alarms = await runStep(TAG, '安全告警', () => evaluateRules(info), [])
    if (alarms.length) info._alarms = alarms
    // 安全联锁：命中启用的条件就按规则动作（自动、手动模式都生效；故障锁定期间只记录不动开关）。
    const safetyTriggers = await runStep(TAG, '安全联锁', () => evaluateSafety(info), [])
    if (safetyTriggers.length) info._safetyTriggers = safetyTriggers
    // 故障状态：六种硬故障，触发时断电水泵和加热、进入故障锁定，等人工复位。
    const faultTriggers = await runStep(TAG, '故障状态', () => evaluateFaultStatus(info), [])
    if (faultTriggers.length) info._faultTriggers = faultTriggers
    // 正常状况联动：自动模式下按 LINKAGE_RULES 里逐条勾选的规则自动启停水泵和加热。
    const linkageActions = await runStep(TAG, '联动控制', () => evaluateLinkageRules(info), [])
    if (linkageActions.length) info._linkageActions = linkageActions
    // PID 恒温控制：仅接管加热这一个执行器，时间比例控制模拟 PWM 占空比。
    const pidActions = await runStep(TAG, 'PID恒温', () => evaluatePidHeating(info), [])
    if (pidActions.length) info._pidActions = pidActions
    // PID 本周期加热时长：仅供指令页面展示，不影响控制。
    const pidHeatingStatus = await runStep(TAG, 'PID状态', () => getPidHeatingStatus(info), null)
    if (pidHeatingStatus) info._pidHeating = pidHeatingStatus
    // 水泵恒流速控制：仅接管水泵这一个执行器，滞环通断或占空比二选一。
    const pumpVelocityActions = await runStep(TAG, '水泵恒流速', () => evaluatePumpVelocityControl(info), [])
    if (pumpVelocityActions.length) info._pumpVelocityActions = pumpVelocityActions
    // 用入库的 c_time（而不是服务器处理消息的墙钟时间）换算成毫秒时间戳，定量停机和
    // “需要计算的数据”两处按真实时间差积分流量时共用同一个基准，避免 MQTT 排队延迟/
    // 设备时钟漂移让各处对同一段时间算出不同的时间差。
    const cTimeMs = info.c_time ? new Date(String(info.c_time).replace(' ', 'T')).getTime() : NaN
    const flowTimestampMs = Number.isFinite(cTimeMs) ? cTimeMs : Date.now()
    // 定量停机：累计流量达到目标后关闭水泵和加热。
    const qtyResult = await runStep(TAG, '定量停机', () => evaluateQuantityShutdown(info, flowTimestampMs), null)
    if (qtyResult) info._quantityShutdown = qtyResult
    // 定温停机：出水温度达到阈值后关闭水泵和加热（与定量停机对称）。
    const tempResult = await runStep(TAG, '定温停机', () => evaluateTempShutdown(info), null)
    if (tempResult) info._tempShutdown = tempResult
    // "需要计算的数据"实时派生指标，仅用于展示，不参与硬件控制。
    await runStep(TAG, '派生指标计算', () => computeMetrics(info, flowTimestampMs), null)
    return info
}

module.exports = {
    SENSOR_TOPIC,
    handleMessage,
    parsePayload,
    normalizeDateTime
}
