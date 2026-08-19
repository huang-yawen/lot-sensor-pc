const mysql = require('mysql2/promise');
const fs = require('fs');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root', password: '123456', database: 'competition'
  });

  const [cols] = await conn.query("SHOW COLUMNS FROM t_direct_config");
  const [directRows] = await conn.query("SELECT * FROM t_direct WHERE config_id=15");
  const [historyRows] = await conn.query("SELECT COUNT(*) as cnt FROM t_operation_history WHERE config_id=15").catch(e => [[{ error: e.message }]]);
  const [maxOrder] = await conn.query("SELECT MAX(CAST(`order` AS UNSIGNED)) as maxOrder FROM t_direct_config WHERE ref_id IS NULL");

  const out = { cols, directRows, historyRows, maxOrder };
  fs.writeFileSync('inspect4_out.json', JSON.stringify(out, null, 2), 'utf8');
  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
