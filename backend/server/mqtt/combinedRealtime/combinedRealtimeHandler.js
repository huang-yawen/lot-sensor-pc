/** 【文件职责】统一处理单条同时包含传感器字段和行为字段的 MQTT 消息。
 * 【配置】当 MQTT_TOPICS.sensor 与 MQTT_TOPICS.behavior 配置为同一个主题时，
 * mqtt/index.js 会用本处理器替代分开的 sensorRealtimeHandler/behaviorRealtimeHandler。
 *
 * 【合并版落库】一条消息写三张表（统一走 utils/mappedData.js 的 saveSceneData）：
 *   ① t_scene_data      合并表，一条消息一行：传感器字段 field1~field10、
 *                       行为字段 field11~field20（+10 偏移）、has_sensor / has_behavior 标记；
 *   ② t_sensor_data     传感器侧旧真表（分开版的所有旧代码读它）；
 *   ③ t_behavior_data   行为侧旧真表（同上）。
 *   写三份是为了让"任何一版代码都能直接用同一套库"，切回分开版代码不用动数据库。
 *
 * 【智能判定（方式③ 消息即触发）】本处理器在每条消息处理末尾调用
 * triggerRealtimeJudgment()（见文件底部），把原始报文映射成 field1..field4 后交给
 * service/intelligent/intelligentJudgment.js 的 runRealtimeJudgment 异步判定，
 * 复用手动/自动同一条 judgeAndSave 链路。开关在 config.js 的 REALTIME_JUDGMENT.enabled。
 */
const { saveSceneData, resolveDeviceNo } = require('../../utils/mappedData')
const { withControlModeDefaults, detectAndRecordChanges } = require('../behaviorRealtime/behaviorRealtimeRepository')
const { getReportedTime } = require('../../utils/protocol')
const { evaluateRules } = require('../../service/alarm/evaluateRules')
const { evaluateSafety } = require('../../service/safety/safetyInterlock')
const { evaluateLinkageRules } = require('../../service/linkageRules/linkageRules')
const { evaluateFaultStatus } = require('../../service/faultStatus/faultStatus')
const { evaluatePidHeating, getPidHeatingStatus } = require('../../service/pidHeating/pidHeating')
const { evaluatePumpVelocityControl } = require('../../service/pumpVelocityControl/pumpVelocityControl')
const { evaluateQuantityShutdown } = require('../../service/quantityShutdown/quantityShutdown')
const { evaluateTempShutdown } = require('../../service/tempShutdown/tempShutdown')
const { compute: computeMetrics } = require('../../service/computedMetrics/computedMetrics')
const { appendSnapshots } = require('../../service/cumulative/cumulativeSnapshotService')
const { evaluateSpikeFilter } = require('../../service/dataQuality/spikeFilter')
const { evaluateRelayStuck } = require('../../service/dataQuality/relayStuck')
const { evaluateSensorInverted } = require('../../service/dataQuality/sensorInverted')
const { runStep } = require('../runStep')
const { buildMappedRecord } = require('../../utils/mappedData')
const { runRealtimeJudgment } = require('../../service/intelligent/intelligentJudgment')
const { REALTIME_JUDGMENT } = require('../../service/intelligent/config')

const TAG = '[CombinedRealtime]'

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
    // 每一步用 runStep 单独包一层：某一步抛异常（比如数据库抖一下写记录失败、MQTT 刚好断线
    // 下发失败）只打一行"xxx出错，本步跳过"日志，后面的步骤照常执行——不能因为存库或
    // 写记录失败，就让同一条消息里的安全联锁、故障保护跳过。排查"控制逻辑好像没生效"时，
    // 先搜日志里有没有"出错，本步跳过"。
    // 同一条消息里既有传感器字段又有行为字段：【合并版】两者写进 t_scene_data 的同一行。
    // 数据质量（跳变/毛刺过滤）：只过滤传感器数值，行为数据（开关状态）照常入库。
    // 过滤本身出错时按"不过滤"处理（跟数据质量开关关着一样），这条数据原样入库。
    const spike = await runStep(TAG, '数据质量-跳变过滤', () => evaluateSpikeFilter(info), { flush: [info], blocked: false, triggers: [] })
    if (spike.triggers.length) info._spikeTriggers = spike.triggers
    // ── 一次消息 = 一行 ──────────────────────────────────────────────────────
    // 跳变过滤有三种结果，落库方式各不相同（合并后仍然保持「分开版」的语义）：
    //   ① flush = [..., info]：本条数值已确认入库（可能连带补写之前缓冲的几条）→
    //      最后那条（=本条）同时写行为槽位，缓冲行只写传感器槽位。
    //   ② flush = []：本条被拦下不入库 → 另起一行只写行为槽位，行为数据不丢。
    //   ③ flush = [缓冲行...] 但本条仍被判为毛刺 → 同 ②：缓冲行只写传感器槽位。
    const infoFlushed = spike.flush.length > 0 && spike.flush[spike.flush.length - 1] === info
    /** 本次真正写成功的表，消息末尾汇总日志用（三写方案下正常是 3 张表）。 */
    const writtenTables = new Set()
    // 本条要写行为槽位时，先补上 PC 侧逻辑开关（控制模式 mode / PID恒温 pidMode）；
    // 这两个值设备不上报，得从指令中心查。判②③ 时本条不写传感器槽位，也要补。
    const behaviorInfo = await runStep(TAG, '行为字段补值', async () => {
        const dNo = await resolveDeviceNo(info)
        return dNo ? withControlModeDefaults(info, dNo) : null
    }, null)

    for (const row of spike.flush) {
        const isCurrent = row === info && behaviorInfo != null
        const saved = await runStep(TAG, '保存场景数据', () => saveSceneData({
            info: isCurrent ? behaviorInfo : row,
            dateTime: row.c_time ?? null,
            withBehavior: isCurrent,
        }), null)
        if (saved?.written) saved.written.forEach(table => writtenTables.add(table))
    }
    if (!infoFlushed && behaviorInfo != null) {
        const saved = await runStep(TAG, '保存场景数据（仅行为）', () => saveSceneData({
            info: behaviorInfo,
            dateTime: info.c_time ?? null,
            withSensor: false,
            withBehavior: true,
        }), null)
        if (saved?.written) saved.written.forEach(table => writtenTables.add(table))
    }
    // 数据质量规则二：继电器触点粘连/控制失效——指令已关但传感器显示仍在工作时，
    // 自动重发关闭指令尝试恢复，重试无效则判定硬件故障、提示人工断电检修。
    const relayTriggers = await runStep(TAG, '数据质量-继电器粘连', () => evaluateRelayStuck(info), [])
    if (relayTriggers.length) info._relayStuckTriggers = relayTriggers
    // 数据质量规则三：逆温差/传感器装反——加热开够久了出水反而比进水冷，判定两路接反，
    // 提示检查硬件拓扑并暂停自动恒温控制（PID 被控量方向反了会正反馈超温）。
    const invertedTriggers = await runStep(TAG, '数据质量-传感器装反', () => evaluateSensorInverted(info), [])
    if (invertedTriggers.length) info._sensorInvertedTriggers = invertedTriggers
    // 行为数据已在上面随行写入（has_behavior=1），这里不再单独写一次。
    // 但「分开版」里 saveBehaviorData 末尾还会做一次状态变化检测、把设备侧的实际状态变化
    // 记进操作历史（t_operation_history）。合并版把行为写入搬到了本文件，这一步必须跟着搬，
    // 否则操作历史会静默丢记录（设备手动开关泵/加热后页面上看不到）。
    if (behaviorInfo != null) {
        await runStep(TAG, '行为状态变化检测', () => detectAndRecordChanges(info, behaviorInfo.d_no), null)
    }
    // 两类字段都已到齐，一次性评估告警规则即可，不必再分开各评估一次。
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
    // “需要计算的数据”实时派生指标。
    await runStep(TAG, '派生指标计算', () => computeMetrics(info, flowTimestampMs), null)
    // 累计指标快照：把各累计值（累计流量 / 累计运行时长…）按真实时间差增量累加后写入
    // t_cumulative_snapshot，历史图表页/明细表直接读快照，不再每次全表窗口函数扫原始大表。
    await runStep(TAG, '累计快照', () => appendSnapshots({ info, cTimeMs: flowTimestampMs }), null)
    // 方式③：消息即触发智能判定——每条消息都异步判定一次（复用手动/自动同一条 judgeAndSave 链路），
    // 不等回复、不阻塞上面的本地规则与存库。只有 REALTIME_JUDGMENT.enabled=true 时才真正发请求。
    // triggerRealtimeJudgment(info)
    //
    // ── 每条消息末尾打一行汇总 ──────────────────────────────────────────────
    // 现场排查"数据有没有落库""控制逻辑有没有跑"搜这行最快，不用去翻数据库：
    //   写入 = 本次真正写成功的表（三写方案下正常 3 张：合并表 + 传感器表 + 行为表；
    //          跳变过滤拦下传感器数值时是这个消息的 2 张：合并表 + 行为表）
    //   后面几个数字 = 控制链各环节本轮触发了几条（0 = 跑了但没命中，不代表没跑）
    //   任何一步抛异常都会另打一行"xxx出错，本步跳过"，有那行才是真出问题。
    console.log(
        `${TAG} 本轮完成 d_no=${behaviorInfo?.d_no ?? '-'} c_time=${info.c_time ?? '-'}` +
        ` | 写入 ${[...writtenTables].join(' + ') || '无'}` +
        ` | 告警${alarms.length} 安全${safetyTriggers.length} 故障${faultTriggers.length}` +
        ` 联动${linkageActions.length} PID${pidActions.length} 恒流速${pumpVelocityActions.length}` +
        (qtyResult ? ' 定量停机✓' : '') + (tempResult ? ' 定温停机✓' : '')
    )
    return info
}

/**
 * 方式③：消息即触发智能判定（fire-and-forget，每条 MQTT 消息都触发一次）。
 * 用 buildMappedRecord 把原始报文映射成 field1..field4 语义槽位（跟手动/自动查库拿到的
 * 整行结构一致），再交给 intelligentJudgment.js 的 runRealtimeJudgment——判定服务地址/请求
 * 格式/mock 兜底全部走同一份 config.js。
 * 失败只打日志，不影响消息主流程。
 */
function triggerRealtimeJudgment(info) {
    if (!REALTIME_JUDGMENT.enabled) return
    ;(async () => {
        try {
            const { record, skipped } = await buildMappedRecord({
                table: 't_sensor_data',
                mapperTable: 't_sensor_field_mapper',
                info,
                dateTime: info.c_time ?? null,
            })
            if (skipped || !record) return
            await runRealtimeJudgment({ type: 'sensor', record })
        } catch (err) {
            console.error('[CombinedRealtime] 消息实时判定失败:', err.message)
        }
    })()
}

module.exports = {
    handleMessage,
    normalizeDateTime
}
