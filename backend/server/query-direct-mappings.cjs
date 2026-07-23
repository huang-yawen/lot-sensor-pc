const mysql = require('./node_modules/mysql2/promise')

async function main() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '123456',
    database: 'competition',
  })
  const [tables] = await connection.query('SHOW TABLES')
  console.log('TABLES', tables.filter(row => Object.values(row).some(value => String(value).startsWith('t_direct_config'))))
  for (const table of ['t_direct_config', 't_direct_config_before_water']) {
    try {
      const [rows] = await connection.query(`SELECT id, t_name, f_type, preffix FROM ${table} ORDER BY id`)
      console.log(table, rows)
    } catch (error) {
      console.log(table, error.code)
    }
  }
  await connection.end()
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
