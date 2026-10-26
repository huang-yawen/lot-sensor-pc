/** 【文件职责】数据库字段映射查询工具。
 * 【配置中心关联】无直接读取；返回的元数据可被场景页面展示使用。
 *
 * 【两个写入函数，别用混】
 *   saveSceneData  —— 当前生效的唯一写入入口：一条上报消息写三张表
 *                    （t_scene_data 合并表 + t_sensor_data / t_behavior_data 两张旧真表）。
 *   saveMappedData —— "分开版"遗留函数（一次只写一张表，当前无调用方），
 *                    保留只为对照旧逻辑，新代码一律用 saveSceneData。
 * 【谁在用】mqtt/sensorRealtime、mqtt/behaviorRealtime、mqtt/combinedRealtime、mqtt/offlineData。 */

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

// ============================================================================
// 「合并版」：一条上报消息 → 三张表
// ----------------------------------------------------------------------------
// t_scene_data（合并表，一条消息一行）
//   field1 ~ field10 = 传感器槽位（t_sensor_field_mapper.db_name 保持 field1..field10 不变）
//   field11 ~ field20 = 行为槽位 （t_behavior_field_mapper.db_name 仍是 field1..field10，写入时 +10 偏移）
//   has_sensor / has_behavior = 这一行含哪一侧字段，组合数据页面用它挑"完整的消息"
// t_sensor_data  / t_behavior_data（两张旧真表，结构原样）
//   与合并表同时写入，保证"分开版"的旧代码（含历史图表、累计统计、派生指标等）继续有数据。
// ============================================================================

/** 合并后的场景数据表名。 */
const SCENE_TABLE = 't_scene_data'
/** 「分开版」两张旧真表：与合并表同时写入（三写），让任何一版代码都能直接用这套库。 */
const LEGACY_SENSOR_TABLE = 't_sensor_data'
const LEGACY_BEHAVIOR_TABLE = 't_behavior_data'
/** 行为槽位在合并表里的列偏移：行为 mapper 的 field1 → t_scene_data.field11。 */
const BEHAVIOR_SLOT_OFFSET = 10
/** 合并表允许写入的列：field1~field20（传感器 1~10 + 行为 11~20）。 */
const ALLOWED_SCENE_FIELDS = new Set(
  Array.from({ length: 20 }, (_, index) => `field${index + 1}`)
)

/** 取 mapper 行里配置的 db_name（如 field1），按 offset 偏移成合并表的列名（如 field11）。 */
function shiftFieldSlot(dbName, offset) {
  if (!offset) return dbName
  const matched = /^field(\d+)$/.exec(String(dbName || '').trim())
  if (!matched) return null
  return `field${Number(matched[1]) + offset}`
}

/**
 * 把合并表槽位（field1~field20 里的某一段）反向偏移回真表列名：
 *   offset=0  取 field1~field10  （传感器真表 t_sensor_data）
 *   offset=10 取 field11~field20 并映射成 field1~field10（行为真表 t_behavior_data）
 */
function pickTableSlots(slots, offset) {
  const out = {}
  for (const [key, value] of Object.entries(slots)) {
    const matched = /^field(\d+)$/.exec(key)
    if (!matched) continue
    const slot = Number(matched[1]) - offset
    if (slot >= 1 && slot <= 10) out[`field${slot}`] = value
  }
  return out
}

/** 动态列 INSERT。单张表写失败只打日志、不抛异常：三张表各自独立，不让一张表的失败连累另外两张。 */
async function insertRow(table, record, written = []) {
  const columns = Object.keys(record)
  const values = Object.values(record)
  try {
    await promisePool.execute(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      values
    )
    written.push(table)
  } catch (err) {
    console.error(`[MappedData] 写入 ${table} 失败:`, err.message)
  }
  return written
}

/** 把一行上报数据里所有非空、非内部（_ 前缀）的键整理成大小写不敏感的小写 Map。 */
function buildIncomingMap(info) {
  const incoming = new Map()
  for (const [key, value] of Object.entries(info || {})) {
    const lower = String(key).toLowerCase()
    // "_" 前缀是后端自己挂在 info 上的临时字段（如 _traceId、_alarms），不参与字段映射
    if (lower.startsWith('_')) continue
    incoming.set(lower, value)
  }
  return incoming
}

/**
 * 上报数据唯一写入入口：一条消息一次调用，写三张表。
 *
 *   ① t_scene_data      合并表：「一条消息一行」——传感器槽位 field1~field10 +
 *                       行为槽位 field11~field20 + has_sensor / has_behavior 标记。
 *                       组合数据页面（/api/dataByType?type=combined）读这张表。
 *   ② t_sensor_data     传感器侧单独一份（旧真表，结构原样）。历史图表、累计统计、
 *                       派生指标、首页看板、分开版页面等所有旧代码读的都是它。
 *   ③ t_behavior_data   行为侧单独一份（旧真表，结构原样）。
 *
 * 【为什么写三份】旧代码有 33 个文件写死 FROM t_sensor_data / t_behavior_data，
 * 只写合并表的话它们看不到新数据。写三份换来的是「任何一版代码都能直接用同一套库」——
 * 切回"分开版"代码不用动数据库。代价是数据冗余 3 份（每条消息 3 次 INSERT）。
 *
 * 【字段怎么分工】传感器字段按 t_sensor_field_mapper 填 field1~field10（合并表）/
 * field1~field10（传感器表）；行为字段按 t_behavior_field_mapper 填 field11~field20（合并表）/
 * field1~field10（行为表，写入时 +10 偏移、落库时再 -10 还原）。
 * 哪一侧一个字段都没匹配上，就不写那一侧的旧表，并把合并表对应的 has_* 记 0。
 *
 * @param {Object} params
 * @param {Object} params.info - 已解析并补好 c_time 的上报数据
 * @param {string} [params.dateTime] - 写进 c_time 的时间
 * @param {string} [params.dataLabel] - 直接指定 online 列的值（补传数据传 BACKFILL_LABEL）
 * @param {boolean} [params.withSensor=true] - 是否写传感器侧（合并表槽位 + t_sensor_data）
 * @param {boolean} [params.withBehavior=true] - 是否写行为侧（合并表槽位 + t_behavior_data）
 * @returns {Promise<{deviceNo: string|null, sensorFieldCount: number, behaviorFieldCount: number,
 *   written: string[], skipped?: boolean}>} written = 本次真正写成功的表名
 */
async function saveSceneData({ info, dateTime, dataLabel, withSensor = true, withBehavior = true }) {
  const deviceNo = await resolveDeviceNo(info)
  if (!deviceNo) {
    console.warn('[MappedData] 上报数据的设备编号未匹配已注册设备，跳过写入')
    return { deviceNo: null, sensorFieldCount: 0, behaviorFieldCount: 0, written: [], skipped: true }
  }

  const incoming = buildIncomingMap(info)
  const slots = {}   // 合并表槽位：field1~field20

  /**
   * 按一张字段映射表把报文里的值填进 slots。
   * @param {string} mapperTable - 字段映射表名
   * @param {number} offset - 槽位偏移（传感器 0，行为 BEHAVIOR_SLOT_OFFSET）
   * @returns {Promise<number>} 实际填了几个字段
   */
  const fillSlots = async (mapperTable, offset) => {
    const [mappers] = await promisePool.query(
      `SELECT db_name, p_name FROM ${mapperTable} WHERE visible = 1`
    )
    let matched = 0
    for (const mapper of mappers) {
      const target = shiftFieldSlot(mapper.db_name, offset)
      if (!target || !ALLOWED_SCENE_FIELDS.has(target)) continue
      const physicalNames = aliases(mapper.p_name).map(name => name.toLowerCase())
      const matchedName = physicalNames.find(name => incoming.has(name))
      if (!matchedName) continue
      slots[target] = incoming.get(matchedName)
      matched += 1
    }
    return matched
  }

  const sensorFieldCount = withSensor ? await fillSlots('t_sensor_field_mapper', 0) : 0
  const behaviorFieldCount = withBehavior ? await fillSlots('t_behavior_field_mapper', BEHAVIOR_SLOT_OFFSET) : 0

  // 两侧一个字段都没匹配上就不写库（与旧 saveMappedData 的行为一致：不塞空行）
  if (sensorFieldCount === 0 && behaviorFieldCount === 0) {
    console.warn('[MappedData] 两张映射表都没有匹配到字段，跳过写入')
    return { deviceNo, sensorFieldCount, behaviorFieldCount, written: [], skipped: true }
  }

  const timeValue = dateTime ?? null
  // dataLabel 由调用方显式指定 online 列的值（补传数据写"补传数据"）；不传就按上报数据里的 online 判断
  const onlineValue = dataLabel ?? getOnlineLabel(info?.online)
  const written = []

  // ① 合并表：一条消息一行
  await insertRow(SCENE_TABLE, {
    d_no: deviceNo,
    ...slots,
    has_sensor: sensorFieldCount > 0 ? 1 : 0,
    has_behavior: behaviorFieldCount > 0 ? 1 : 0,
    c_time: timeValue,
    online: onlineValue,
  }, written)

  // ② 传感器旧表：只取传感器槽位（field1~field10）
  if (sensorFieldCount > 0) {
    await insertRow(LEGACY_SENSOR_TABLE, {
      d_no: deviceNo,
      ...pickTableSlots(slots, 0),
      c_time: timeValue,
      online: onlineValue,
    }, written)
  }

  // ③ 行为旧表：field11~field20 还原成 field1~field10
  if (behaviorFieldCount > 0) {
    await insertRow(LEGACY_BEHAVIOR_TABLE, {
      d_no: deviceNo,
      ...pickTableSlots(slots, BEHAVIOR_SLOT_OFFSET),
      c_time: timeValue,
      online: onlineValue,
    }, written)
  }

  return { deviceNo, sensorFieldCount, behaviorFieldCount, written }
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
/**
 * 只做「原始报文 → field1..field10 语义槽位记录」的映射，不写库。
 * 抽出这个函数是为了让「保存数据」和「消息即触发智能判定」共用同一套字段映射逻辑，
 * 避免判定服务拿到的字段名和存库的字段名不一致（手动/自动判定发的是库里的整行，即
 * field1~field10；消息实时判定也发这个结构，三种方式对外契约一致）。
 */
async function buildMappedRecord({ table, mapperTable, info, dateTime, dataLabel }) {
  const deviceNo = await resolveDeviceNo(info)
  if (!deviceNo) {
    console.warn(`[MappedData] 上报数据的设备编号未匹配已注册设备，跳过（${table}）`)
    return { deviceNo: null, record: null, mappedFieldCount: 0, skipped: true }
  }

  const [mappers] = await promisePool.query(
    `SELECT db_name, p_name FROM ${mapperTable} WHERE visible = 1`
  )

  const incoming = new Map()
  for (const [key, value] of Object.entries(info || {})) {
    incoming.set(String(key).toLowerCase(), value)
  }

  const record = { d_no: deviceNo }

  for (const mapper of mappers) {
    const dbName = String(mapper.db_name || '').trim()
    const physicalNames = aliases(mapper.p_name).map(name => name.toLowerCase())
    const matchedName = physicalNames.find(name => incoming.has(name))
    // dbName 不在 ALLOWED_DATA_FIELDS（field1~field10）里，或者报文里没有任何候选名
    // 能匹配上，这一条 mapper 直接跳过，不写入 record。
    if (!ALLOWED_DATA_FIELDS.has(dbName) || !matchedName) {
      continue
    }
    record[dbName] = incoming.get(matchedName)
  }

  record.c_time = dateTime
  // dataLabel 由调用方显式指定 online 列的值，目前只有补传数据用（写"补传数据"，
  // 见 mqtt/offlineData/offlineDataHandler.js）；不传就按上报数据里的 online 字段判断。
  record.online = dataLabel ?? getOnlineLabel(info?.online)

  return { deviceNo, record, mappedFieldCount: Object.keys(record).length - 3 }
}

async function saveMappedData(params) {
  const { deviceNo, record, mappedFieldCount, skipped } = await buildMappedRecord(params)
  if (skipped) return { deviceNo: null, mappedFieldCount: 0, skipped: true }

  const columns = Object.keys(record)
  const values = Object.values(record)
  const placeholders = columns.map(() => '?').join(', ')
  await promisePool.execute(
    `INSERT INTO ${params.table} (${columns.join(', ')}) VALUES (${placeholders})`,
    values
  )

  return { deviceNo, mappedFieldCount }
}

module.exports = { saveMappedData, saveSceneData, buildMappedRecord, resolveDeviceNo, resolveDNoByNumber, resolveFieldAliases, getDefaultDeviceId, getAllDeviceIds, SCENE_TABLE }


