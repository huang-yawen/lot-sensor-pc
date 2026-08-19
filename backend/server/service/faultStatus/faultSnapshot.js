/**
 * 【文件职责】故障前快照服务：故障触发瞬间捕获指令页面所有开关状态和数值参数，
 *   故障复位时按快照原样恢复（包括水泵/加热等执行器开关状态），确保用户修复设备
 *   后一键恢复到故障前的运行配置，避免重新输入参数。
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
 * 【配置中心关联】无直接读取，所有指令项从 t_direct 实时查询。
 */
const promisePool = require('../../config/dbPool')
const { saveDirectData, getDirectValue } = require('../directData/saveDirectConfig')

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
    // 1) 抓取所有 t_direct_config（开关 + 数值参数）的当前值
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
      WHERE c.f_type IN ('1', '0')
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
 * 从快照恢复所有参数和开关状态到指令页面（重写 t_direct），
 * 并按快照中记录的开关状态重新启动对应执行器。
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
  console.log(`[FaultSnapshot] 已从快照恢复 | 设备=${key} | 恢复项数=${restored}/${snapshot.items.length}`)
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
