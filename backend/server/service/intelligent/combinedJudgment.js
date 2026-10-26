/**
 * 【文件职责】组合判定（type='combined'）的「数据库槽位 → 设备上报语义字段名」还原。
 *
 * ═══════════════ 为什么需要它 ═══════════════
 * 合并版把一条上报消息存成 t_scene_data 一行：传感器占 field1~field10、行为占 field11~field20。
 * 但判定服务需要的是**有语义的字段名**（temp_in / pump …），也就是设备当初上报的那个样子。
 * 本模块按两张字段映射表的 p_name 把槽位值还原成这些名字：
 *
 *   t_sensor_field_mapper  : db_name = field1, p_name = 'temp_in'
 *                            →  报文里的 temp_in = t_scene_data.field1
 *   t_behavior_field_mapper: db_name = field1, p_name = 'pump'
 *                            →  报文里的 pump    = t_scene_data.field11   （行为统一 +10 偏移）
 *
 * 改设备上报字段名时只要改映射表，这里自动跟着变，**不用改代码**。
 *
 * ═══════════════ 输入 / 输出示例 ═══════════════
 * 数据库里的一行（SELECT * FROM t_scene_data WHERE id = 117027）：
 *   { id:117027, d_no:'202606', c_time:'2005-01-01 00:14:47',
 *     field1:'24.6', field2:'25.9', field3:'0', field4:'1.4', field5..field10:null,
 *     field11:'0', field12:'0', field13:'0', field14:null, …, has_sensor:1, has_behavior:1, online:'保存数据' }
 * 还原之后（就是最终发给判定服务的那条记录）：
 *   { d_no:'202606', c_time:'2005-01-01 00:14:47',
 *     temp_in:'24.6', temp_out:'25.9', flow:'0', pressure:'1.4',   ← 来自 field1~field4
 *     pump:'0', heater:'0', mode:'0' }                              ← 来自 field11~field13（pidMode 那行 visible=0 被跳过）
 *
 * ═══════════════ 三个必须知道的边界 ═══════════════
 *  1) 只取映射表里 **visible = 1** 的行 —— 想让判定服务少收到某个字段，把该行 visible 改成 0 即可
 *     （不改代码、不改表结构；例如 PID恒温 pidMode 现在就是 visible=0，所以不在报文里）。
 *  2) 字段名取 p_name 的**第一个别名**（p_name 支持 "A|B|C" 写法，写在前面的优先）。
 *  3) 还原后的记录**故意不带 id**：utils/protocol.js 的 DEVICE_ID_FIELDS 候选里有 'id'，
 *     带上它会被当成设备编号写进 t_judgment_record（把行号当设备号）。设备号只用 d_no 表达。
 *     ⚠ 因此调用方必须**显式把 ids 传给 judgeAndSave**（不传它会取 records.map(r => r.id) 得到一堆 undefined）。
 *
 * 【前缀】config.js 的 INTELLIGENT_JUDGMENT.combinedPrefix 可按侧加前缀（{ sensor:'s_', behavior:'b_' }），
 *   默认不加；只在两侧出现同名物理字段（例如都叫 flow）时才需要。
 */
const promisePool = require('../../config/dbPool')
const { aliases } = require('../../utils/protocol')
const { INTELLIGENT_JUDGMENT } = require('./config')

/** 行为槽位在 t_scene_data 里的列偏移：行为 field1 → field11。与写入侧必须一致。 */
const BEHAVIOR_SLOT_OFFSET = 10

/** field7 → field17（offset=10）；不是 fieldN 形式或越界返回 null。 */
function shiftSlot(dbName, offset) {
  const matched = /^field(\d+)$/.exec(String(dbName || '').trim())
  if (!matched) return null
  const slot = Number(matched[1]) + offset
  return slot >= 1 && slot <= 20 ? `field${slot}` : null
}

/**
 * 组装「合并表列名 → 判定报文里的字段名」对照表（每次判定都重新查一遍，改映射表后免重启即生效）。
 *
 * 对照表长这样（以本项目当前映射配置为例）：
 *   [ { column:'field1',  name:'temp_in'  },   // 传感器侧：column 就是 t_scene_data 的列名
 *     { column:'field2',  name:'temp_out' },
 *     { column:'field3',  name:'flow'     },
 *     { column:'field4',  name:'pressure' },
 *     { column:'field11', name:'pump'     },   // 行为侧：field1 → field11（+10 偏移）
 *     { column:'field12', name:'heater'   },
 *     { column:'field13', name:'mode'     } ]
 *
 * 生成规则（改映射表即可改变结果，不用改代码）：
 *   1. 只查 visible = 1 的行；
 *   2. name 取 p_name 的第一个别名（aliases() 按 | 或 , 拆分）；
 *   3. 传感器侧 column 原样用 db_name；行为侧 column = db_name 的槽位号 + 10；
 *   4. 需要加前缀时用 config.js 的 combinedPrefix（默认空串 = 不加）。
 *
 * @returns {Promise<Array<{ column: string, name: string }>>} column = t_scene_data 的列名
 */
async function loadFieldPairs() {
  const [sensorMappers] = await promisePool.query(
    'SELECT db_name, p_name FROM t_sensor_field_mapper WHERE visible = 1 ORDER BY id'
  )
  const [behaviorMappers] = await promisePool.query(
    'SELECT db_name, p_name FROM t_behavior_field_mapper WHERE visible = 1 ORDER BY id'
  )
  const prefix = INTELLIGENT_JUDGMENT.combinedPrefix || {}

  const pairs = []
  for (const mapper of sensorMappers) {
    const name = aliases(mapper.p_name)[0]
    const column = shiftSlot(mapper.db_name, 0)
    if (!name || !column) continue
    pairs.push({ column, name: `${prefix.sensor || ''}${name}` })
  }
  for (const mapper of behaviorMappers) {
    const name = aliases(mapper.p_name)[0]
    const column = shiftSlot(mapper.db_name, BEHAVIOR_SLOT_OFFSET)
    if (!name || !column) continue
    pairs.push({ column, name: `${prefix.behavior || ''}${name}` })
  }
  return pairs
}

/**
 * 把 t_scene_data 的行还原成"设备上报结构"的判定记录（组合判定的核心一步）。
 *
 * 做法：以 loadFieldPairs() 的对照表为准，把每行的槽位值搬到语义字段名下，并保留
 * d_no 与 c_time；**不带 id**（原因见文件头第 3 条边界）。
 *
 * 输入（SELECT * FROM t_scene_data 的结果，字段名是数据库槽位）：
 *   [ { id:117027, d_no:'202606', c_time:'2005-01-01 00:14:47',
 *       field1:'24.6', field2:'25.9', field3:'0', field4:'1.4', …, field11:'0', field12:'0', field13:'0' } ]
 * 输出（最终发给判定服务的记录）：
 *   [ { d_no:'202606', c_time:'2005-01-01 00:14:47',
 *       temp_in:'24.6', temp_out:'25.9', flow:'0', pressure:'1.4',
 *       pump:'0', heater:'0', mode:'0' } ]
 *
 * 注意：值为 null 的槽位也会照原样带过去（判定服务能区分"没有这个字段"和"值是空"）；
 *       d_no / c_time 为空时直接不写这两个键（避免出现 "d_no": null 这种噪声字段）。
 *
 * @param {Array<Object>} rows - SELECT * FROM t_scene_data 的结果
 * @returns {Promise<Array<Object>>} 每条记录形如 { d_no, c_time, temp_in, …, pump, heater, mode }
 */
async function toCombinedPayloadRecords(rows) {
  const pairs = await loadFieldPairs()
  return rows.map((row) => {
    const record = {}
    if (row.d_no != null) record.d_no = row.d_no
    if (row.c_time != null) record.c_time = row.c_time
    for (const { column, name } of pairs) {
      if (row[column] !== undefined) record[name] = row[column]
    }
    return record
  })
}

module.exports = { toCombinedPayloadRecords, loadFieldPairs, BEHAVIOR_SLOT_OFFSET }
