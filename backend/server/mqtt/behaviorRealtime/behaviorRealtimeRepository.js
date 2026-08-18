/** 【文件职责】行为实时数据仓储层。
 * 【配置中心关联】无直接读取。 */
const promisePool = require('../../config/dbPool')
const { saveMappedData } = require('../../utils/mappedData')
const { saveOperationHistory } = require('../../service/operationHistory/saveOperationHistory')
const { saveDirectData, getDirectValue } = require('../../service/directData/saveDirectConfig')
const { getDeviceNo: getConfiguredDeviceNo, getReportedTime, toWireValue, fromWireValue } = require('../../utils/protocol')

/** 开关类型指令（config_id=0,1,2,4,9），t_direct 存 on/off，MQTT 发 open/close */
const SWITCH_CONFIG_IDS = new Set([0, 1, 2, 4, 9])

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
        const [configRows] = await promisePool.query(
            `SELECT id, preffix, f_type
             FROM t_direct_config
             WHERE preffix IS NOT NULL AND preffix != ''`
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
        for (const config of configRows) {
            const infoKey = String(config.preffix).trim()
            const configId = Number(config.id)
            // 设备可能只上报部分字段；缺失字段不能当成空字符串变化。
            if (!Object.prototype.hasOwnProperty.call(info, infoKey) || info[infoKey] == null) {
                continue
            }
            const newVal = String(info[infoKey] ?? '').trim()
            const expectedVal = expectedValues[configId]

            if (expectedVal === undefined) {
                continue // t_direct 中没有此配置的预期值，跳过
            }

            // 开关类型需要映射：t_direct 存 on/off，设备实际回报 open/close
            const isSwitch = String(config.f_type) === '1' || SWITCH_CONFIG_IDS.has(configId)
            const compareExpected = isSwitch
                ? String(toWireValue(expectedVal))
                : expectedVal

            // 如果 t_direct 中有这个配置的预期值，且与实际值不同
            if (newVal !== compareExpected) {
                console.log(`[BehaviorRealtime] 检测到变化: config_id=${configId}, infoKey=${infoKey}, 预期=${compareExpected}, 实际=${newVal}`)
                const historyResult = await saveOperationHistory({
                    d_no,
                    config_id: configId,
                    old_value: expectedVal,
                    new_value: newVal,
                    source: 'auto',
                    c_time: getReportedTime(info) || null
                })
                if (historyResult.success) {
                    // 接受设备实际状态为新的比较基准，防止每个上报包重复记录同一次变化。
                    const storedValue = isSwitch
                        ? fromWireValue(newVal)
                        : newVal
                    await saveDirectData({ config_id: configId, value: storedValue, d_no })
                    expectedValues[configId] = storedValue
                    hasChanges = true
                }
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
    const reported = getConfiguredDeviceNo(info)
    if (reported != null) return String(reported).trim()
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

    try {
        const mappedInfo = { ...info, d_no }
        // 控制模式是 PC 端逻辑状态，设备不会上报；从 t_direct 读真实值落库，
        // 存成 0(手动/off)/1(自动/on)，让行为数据页"控制模式"列显示真实数据。
        if (!Object.prototype.hasOwnProperty.call(mappedInfo, 'mode')) {
            const rawMode = await getDirectValue({ config_id: 0, d_no })
            const modeStr = String(rawMode ?? '').trim().toLowerCase()
            mappedInfo.mode = ['on', 'auto', 'open', '1', 'true'].includes(modeStr) ? 1 : 0
        }
        await saveMappedData({
            table: 't_behavior_data',
            mapperTable: 't_behavior_field_mapper',
            info: mappedInfo,
            dateTime: getReportedTime(info) ?? null,
        })
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
/** 【文件职责】行为实时数据仓储层，集中执行行为表的查询和写入 SQL。
 * 【配置中心关联】无直接读取；字段解析已在 Handler 层按配置完成。 */
