/**
 * 【文件职责】配置中心 HTTP 控制器。
 * 提供查询、局部更新、恢复默认、导入、导出接口；导入时将场景 metadata 与数据库元数据
 * 放在事务中校验和写入，失败会回滚。
 * 【配置中心关联】直接读写 systemConfig 全部顶层项，并校验 t_direct_config 的 id、
 * preffix、f_type、parent_id，保证控制字段映射有效。
 *
 * 系统配置 API 控制器
 * GET    /api/system-config          — 获取当前配置
 * POST   /api/system-config          — 更新配置（部分更新，热更新）
 * POST   /api/system-config/reset    — 重置为默认配置
 * GET    /api/system-config/export   — 导出配置（含时间戳，可保存为备份文件）
 * POST   /api/system-config/import   — 导入配置（从备份文件恢复）
 */
const systemConfig = require('../../config/systemConfig')
const promisePool = require('../../config/dbPool')
const { ensureTable: ensureDerivedMetricTable } = require('../../service/derivedMetric/derivedMetricService')

const METADATA_TABLES = ['t_sensor_field_mapper', 't_behavior_field_mapper', 't_direct_config', 't_derived_metric']
const FIELD_MAPPER_TABLES = new Set(['t_sensor_field_mapper', 't_behavior_field_mapper'])

/** value_map 是可选的"数据库原始值 -> 前端展示文案"映射（比如 {"0":"关","1":"开"}），配置了必须是合法 JSON 对象。 */
function validateFieldMapperRows(table, rows) {
  rows.forEach((row, index) => {
    const label = `${table}[${index}]`
    const raw = String(row.value_map || '').trim()
    if (!raw) return
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(`${label}.value_map 不是合法 JSON`)
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label}.value_map 必须是 JSON 对象`)
    }
  })
}

/**
 * 校验 t_direct_config（指令配置树）整体的合法性：id 不能重复、t_name 不能
 * 为空、f_type 只能是这四种类型之一、preffix（MQTT 字段名）不能重复（但
 * 允许为空——有些指令项只在本地使用，不需要下发）、wire_template/
 * wire_on_payload/wire_off_payload 这几个可选的自定义协议字段格式必须是
 * 合法 JSON、ref_id（父级指令）如果填了必须指向一个真实存在的 id。任意
 * 一项不满足就直接抛错，中断整个导入流程，不会导入到一半就报错。
 */
function validateDirectMappings(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('t_direct_config 至少需要一条指令映射')
  const ids = new Set()
  const prefixes = new Set()
  for (const [index, row] of rows.entries()) {
    const label = `t_direct_config[${index}]`
    const id = Number(row.id)
    if (!Number.isInteger(id) || id < 0) throw new Error(`${label}.id 必须是非负整数`)
    if (ids.has(id)) throw new Error(`t_direct_config.id 重复: ${id}`)
    ids.add(id)
    if (!String(row.t_name || '').trim()) throw new Error(`${label}.t_name 不能为空`)
    if (!['1', '2', '3', '4'].includes(String(row.f_type))) throw new Error(`${label}.f_type 只能是 1、2、3、4`)
    // preffix 允许为空：部分指令项（如阈值类参考值）不通过 MQTT 下发，只在本地使用。
    const prefix = String(row.preffix || '').trim()
    if (prefix) {
      if (prefixes.has(prefix)) throw new Error(`MQTT 字段重复: ${prefix}`)
      prefixes.add(prefix)
    }
    // wire_template：开关类指令的自定义协议报文模板（如 Modbus 透传），可选，配置了必须是合法 JSON 对象。
    const wireTemplate = String(row.wire_template || '').trim()
    if (wireTemplate) {
      let parsed
      try {
        parsed = JSON.parse(wireTemplate)
      } catch {
        throw new Error(`${label}.wire_template 不是合法 JSON`)
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${label}.wire_template 必须是 JSON 对象`)
      }
    }
    // wire_on_payload / wire_off_payload：开关类指令开、关各自的完整报文，可选，配置了必须是合法 JSON 对象。
    for (const field of ['wire_on_payload', 'wire_off_payload']) {
      const raw = String(row[field] || '').trim()
      if (!raw) continue
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new Error(`${label}.${field} 不是合法 JSON`)
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${label}.${field} 必须是 JSON 对象`)
      }
    }
  }
  for (const row of rows) {
    if (row.ref_id !== null && row.ref_id !== undefined && row.ref_id !== '' && !ids.has(Number(row.ref_id))) {
      throw new Error(`指令 ${row.id} 的父级 ref_id=${row.ref_id} 不存在`)
    }
  }
}

/** 从数据库读出全部元数据表（字段映射表 + 指令配置树 + 自定义指标定义），
 * 供导出配置时一并打包进备份文件。 */
async function readMetadata(connection = promisePool) {
  const metadata = {}
  for (const table of METADATA_TABLES) {
    const [rows] = await connection.query(`SELECT * FROM ${table} ORDER BY id`)
    metadata[table] = rows
  }
  return metadata
}

/**
 * 用导入数据整个替换掉数据库里的元数据表：先校验（指令树/字段映射表各自
 * 有各自的合法性规则），校验通过才会真的动数据库——每张表都是"先清空再
 * 逐行插入"，不是逐行比对做增量更新，简单直接，代价是导入过程中这张表
 * 会短暂为空（这也是外层调用方要用数据库事务包起来的原因：真正失败时能
 * 整体回滚，不会留下"表已经清空、但还没插完新数据"这种中间状态）。
 * 插入时只挑这张表数据库里实际存在的列（DESCRIBE 查出来的 allowed 集合），
 * 备份文件里带的多余字段会被过滤掉，不会因为带了旧版本已经删除的字段就
 * 插入失败。
 */
async function replaceMetadata(connection, metadata) {
  if (!metadata) return
  for (const table of METADATA_TABLES) {
    if (!Object.prototype.hasOwnProperty.call(metadata, table)) continue
    const rows = metadata[table]
    if (!Array.isArray(rows)) throw new Error(`${table} 必须是数组`)
    if (table === 't_direct_config') validateDirectMappings(rows)
    if (FIELD_MAPPER_TABLES.has(table)) validateFieldMapperRows(table, rows)
    const [description] = await connection.query(`DESCRIBE ${table}`)
    const allowed = new Set(description.map(column => column.Field))
    await connection.query(`DELETE FROM ${table}`)
    for (const row of rows) {
      const columns = Object.keys(row).filter(column => allowed.has(column))
      if (!columns.length) continue
      const escapedColumns = columns.map(column => `\`${column}\``).join(',')
      await connection.execute(
        `INSERT INTO ${table} (${escapedColumns}) VALUES (${columns.map(() => '?').join(',')})`,
        columns.map(column => row[column])
      )
    }
  }
}

// GET /api/system-config — 获取当前配置
const getConfig = (req, res) => {
  res.json({
    success: true,
    data: systemConfig.getConfig(),
  })
}

// POST /api/system-config — 更新配置
const updateConfig = (req, res) => {
  try {
    const partial = req.body
    if (!partial || typeof partial !== 'object' || Object.keys(partial).length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供需要更新的配置项',
      })
    }

    const updated = systemConfig.updateConfig(partial)
    res.json({ success: true, data: updated, message: '配置已持久化并热更新' })
  } catch (err) {
    console.error('[SystemConfig] 更新配置失败:', err)
    res.status(500).json({
      success: false,
      message: '更新配置失败: ' + err.message,
    })
  }
}

// POST /api/system-config/reset — 重置为默认配置
const resetConfig = (req, res) => {
  try {
    const config = systemConfig.resetConfig()
    res.json({
      success: true,
      data: config,
      message: '配置已重置为默认值',
    })
  } catch (err) {
    console.error('[SystemConfig] 重置配置失败:', err)
    res.status(500).json({
      success: false,
      message: '重置配置失败: ' + err.message,
    })
  }
}

// GET /api/system-config/export — 导出配置
const exportConfig = async (req, res) => {
  try {
    await ensureDerivedMetricTable()
    const config = systemConfig.exportConfig()
    config.metadata = await readMetadata()
    res.json({
      success: true,
      data: config,
      message: '配置导出成功',
    })
  } catch (err) {
    console.error('[SystemConfig] 导出配置失败:', err)
    res.status(500).json({
      success: false,
      message: '导出配置失败: ' + err.message,
    })
  }
}

// POST /api/system-config/import — 导入配置
// 数据库元数据表和内存里的 systemConfig 是两套独立的存储，不在同一个事务里，
// 所以这里做了双重保险：数据库那边用真正的事务（beginTransaction/commit/
// rollback）；内存这边先记下 previous（导入前的配置快照），如果数据库
// 事务失败，紧接着把内存配置也强制改回 previous——避免出现"数据库已经
// 回滚、但内存里的配置已经被 importConfig 改成新值"这种两边不一致的情况。
const importConfig = async (req, res) => {
  try {
    const config = req.body
    if (!config || typeof config !== 'object') {
      return res.status(400).json({
        success: false,
        message: '请提供有效的配置数据',
      })
    }

    await ensureDerivedMetricTable()
    const connection = await promisePool.getConnection()
    const previous = systemConfig.exportConfig()
    try {
      await connection.beginTransaction()
      await replaceMetadata(connection, config.metadata)
      const imported = systemConfig.importConfig(config)
      await connection.commit()
      res.json({ success: true, data: imported, message: '场景配置与数据库元数据已事务导入' })
    } catch (error) {
      await connection.rollback()
      try { systemConfig.importConfig(previous) } catch {}
      throw error
    } finally {
      connection.release()
    }
  } catch (err) {
    console.error('[SystemConfig] 导入配置失败:', err)
    res.status(500).json({
      success: false,
      message: '导入配置失败: ' + err.message,
    })
  }
}

module.exports = {
  getConfig,
  updateConfig,
  resetConfig,
  exportConfig,
  importConfig,
}
