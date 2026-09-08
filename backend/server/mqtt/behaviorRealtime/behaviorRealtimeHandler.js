/**
 * 【文件职责】行为 MQTT 消息处理器——只在"传感器/行为分开两个主题上报"模式下
 * 才会用到（sensorRealtimeHandler.js 处理传感器消息，这个文件处理行为消息）；
 * 如果两个主题配置成同一个，mqtt/index.js 会改用 combinedRealtimeHandler.js
 * 一次性处理合并消息，这个文件就不会被调用（见 mqtt/index.js 的 registerRoutes）。
 *
 * 这里只做两件事：存库、跑一遍告警规则，不会跑安全联锁/故障检测/联动规则/PID/
 * 恒流速/定量停机这一整套控制逻辑——那一整套评估目前是绑在传感器消息触发的
 * （sensorRealtimeHandler.js/combinedRealtimeHandler.js 里才有），行为消息本身
 * 不会独立触发一遍。这里有个需要知道的限制：如果真的是"传感器/行为分开两个
 * 主题上报"，控制逻辑里像"读取当前水泵/加热开关状态"这类判断（比如安全联锁的
 * "没开水泵却开了加热"、联动规则的滞回带通断），读的都是触发它的那条传感器
 * 消息自己携带的字段——纯传感器消息不带水泵/加热的开关字段，读到的就是
 * 未知（null），不是真的查了行为表拿到最新状态。各处对"未知"都做了保守处理
 * （不报错、不因此误触发/误跳过关键保护），但这意味着分开上报模式下这类交叉
 * 判断能力天然有限；多数场景下 MQTT_TOPICS.sensor 和 behavior 配置成同一个
 * 主题、走 combinedRealtimeHandler.js 一次性拿到两类字段，就没有这个限制。
 * 【配置】DEVICE_ID_FIELDS、TIME_FIELDS 由协议工具动态读取。
 */
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
 * Date 对象、时间戳数字、已经是标准格式的字符串（直接放行），其它格式的
 * 字符串会尝试再解析一次；解析不出来统一返回 null，交给调用方退回用服务器
 * 当前时间兜底。
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
        // 落库，供历史查询/图表展示，也是首页"最新行为数据"的来源。
        await saveBehaviorData(info)
        // 告警规则：按配置中心 ALARM_RULES 逐条判断，触发时写记录、可选自动联锁。
        // 安全联锁/故障检测/联动规则等其它评估不在这里跑，见文件头部说明。
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
