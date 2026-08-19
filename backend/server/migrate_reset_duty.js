const mysql = require('mysql2/promise');
const fs = require('fs');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root', password: '123456', database: 'competition'
  });

  const log = [];

  const [maxOrderRows] = await conn.query("SELECT MAX(CAST(`order` AS UNSIGNED)) as maxOrder FROM t_direct_config WHERE ref_id IS NULL");
  const nextOrder = String((maxOrderRows[0].maxOrder || 0) + 1);

  const [maxIdRows] = await conn.query("SELECT MAX(id) as maxId FROM t_direct_config");
  const nextId = maxIdRows[0].maxId + 1;

  await conn.query(
    "INSERT INTO t_direct_config (id, ref_id, ref_value, t_name, f_type, f_value, `order`, preffix) VALUES (?, NULL, NULL, ?, '1', ?, ?, ?)",
    [nextId, '复位', '关:off|开:on', nextOrder, 'reset_all']
  );
  log.push(`INSERT reset switch config_id=${nextId}, order=${nextOrder}`);

  const [delDirect] = await conn.query("DELETE FROM t_direct WHERE config_id=15");
  log.push(`DELETE t_direct WHERE config_id=15, affectedRows=${delDirect.affectedRows}`);

  const [delConfig] = await conn.query("DELETE FROM t_direct_config WHERE id=15");
  log.push(`DELETE t_direct_config WHERE id=15, affectedRows=${delConfig.affectedRows}`);

  const [verify] = await conn.query("SELECT id, ref_id, t_name, f_type, f_value, preffix, `order` FROM t_direct_config WHERE ref_id IS NULL OR id=16 ORDER BY ref_id IS NULL DESC, `order`");

  fs.writeFileSync('migrate_reset_duty_out.json', JSON.stringify({ log, verify }, null, 2), 'utf8');
  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
