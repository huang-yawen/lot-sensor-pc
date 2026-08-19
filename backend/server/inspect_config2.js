const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root', password: '123456', database: 'competition'
  });

  console.log('--- t_direct_config 全部列名 ---');
  const [cols] = await conn.query("SHOW COLUMNS FROM t_direct_config");
  console.log(cols.map(c => c.Field).join(', '));

  console.log('--- 占空比上限/下限 (完整字段) ---');
  const [duty] = await conn.query(
    "SELECT * FROM t_direct_config WHERE t_name LIKE '%占空比%'"
  );
  console.log(JSON.stringify(duty, null, 2));

  console.log('--- 顶层开关完整字段(pump/heater) ---');
  const [tops] = await conn.query(
    "SELECT * FROM t_direct_config WHERE id IN (1,2)"
  );
  console.log(JSON.stringify(tops, null, 2));

  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
