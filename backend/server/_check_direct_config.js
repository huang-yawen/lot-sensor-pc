const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({ host:'127.0.0.1', port:3306, user:'root', password:'123456', database:'competition' });
  const [rows] = await conn.query('SELECT id, t_name, preffix, f_type FROM t_direct_config ORDER BY id');
  console.log('t_direct_config 共', rows.length, '条:');
  rows.forEach(r => console.log(r.id, '|', r.t_name, '| preffix=', r.preffix, '| f_type=', r.f_type));
  await conn.end();
})().catch(e => console.log('查询失败:', e.message));
