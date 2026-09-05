/** 【文件职责】行为实时数据仓储层。
 * 【配置中心关联】无直接读取。 */
const promisePool = require('../../config/dbPool')
const { saveMappedData, resolveDeviceNo } = require('../../utils/mappedData')
const { saveOperationHistory } = require('../../service/operationHistory/saveOperationHistory')
const { saveDirectData, getDirectValue } = require('../../service/directData/saveDirectConfig')
const { getReportedTime, toWireValue, fromWireValue } = require('../../utils/protocol')

/** 按 preffix 查 t_direct_config 对应的 config_id。 */
async function resolveConfigIdByPrefix(prefix) {
    if (!prefix) return null
    const [rows] = await promisePool.query(
        "SELECT id FROM t_direct_config WHERE preffix IS NOT NULL AND preffix != '' AND LOWER(preffix) = LOWER(?) ORDER BY id ASC LIMIT 1",
        [prefix]
    )
    return rows[0]?.id ?? null
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
 * 实现方式：
 *   - 每次都直接拿当前这一条数据跟 t_direct 对比，不看上一条行为数据是什么
 *   - t_direct 表的 config_id 关联 t_direct_config，操作名称和值含义都从数据库里查
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
        // 先放入全局配置（d_no IS NULL），再用设备专属配置（d_no = ?）覆盖：同一个
        // config_id 如果既有全局配置又有设备专属配置，最终取设备专属的那个值。
        // 靠下面"已有设备专属配置就不覆盖"这条判断规则保证结果正确，不依赖 SQL
        // 返回行的先后顺序。
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
            const isSwitch = String(config.f_type) === '1'
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
                    // 记录完这次变化后，把 t_direct 的预期值更新成设备刚上报的这个新值，
                    // 作为新的比较基准。下一条 MQTT 消息再上报同样的值时，会跟这个新的
                    // "预期值"一致，不会被判定成又发生了一次变化，只有值再次不一样才会
                    // 重新触发。
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

/*
   * ── 控制模式 / PID恒温 等「PC 侧逻辑开关」的补值 ──────────────────────────
   *
   * 这些开关（控制模式 mode、PID恒温 pidMode）是上位机自己维护的状态，
   * 硬件不会通过 MQTT 上报，所以 info 里没有。这里在落库前从「指令中心」补进来：
   *   preffix ──resolveConfigIdByPrefix──▶ config_id ──getDirectValue──▶ t_direct 最新下发值
   * 再归一化成 0 / 1 塞进 mappedInfo，交给 saveMappedData 按 mapper 表写进 t_behavior_data。
   * 用 preffix 而不是写死 config_id：场景编辑 / 主键重排会让 config_id 变，只有 preffix 稳定。
   * 只在 info 没带该字段时才补（hasOwnProperty 判断），设备真上报了就以上报值为准。
   *
   * ── 想「新增」一个开关显示（3 步都要做齐）───────────────────────────────
   *   1. t_behavior_field_mapper 加一行：
   *        f_name    = 页面中文列名，如「阀门」
   *        p_name    = 逻辑名，如 valveMode（要和第 3 步 mappedInfo.<p_name> 完全一致）
   *        db_name   = t_behavior_data 里「空闲的」物理列，如 field5
   *                    （field1~field4 已被占用；没有多余 fieldN 时先 ALTER TABLE 加列）
   *        type      = '1'（开关）
   *        visible   = '1'
   *        value_map = {"0":"关","1":"开"}
   *   2. 确认该开关的 preffix 已存在于 t_direct_config，且 t_direct 里有值，
   *      否则 resolveConfigIdByPrefix 返回 null，这列恒为 0。
   *   3. 在下面照抄一个 if 块，改成对应的 preffix 和 mappedInfo.<p_name>。
   *   4. 重启后端生效。
   *   ⚠ 只加 if 不加 mapper 行：值会被 saveMappedData 忽略，存不进；
   *     只加 mapper 行不加 if：列会出现但恒为空。
   *
   * ── 想「去掉」一个开关显示 ──────────────────────────────────────────────
   *   · 推荐（免改代码、免重启）：
   *       UPDATE t_behavior_field_mapper SET visible = 0 WHERE p_name = 'pidMode';
   *     读取路径只 SELECT visible = 1 的行，页面立即不再显示该列。
   *   · 或直接删除该 mapper 行。
   *   · 下面对应的 if 块可一并注释掉，省去每条消息一次无用的 t_direct 查询；
   *     但「只注释 if、不动 mapper」不行：列还在，只是恒为空。
   *
   * ── 改了 mapper 的 p_name 会怎样（不会让项目报错）───────────────────────
   *   saveMappedData 是纯数据驱动：拿不到匹配的 p_name 就跳过这一列，不抛异常，
   *   顶多该列存不进值、页面显示空。前端只认 f_name（读取时 SELECT fieldN AS f_name），
   *   看不到 p_name，改 p_name 对页面渲染没有影响。
   *   全项目唯一写死了 mapper p_name 字面量的地方，就是下面这两个 if：
   *   'mode'（对应「控制模式」那行）、'pidMode'（对应「PID恒温」那行）。
   *   把这两行 mapper 的 p_name 改名时必须同步其一，否则补值写旧 key、mapper 找新 key，
   *   这两列会变空：
   *     · 在 p_name 里保留别名，如 '控制模式新名|mode'（| 分隔，saveMappedData 支持多别名）；
   *     · 或把下面 if 里的 'mode' / mappedInfo.mode（pidMode 同理）一起改名。
   *   其余普通传感器/执行器字段的 p_name 可随意改，只要新名字能和设备上报 JSON 的
   *   key 对上（或把旧名留作别名）即可。
   */
async function saveBehaviorData(info) {
    // 设备编号必须能在 t_device.number 匹配上（见 utils/mappedData.js resolveDeviceNo），
    // 匹配不上就跳过保存，不再兜底成数据库里第一个设备或 'default_device'。
    const d_no = await resolveDeviceNo(info)
    if (!d_no) {
        console.warn('[BehaviorRealtime] 设备编号未匹配已注册设备，跳过保存')
        return false
    }

    try {
        const mappedInfo = { ...info, d_no }
        // 控制模式(mode)、PID恒温(pidMode)是 PC 端逻辑状态，设备不上报；这里在落库前
        // 从指令中心(t_direct)按 preffix 查当前值补进来。完整原理、「增删一个开关显示」
        // 的步骤、以及改 mapper p_name 的注意事项，见上方 saveBehaviorData 前的大段注释。

        if (!Object.prototype.hasOwnProperty.call(mappedInfo, 'mode')) {
            const controlModeConfigId = await resolveConfigIdByPrefix('auto_control_enabled')
            if (controlModeConfigId != null) {
                const rawMode = await getDirectValue({ config_id: controlModeConfigId, d_no })
                const modeStr = String(rawMode ?? '').trim().toLowerCase()
                mappedInfo.mode = ['on', 'auto', 'open', '1', 'true'].includes(modeStr) ? 1 : 0
            }
        }
        if (!Object.prototype.hasOwnProperty.call(mappedInfo, 'pidMode')) {
            const pidModeConfigId = await resolveConfigIdByPrefix('pid_enabled')
            if (pidModeConfigId != null) {
                const rawPidMode = await getDirectValue({ config_id: pidModeConfigId, d_no })
                const pidModeStr = String(rawPidMode ?? '').trim().toLowerCase()
                mappedInfo.pidMode = ['on', 'auto', 'open', '1', 'true'].includes(pidModeStr) ? 1 : 0
            }
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
