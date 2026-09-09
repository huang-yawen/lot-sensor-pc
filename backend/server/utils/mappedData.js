/** 【文件职责】数据库字段映射查询工具。
 * 【配置中心关联】无直接读取；返回的元数据可被场景页面展示使用。 */
const promisePool = require('../config/dbPool')
const { getDeviceNo, aliases } = require('./protocol')

// 数据表能写入的字段槽位白名单：field1~field10。字段映射表里配置的 db_name
// 如果不在这个名单里，saveMappedData 会直接跳过，不会往表里塞一个不存在的列名。
const ALLOWED_DATA_FIELDS = new Set(
  Array.from({ length: 10 }, (_, index) => `field${index + 1}`)
)

/** 把上报数据里的 online 字段转成中文展示标签，这里只是"存进数据库的标签
 * 值"，跟"实时数据/保存数据"真正的判定逻辑（看是不是这张表最新一条记录，
 * 见 utils/recencyFilter.js）是两回事，不要混淆。 */
function getOnlineLabel(value) {
  return String(value).trim() === '1' || value === true ? '实时数据' : '保存数据'
}

/**
 * 拿 MQTT 上报的原始设备号（对应 t_device.number）去查这台设备的 d_no（系统内部
 * 统一使用的设备编号，t_sensor_data/t_behavior_data/t_direct 等表都用它做外键，
 * 前端也展示它）。number 在 t_device 里查不到时返回 null；查到了但 d_no 没填时，
 * 用 number 本身顶替，保证没配置 d_no 的设备照常工作。
 */
async function resolveDNoByNumber(rawNumber) {
  const normalized = String(rawNumber ?? '').trim()
  if (!normalized) return null
  try {
    const [rows] = await promisePool.query(
      'SELECT `d_no` FROM `t_device` WHERE TRIM(`number`) = ? LIMIT 1',
      [normalized]
    )
    if (rows.length === 0) return null
    const dNo = String(rows[0].d_no ?? '').trim()
    return dNo || normalized
  } catch (err) {
    console.error('[MappedData] 查询设备 d_no 失败:', err.message)
    return null
  }
}

/**
 * 从上报数据（DEVICE_ID_FIELDS，包含 id）里取出设备号，去 t_device.number 里查
 * 有没有完全一致的注册记录，查到了就返回这台设备的 d_no（见 resolveDNoByNumber）。
 * 取不到候选字段、或候选字段的值查不到匹配记录，都返回 null。调用方拿到 null 就
 * 跳过保存/上线判断，不会去用"数据库里第一个设备"顶替。
 */
async function resolveDeviceNo(info) {
  const reported = getDeviceNo(info)
  if (reported == null) return null
  return resolveDNoByNumber(reported)
}

/**
 * 单设备模式（SINGLE_DEVICE_MODE=true）下的默认设备号：查 t_device 表里注册的第一个
 * 设备，返回它的 d_no（d_no 没填时用 number 顶替，见 resolveDNoByNumber）。跟
 * resolveDeviceNo 不同：那个是校验 MQTT 上报数据里的设备号是否已注册，找不到就返回
 * null；这个是直接取表里第一条注册记录。单设备模式下指令中心 t_direct 也是按这个
 * d_no 存取的（不是 d_no=NULL），调用方应该用这个函数取到的设备号去读写 t_direct，
 * 而不是自己传 null。
 */
async function getDefaultDeviceId() {
  try {
    const [rows] = await promisePool.query(
      'SELECT `number`, `d_no` FROM `t_device` ORDER BY `id` ASC LIMIT 1'
    )
    if (!rows[0]) return null
    const dNo = String(rows[0].d_no ?? '').trim()
    return dNo || String(rows[0].number ?? '').trim() || null
  } catch (err) {
    console.error('[MappedData] 查询默认设备编号失败:', err.message)
    return null
  }
}

/**
 * 多设备模式下取全部注册设备的 d_no 列表（d_no 没填时用 number 顶替，规则同
 * getDefaultDeviceId）。目前给 faultStatus.js 启动时逐设备恢复故障态用。
 */
async function getAllDeviceIds() {
  try {
    const [rows] = await promisePool.query('SELECT `number`, `d_no` FROM `t_device`')
    return rows
      .map(row => String(row.d_no ?? '').trim() || String(row.number ?? '').trim())
      .filter(Boolean)
  } catch (err) {
    console.error('[MappedData] 查询设备编号列表失败:', err.message)
    return []
  }
}

/** 数据表 -> 对应的字段映射表，两张数据表各自维护一份独立的映射配置。 */
const MAPPER_TABLE_BY_DATA_TABLE = {
  t_sensor_data: 't_sensor_field_mapper',
  t_behavior_data: 't_behavior_field_mapper',
}

/**
 * 传入"哪张表的哪个字段槽位"（source_table + source_field，跟 CUMULATIVE_METRICS/
 * TIME_WINDOW_METRICS 用法一致），查字段映射表拿到这个槽位当前配置的 p_name，按 |
 * 拆分成候选物理名数组返回，供调用方从设备原始上报数据里按这些候选名取值。
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
 *
 * 【这个函数具体是怎么把 MQTT 报文里的字段"对号入座"存进数据库的】
 * 举例：现场设备上报 { "Tin": 25.3, "Flow": 4.2 }，数据库表 t_sensor_data 里只有
 * field1/field2/... 这种没有语义的槽位列，t_sensor_field_mapper 表里配了一行
 * db_name='field1'，p_name='Tin|inlet_temperature|temp_in'（用 | 分隔多个候选别名，
 * 兼容不同设备厂商叫法不一样的情况）。这个函数会：
 *   1. 查出 mapper 表里 visible=1（页面上勾选了"可见"）的每一行；
 *   2. 把 p_name 按 | 拆开，得到这一行的全部候选属性名（比如 ['Tin','inlet_temperature','temp_in']）；
 *   3. 逐个候选名去 MQTT 报文（incoming）里找，只要命中任意一个候选名，就把这个值存进
 *      对应的 db_name 列（这里是 field1）；
 *   4. 全部没配置 visible=1、或者报文里根本没有任何候选名匹配上的字段，直接跳过不存。
 * 匹配时不区分大小写：incoming 的 key 和候选名都先转成小写再比较。
 *
 * @param {string} [dataLabel] - 直接指定写进 online 列的标签值。不传时按上报数据里的
 *   online 字段走 getOnlineLabel 判断（现有实时链路都不传）。补传数据传"补传数据"。
 */
async function saveMappedData({ table, mapperTable, info, dateTime, dataLabel }) {
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
    // dbName 不在 ALLOWED_DATA_FIELDS（field1~field10）里，或者报文里没有任何候选名
    // 能匹配上，这一条 mapper 直接跳过，不写入 columns/values。
    if (!ALLOWED_DATA_FIELDS.has(dbName) || !matchedName) {
      continue
    }
    columns.push(dbName)
    values.push(incoming.get(matchedName))
  }

  columns.push('c_time', 'online')
  // dataLabel 由调用方显式指定 online 列的值，目前只有补传数据用（写"补传数据"，
  // 见 mqtt/offlineData/offlineDataHandler.js）；不传就按上报数据里的 online 字段判断。
  values.push(dateTime, dataLabel ?? getOnlineLabel(info?.online))

  const placeholders = columns.map(() => '?').join(', ')
  await promisePool.execute(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
    values
  )

  return { deviceNo: values[0], mappedFieldCount: columns.length - 3 }
}

module.exports = { saveMappedData, resolveDeviceNo, resolveDNoByNumber, resolveFieldAliases, getDefaultDeviceId, getAllDeviceIds }
/**
 * 【文件职责】数据字段映射工具，将数据库或设备的原始字段转换为前端可用结构。
 * 【配置中心关联】如涉及显示字段，会按调用方传入的场景映射处理；本模块不持久化配置。
 */
