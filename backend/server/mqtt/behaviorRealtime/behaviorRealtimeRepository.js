const promisePool = require('../../config/dbPool')
const { saveOperationHistory } = require('../../service/operationHistory/saveOperationHistory')

/** 开关类型指令（config_id=0,1,2,4,9），t_direct 存 on/off，MQTT 发 open/close */
const REVERSE_SWITCH_MAP = { on: 'open', off: 'close' }
const SWITCH_CONFIG_IDS = new Set([0, 1, 2, 4, 9])

/** 行为数据字段 到 t_direct_config.id 的映射 */
const FIELD_TO_CONFIG_ID = {
    mode: 0,
    fan: 2,
    fan_speed: 3,
    air: 1,
    acmode: 4,
    air_power: 5,
    led: 9,
    led_power: 11
}

/**
 * 检测设备状态变化：将行为数据的字段值与 t_direct 表中记录的预期值对比。
 * 
 * 核心逻辑：
 *   t_direct 表保存的是我们最后下发给设备的指令值（预期状态），
 *   行为数据是设备实际上报的状态。
 *   如果两者的值不一致，说明设备发生了操作变化（可能来自底层手动操作），
 *   则记录一条操作历史。
 * 
 * 优点：
 *   - 不依赖上一条行为数据的先后顺序，即使中间丢包也不影响
 *   - t_direct 表的 config_id 关联 t_direct_config，操作名称和值含义完全由数据库控制
 *   - 后续赛题只改 t_direct_config 和 t_direct 表即可适配
 * 
 * @param {Object} info - 新收到的行为数据
 */
async function detectAndRecordChanges(info, d_no) {
    try {
        // 打印调试信息
        console.log('[BehaviorRealtime] detectAndRecordChanges 开始检测，d_no:', d_no, 'info:', JSON.stringify(info).slice(0, 200))

        // 从 t_direct 表查出该设备所有已下发的指令值（包括全局配置和设备专属配置）
        const [directRows] = await promisePool.query(
            `SELECT config_id, value, d_no FROM t_direct WHERE d_no = ? OR d_no IS NULL`,
            [d_no]
        )

        console.log('[BehaviorRealtime] t_direct 查询结果行数:', directRows.length)

        if (directRows.length === 0) {
            console.log('[BehaviorRealtime] t_direct 表中无记录，跳过状态检测')
            return
        }

        // 构建 config_id -> value 的映射（预期值）
        // 先放入全局配置（d_no IS NULL），再被设备专属配置（d_no = ?）覆盖
        const expectedValues = {}
        for (const row of directRows) {
            const configId = row.config_id
            const val = String(row.value ?? '').trim()
            // 如果已有设备专属配置，不覆盖；否则设置
            if (!expectedValues[configId] || row.d_no !== null) {
                expectedValues[configId] = val
            }
        }

        console.log('[BehaviorRealtime] 预期值映射:', JSON.stringify(expectedValues))

        let hasChanges = false

        // 遍历行为数据的每个字段，与 t_direct 的预期值对比
        for (const [infoKey, configId] of Object.entries(FIELD_TO_CONFIG_ID)) {
            const newVal = String(info[infoKey] ?? '').trim()
            const expectedVal = expectedValues[configId]

            if (expectedVal === undefined) {
                continue // t_direct 中没有此配置的预期值，跳过
            }

            // 开关类型需要映射：t_direct 存 on/off，设备实际回报 open/close
            const compareExpected = SWITCH_CONFIG_IDS.has(configId)
                ? (REVERSE_SWITCH_MAP[expectedVal] || expectedVal)
                : expectedVal

            // 如果 t_direct 中有这个配置的预期值，且与实际值不同
            if (newVal !== compareExpected) {
                console.log(`[BehaviorRealtime] 检测到变化: config_id=${configId}, infoKey=${infoKey}, 预期=${compareExpected}, 实际=${newVal}`)
                await saveOperationHistory({
                    d_no,
                    config_id: configId,
                    old_value: expectedVal,
                    new_value: newVal,
                    source: 'auto',
                    c_time: info.Time || null
                })
                hasChanges = true
            }
        }

        if (hasChanges) {
            console.log('[BehaviorRealtime] 检测到设备状态与预期不一致，已记录操作历史')
        }
    } catch (err) {
        console.error('[BehaviorRealtime] 检测状态变化失败:', err.message)
    }
}

/**
 * 从行为数据中提取设备编号，优先级：info.VID > info.d_no > info.DNO > 从 t_device 表取第一个
 */
async function getDeviceNo(info) {
    if (info.VID) return String(info.VID).trim()
    if (info.d_no) return String(info.d_no).trim()
    if (info.DNO) return String(info.DNO).trim()
    // 从 t_device 表取第一个设备编号
    try {
        const [rows] = await promisePool.query(
            'SELECT `number` FROM `t_device` ORDER BY `id` ASC LIMIT 1'
        )
        if (rows && rows.length > 0) {
            return String(rows[0].number).trim()
        }
    } catch (err) {
        console.error('[BehaviorRealtime] 查询默认设备编号失败:', err.message)
    }
    return 'default_device' // 实在取不到才用兜底值
}

async function saveBehaviorData(info) {
    // 从行为数据提取设备编号，不再硬编码
    const d_no = await getDeviceNo(info)

    const params = [
        d_no,
        info.mode ?? null,
        info.fan ?? null,
        info.fan_speed ?? null,
        info.air ?? null,
        info.acmode ?? null,
        info.air_power ?? null,
        info.led ?? null,
        info.led_power ?? null,
        info.Time ?? null,
       (String(info.online).trim() === '1' || info.online === true) ? '实时数据' : '保存数据'
    ]

    try {
        await promisePool.execute(
            `INSERT INTO t_behavior_data (d_no, field1, field2, field3, field4, field5, field6, field7, field8, c_time, online) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params
        )
        console.log('[BehaviorRealtime] Data saved to database successfully, d_no:', d_no)
        
        // 保存成功后，检测状态变化并记录操作历史
        await detectAndRecordChanges(info, d_no)
        
        return true
    } catch (err) {
        console.error('[BehaviorRealtime] Failed to save data:', err.message)
        throw err
    }
}

async function getBehaviorDataByDevice(limit = 100) {
    try {
        const [rows] = await promisePool.query(
            `SELECT * FROM t_behavior_data ORDER BY c_time DESC LIMIT ?`,
            [limit]
        )
        return rows
    } catch (err) {
        console.error('[BehaviorRealtime] Failed to query data:', err.message)
        throw err
    }
}

module.exports = {
    saveBehaviorData,
    getBehaviorDataByDevice
}
