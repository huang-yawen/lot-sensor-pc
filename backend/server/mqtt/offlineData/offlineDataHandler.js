/**
 * 【文件职责】处理设备断线期间缓存、恢复联系后补传上来的数据（MQTT_TOPICS.offlineData，
 * 默认 'offline' 主题）。报文结构跟实时上报的 'receive' 完全一样，同样按字段映射表分成
 * 两类落库：传感器字段进 t_sensor_data，执行器字段进 t_behavior_data。
 *
 * 【跟实时数据的区别 —— 这是本文件存在的全部理由】
 *   1. 落库时 online 列写成"补传数据"（BACKFILL_LABEL），utils/recencyFilter.js 的
 *      "最新 N 条"窗口会跳过带这个标记的行。不跳过的话，补传数据的自增 id 最大，会把
 *      传感器/行为的【实时数据】页面和首页卡片整个顶掉——页面上显示的"最新"其实是
 *      断线那段时间的旧值。跳过之后补传数据只出现在【汇总数据】页面，数据类型列
 *      显示"保存数据"。
 *   2. 不跑任何实时控制逻辑（阈值告警 / 安全联锁 / 故障状态 / 正常状况联动 / PID 恒温 /
 *      恒流速 / 定量停机 / 定温停机 / 数据质量三条规则 / 派生指标）。补传的是过去某个
 *      时刻的值，拿它去驱动现在的水泵和加热是错的。
 *   3. 不写操作历史（不走 behaviorRealtimeRepository 的 detectAndRecordChanges）：那个
 *      函数会把设备上报值回写进 t_direct 当成新的预期值，用旧数据跑一遍会直接污染当前
 *      的控制基准。
 *   4. 不参与设备在线判定、不推 WebSocket（调用方 mqtt/index.js 里单独分支处理，
 *      不走 messageRouter，也就不会触发 processedMessage 广播）。
 *
 * 【配置】主题名见 config/mqtt.js 的 MQTT_TOPICS.offlineData；设备靠 PC 心跳判断上位机
 * 在不在线、从而决定要不要缓存数据，心跳下发见 mqtt/pcHeartbeat.js。
 */
const { saveMappedData } = require('../../utils/mappedData')
const { getReportedTime } = require('../../utils/protocol')
const { normalizeDateTime, nowLocalDateTime } = require('../../utils/helper')
const { BACKFILL_LABEL } = require('../../utils/recencyFilter')

function parsePayload(payload) {
    // MQTT 载荷以 Buffer 对象到达，必须先解码为文本再解析，避免把二进制直接写库。
    try {
        return JSON.parse(payload.toString())
    } catch (err) {
        console.error('[OfflineData] Failed to parse JSON:', err.message)
        return null
    }
}

/**
 * 解析一条补传报文并分两类落库。
 * @param {string} topic - 主题名（补传主题）
 * @param {Buffer} payload - 原始 MQTT 载荷
 * @returns {Promise<Object|null>} 落库用的数据；JSON 解析失败返回 null
 */
async function handleMessage(topic, payload) {
    const info = parsePayload(payload)
    if (!info) {
        return null
    }

    // 补传数据的时间必须用设备自己记录的采集时间，不能用服务器收到消息的时间——它代表
    // 的是断线那段时间轴上的位置。只有设备没带时间字段时才退回当前时间兜底。
    info.c_time = normalizeDateTime(getReportedTime(info)) || nowLocalDateTime()

    console.log('[OfflineData] Received backfill message:', { topic, data: info })

    // 两张表各自按自己的字段映射表从同一条报文里挑字段，跟实时数据走的是同一套映射，
    // 区别只有 online 列打上"补传数据"标记。行为表里的控制模式(mode)/PID恒温(pidMode)
    // 是 PC 侧的逻辑状态，报文里没有，也不该拿"现在"的值去补断线时刻的历史，这两列留空。
    await saveMappedData({
        table: 't_sensor_data',
        mapperTable: 't_sensor_field_mapper',
        info,
        dateTime: info.c_time,
        dataLabel: BACKFILL_LABEL,
    })
    await saveMappedData({
        table: 't_behavior_data',
        mapperTable: 't_behavior_field_mapper',
        info,
        dateTime: info.c_time,
        dataLabel: BACKFILL_LABEL,
    })
    console.log('[OfflineData] 补传数据已入库（标记为补传数据，只在汇总数据页展示）:', info.c_time)
    return info
}

module.exports = { handleMessage }
