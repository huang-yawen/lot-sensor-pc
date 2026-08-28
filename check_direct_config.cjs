require('./backend/server/config/env')
const pool = require('./backend/server/config/dbPool')

async function main() {
  const [desc] = await pool.query('DESCRIBE t_direct_config')
  console.log('=== t_direct_config 表结构 ===')
  console.log(desc.map(d => d.Field).join(', '))

  const [rows] = await pool.query("SELECT * FROM t_direct_config WHERE t_name LIKE '%水泵%' OR t_name LIKE '%加热%'")
  console.log('=== 水泵/加热相关记录 ===')
  console.log(JSON.stringify(rows, null, 2))

  const [behaviorMapper] = await pool.query("SELECT * FROM t_behavior_field_mapper")
  console.log('=== t_behavior_field_mapper 全部记录 ===')
  console.log(JSON.stringify(behaviorMapper, null, 2))

  const [directDesc] = await pool.query('DESCRIBE t_direct')
  console.log('=== t_direct 表结构 ===')
  console.log(directDesc.map(d => d.Field).join(', '))

  const [directSample] = await pool.query('SELECT * FROM t_direct LIMIT 10')
  console.log('=== t_direct 样本数据 ===')
  console.log(JSON.stringify(directSample, null, 2))

  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
