/**
 * 【文件职责】故障前快照服务：故障触发瞬间捕获指令页面所有开关状态和数值参数，
 *   故障复位时按快照恢复水泵/加热等执行器**开关**状态（数值/阈值类指令项不回写，
 *   避免覆盖用户在故障期间的合法修改——安全联锁"故障期间可调阈值排查问题"是有意放行的）。
 *
 *   快照按设备隔离（多设备模式下每个设备一份），仅保留最新一份（覆盖式），
 *   因为同一设备多个故障顺序触发时，应该恢复的是"最近一次故障前"的状态，
 *   而不是更早那份"已经过时的状态"。
 *
 *   快照内不含：复位按钮自身的状态（复位按钮是单独的状态机）。
 *
 * 【快照内容】
 *   - 所有 t_direct 当前的 { config_id, preffix, t_name, value } 列表
 *   - 抓取时刻的时间戳（用于诊断）
 *   - 触发该次快照的故障 id（用于诊断）
 *
 * 【配置】无直接读取，所有指令项从 t_direct 实时查询。
 */
const promisePool = require('../../config/dbPool')
const { saveDirectData } = require('../directData/saveDirectConfig')

/** 设备 -> 最新快照 */
const snapshotMap = new Map()

/**
 * 保存当前指令页面所有开关/参数值为故障前快照。
 * @param {string|null} deviceNo - 设备编号，null/全局 时按 'global' 存储
 * @param {string} triggerId - 触发该次快照的故障 id（诊断用）
 * @returns {Object|null} 快照对象
 */
async function saveSnapshot(deviceNo, triggerId) {
  const key = deviceNo || 'global'
  try {
    // 1) 抓取所有 t_direct_config（开关 + 数值参数）的当前值，不按 f_type 过滤——
    //    必须覆盖输入框/滑块等数值类型（目标温度、Kp/Ki/Kd、各类阈值等），只排除
    //    复位按钮自身（它是独立状态机，见文件头部说明）。之前这里误写成只取
    //    f_type IN ('1','0')，导致数值参数没被快照覆盖，与本文件顶部文档描述不符。
    //    优先设备专属值，缺失则取全局值
    const [rows] = await promisePool.query(`
      SELECT
        c.id AS config_id,
        c.preffix,
        c.t_name,
        c.f_type,
        COALESCE(d_specific.value, d_global.value) AS value,
        CASE WHEN d_specific.value IS NOT NULL THEN 'device' ELSE 'global' END AS value_scope
      FROM t_direct_config c
      LEFT JOIN t_direct d_specific
        ON d_specific.config_id = c.id AND d_specific.d_no = ?
      LEFT JOIN t_direct d_global
        ON d_global.config_id = c.id AND d_global.d_no IS NULL
      WHERE (c.preffix IS NULL OR LOWER(c.preffix) != 'reset_button')
      ORDER BY c.id ASC
    `, [deviceNo || null])

    // 过滤掉完全没设值的（避免恢复时把没有的也写成 null）
    const items = rows
      .filter(r => r.value != null)
      .map(r => ({
        config_id: r.config_id,
        preffix: r.preffix,
        t_name: r.t_name,
        f_type: String(r.f_type),
        value: r.value,
        value_scope: r.value_scope,
      }))

    const snapshot = {
      deviceNo: deviceNo || null,
      triggerId,
      capturedAt: Date.now(),
      items,
    }
    snapshotMap.set(key, snapshot)
    console.log(`[FaultSnapshot] 已保存故障前快照 | 设备=${key} | 故障=${triggerId} | 项数=${items.length}`)
    return snapshot
  } catch (err) {
    console.error('[FaultSnapshot] 保存快照失败:', err.message)
    return null
  }
}

/**
 * 获取某设备的最新快照（不消费，仅查询）。
 */
function getSnapshot(deviceNo) {
  return snapshotMap.get(deviceNo || 'global') || null
}

/**
 * 从快照只恢复开关类指令项（f_type=1）的状态到指令页面（重写 t_direct），数值/阈值类
 * 不回写（见下方 for 循环注释）；并按快照中记录的开关状态重新启动对应执行器。
 *
 * 注意：恢复时不发布 MQTT 指令给设备硬件，由调用方在恢复完成后统一触发
 * "按快照开关状态重启执行器"。这里只负责把 t_direct 数据恢复到快照时刻的样子。
 *
 * @param {string|null} deviceNo
 * @returns {Object} 恢复结果 { restored: number, snapshotTriggerId, items: [...] }
 */
async function restoreFromSnapshot(deviceNo) {
  const key = deviceNo || 'global'
  const snapshot = snapshotMap.get(key)
  if (!snapshot) {
    console.warn(`[FaultSnapshot] 没有可恢复的快照 | 设备=${key}`)
    return { restored: 0, snapshotTriggerId: null, items: [] }
  }

  let restored = 0
  const restoredItems = []
  for (const item of snapshot.items) {
    // 只恢复开关类（f_type=1）。故障期间没有任何自动流程会改数值/阈值类指令项，
    // 只有用户手动改（且安全联锁有意放行"故障期间调阈值排查问题"），把它们一并回写
    // 只会覆盖掉用户的合法修改。快照仍完整抓取所有项（供 getSwitchValueByPrefix 查
    // 开关状态、以及诊断），恢复只动开关。
    if (String(item.f_type) !== '1') continue
    try {
      await saveDirectData({
        config_id: item.config_id,
        value: item.value,
        d_no: item.value_scope === 'device' ? deviceNo : null,
      })
      restored++
      restoredItems.push({
        config_id: item.config_id,
        preffix: item.preffix,
        t_name: item.t_name,
        value: item.value,
      })
    } catch (err) {
      console.error(`[FaultSnapshot] 恢复项失败 config_id=${item.config_id}:`, err.message)
    }
  }
  const switchCount = snapshot.items.filter(it => String(it.f_type) === '1').length
  console.log(`[FaultSnapshot] 已从快照恢复开关项 | 设备=${key} | ${restored}/${switchCount}（数值/阈值类不回写，共 ${snapshot.items.length} 项）`)
  return {
    restored,
    snapshotTriggerId: snapshot.triggerId,
    items: restoredItems,
  }
}

/**
 * 清除某设备的快照（用于故障完全解除后清理状态）。
 */
function clearSnapshot(deviceNo) {
  snapshotMap.delete(deviceNo || 'global')
}

/**
 * 获取快照中某个 preffix 对应的开关状态（开/关）。
 * 用于故障复位时按快照重启执行器：从快照里查 pump/heater 状态。
 *
 * @param {string|null} deviceNo
 * @param {string} preffix - 比如 'pump' / 'heater'
 * @returns {string|null} 'on' | 'off' | null(快照里没有)
 */
function getSwitchValueByPrefix(deviceNo, preffix) {
  const snapshot = snapshotMap.get(deviceNo || 'global')
  if (!snapshot) return null
  const item = snapshot.items.find(it =>
    (it.preffix || '').toLowerCase() === (preffix || '').toLowerCase()
  )
  if (!item) return null
  const v = String(item.value).trim().toLowerCase()
  if (['on', 'open', '1', 'true'].includes(v)) return 'on'
  if (['off', 'close', 'closed', '0', 'false'].includes(v)) return 'off'
  return null
}

module.exports = {
  saveSnapshot,
  getSnapshot,
  restoreFromSnapshot,
  clearSnapshot,
  getSwitchValueByPrefix,
}
