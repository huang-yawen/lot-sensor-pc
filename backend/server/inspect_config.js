const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root', password: '123456', database: 'competition'
  });

  console.log('--- 顶层开关 (ref_id IS NULL, f_type=1) ---');
  const [topSwitches] = await conn.query(
    "SELECT id, t_name, ref_id, ref_value, f_type, f_value, preffix, `order` FROM t_direct_config WHERE ref_id IS NULL AND f_type='1' ORDER BY `order`, id"
  );
  console.table(topSwitches);

  console.log('--- 占空比上限/下限 ---');
  const [duty] = await conn.query(
    "SELECT id, t_name, ref_id, ref_value, f_type, f_value, preffix, min, max, step, `order` FROM t_direct_config WHERE t_name LIKE '%占空比%'"
  );
  console.table(duty);

  console.log('--- t_direct_config 全部列名 ---');
  const [cols] = await conn.query("SHOW COLUMNS FROM t_direct_config");
  console.table(cols.map(c => ({ Field: c.Field, Type: c.Type, Null: c.Null, Default: c.Default })));

  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
