/** 【文件职责】数据库字段映射查询工具。
 * 【配置中心关联】无直接读取；返回的元数据可被场景页面展示使用。 */
const promisePool = require('../config/dbPool')
const { getDeviceNo, aliases } = require('./protocol')

const ALLOWED_DATA_FIELDS = new Set(
  Array.from({ length: 10 }, (_, index) => `field${index + 1}`)
)

function getOnlineLabel(value) {
  return String(value).trim() === '1' || value === true ? '实时数据' : '保存数据'
}

/**
 * 上报数据里的设备号候选字段（DEVICE_ID_FIELDS，包含 id）必须能在 t_device.number
 * 里找到完全一致的注册记录，才认为是这个设备的数据；找不到候选字段、或候选字段的值
 * 没有匹配的注册设备，都返回 null——调用方据此跳过保存/上线判断，不再兜底成
 * “数据库里第一个设备”，避免把未注册/编号对不上的数据错记到别的设备上。
 */
async function resolveDeviceNo(info) {
  const reported = getDeviceNo(info)
  if (reported == null) return null
  const normalized = String(reported).trim()
  if (!normalized) return null
  try {
    const [rows] = await promisePool.query(
      'SELECT 1 FROM `t_device` WHERE TRIM(`number`) = ? LIMIT 1',
      [normalized]
    )
    return rows.length > 0 ? normalized : null
  } catch (err) {
    console.error('[MappedData] 校验设备编号失败:', err.message)
    return null
  }
}

/**
 * 单设备模式（SINGLE_DEVICE_MODE=true）下的默认设备号：t_device 表里注册的第一个设备。
 * 只在“确定要用单设备模式的默认设备”这个场景下调用（跟 resolveDeviceNo 不同——那个
 * 是校验 MQTT 上报数据里的设备号是否已注册，找不到就返回 null、不做任何兜底）。
 * 指令中心 t_direct 在单设备模式下也是按这个真实设备号存取的，不是存 d_no=NULL；
 * 调用方如果自己再各写一份"传 null 代表单设备模式"的逻辑，会跟 t_direct 里实际存的
 * 设备号对不上，读写各用各的 key，互相看不到对方写入的值。
 */
async function getDefaultDeviceId() {
  try {
    const [rows] = await promisePool.query(
      'SELECT `number` FROM `t_device` ORDER BY `id` ASC LIMIT 1'
    )
    return rows[0] ? String(rows[0].number).trim() : null
  } catch (err) {
    console.error('[MappedData] 查询默认设备编号失败:', err.message)
    return null
  }
}

const MAPPER_TABLE_BY_DATA_TABLE = {
  t_sensor_data: 't_sensor_field_mapper',
  t_behavior_data: 't_behavior_field_mapper',
}

/**
 * 根据"哪张表的哪个字段槽位"（source_table + source_field，跟 CUMULATIVE_METRICS/
 * TIME_WINDOW_METRICS 用法一致）查字段映射表，返回当前配置的物理名候选列表
 * （p_name 按 | 拆分后的别名数组），用来从设备原始上报数据里取值。
 * 这样告警规则等只需要认字段槽位，物理名改了只用改字段映射表这一处，不用同步改多处配置。
 */
async function resolveFieldAliases(sourceTable, sourceField) {
  const mapperTable = MAPPER_TABLE_BY_DATA_TABLE[sourceTable]
  if (!mapperTable) return []
  const [[row]] = await promisePool.query(
    `SELECT p_name FROM ${mapperTable} WHERE db_name = ? LIMIT 1`,
    [sourceField]
  )
  return row ? aliases(row.p_name) : []
}

/**
 * 根据字段映射表保存设备上报数据。
 * 修改 t_*_field_mapper.p_name 即可适配现场传感器/执行器 JSON，
 * 不再需要为每道赛题改 Node.js 中的硬编码字段。
 */
async function saveMappedData({ table, mapperTable, info, dateTime }) {
  const deviceNo = await resolveDeviceNo(info)
  if (!deviceNo) {
    console.warn(`[MappedData] 上报数据的设备编号未匹配已注册设备，跳过保存（${table}）`)
    return { deviceNo: null, mappedFieldCount: 0, skipped: true }
  }

  const [mappers] = await promisePool.query(
    `SELECT db_name, p_name FROM ${mapperTable} WHERE visible = 1`
  )

  const incoming = new Map()
  for (const [key, value] of Object.entries(info || {})) {
    incoming.set(String(key).toLowerCase(), value)
  }

  const columns = ['d_no']
  const values = [deviceNo]

  for (const mapper of mappers) {
    const dbName = String(mapper.db_name || '').trim()
    const physicalNames = aliases(mapper.p_name).map(name => name.toLowerCase())
    const matchedName = physicalNames.find(name => incoming.has(name))
    if (!ALLOWED_DATA_FIELDS.has(dbName) || !matchedName) {
      continue
    }
    columns.push(dbName)
    values.push(incoming.get(matchedName))
  }

  columns.push('c_time', 'online')
  values.push(dateTime, getOnlineLabel(info?.online))

  const placeholders = columns.map(() => '?').join(', ')
  await promisePool.execute(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
    values
  )

  return { deviceNo: values[0], mappedFieldCount: columns.length - 3 }
}

module.exports = { saveMappedData, resolveDeviceNo, resolveFieldAliases, getDefaultDeviceId }
/**
 * 【文件职责】数据字段映射工具，将数据库或设备的原始字段转换为前端可用结构。
 * 【配置中心关联】如涉及显示字段，会按调用方传入的场景映射处理；本模块不持久化配置。
 */
