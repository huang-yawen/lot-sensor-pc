/**
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
    if (!['1', '2', '3', '4', '6'].includes(String(row.f_type))) throw new Error(`${label}.f_type 只能是 1、2、3、4、6`)
    const prefix = String(row.preffix || '').trim()
    if (!prefix) throw new Error(`${label}.preffix 不能为空`)
    if (prefixes.has(prefix)) throw new Error(`MQTT 字段重复: ${prefix}`)
    prefixes.add(prefix)
  }
  for (const row of rows) {
    if (row.ref_id !== null && row.ref_id !== undefined && row.ref_id !== '' && !ids.has(Number(row.ref_id))) {
      throw new Error(`指令 ${row.id} 的父级 ref_id=${row.ref_id} 不存在`)
    }
  }
}

async function readMetadata(connection = promisePool) {
  const metadata = {}
  for (const table of METADATA_TABLES) {
    const [rows] = await connection.query(`SELECT * FROM ${table} ORDER BY id`)
    metadata[table] = rows
  }
  return metadata
}

async function replaceMetadata(connection, metadata) {
  if (!metadata) return
  for (const table of METADATA_TABLES) {
    if (!Object.prototype.hasOwnProperty.call(metadata, table)) continue
    const rows = metadata[table]
    if (!Array.isArray(rows)) throw new Error(`${table} 必须是数组`)
    if (table === 't_direct_config') validateDirectMappings(rows)
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
