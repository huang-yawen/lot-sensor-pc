require('./backend/server/config/env')
const pool = require('./backend/server/config/dbPool')

async function main() {
  const [[cnt]] = await pool.query('SELECT COUNT(*) c FROM t_behavior_data')
  console.log('t_behavior_data 总行数:', cnt.c)

  const [idx] = await pool.query('SHOW INDEX FROM t_behavior_data')
  console.log('索引:', idx.map(i => `${i.Key_name}(${i.Column_name})`).join(', '))

  const [[minMax]] = await pool.query('SELECT MIN(c_time) mn, MAX(c_time) mx FROM t_behavior_data')
  console.log('时间范围:', minMax.mn, '~', minMax.mx)

  const t0 = Date.now()
  await pool.query(`
    SELECT SUM(COALESCE(is_on * LEAST(dt_sec, 10), 0)) / 60 AS total_minutes
    FROM (
      SELECT
        CASE WHEN TRIM(field3)='1' THEN 1 ELSE 0 END AS is_on,
        TIMESTAMPDIFF(SECOND, LAG(c_time) OVER (ORDER BY c_time ASC, id ASC), c_time) AS dt_sec
      FROM t_behavior_data
    ) t
  `)
  console.log('全表窗口函数累计查询耗时(ms):', Date.now() - t0)

  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
