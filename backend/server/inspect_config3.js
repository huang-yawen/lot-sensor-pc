const mysql = require('mysql2/promise');
const fs = require('fs');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root', password: '123456', database: 'competition'
  });

  const [duty] = await conn.query("SELECT * FROM t_direct_config WHERE t_name LIKE '%占空比%' ORDER BY id");
  const [pidNode] = await conn.query("SELECT * FROM t_direct_config WHERE id=17");
  const [pidChildren] = await conn.query("SELECT id, t_name, ref_id, ref_value, f_type, `order` FROM t_direct_config WHERE ref_id=17 ORDER BY `order`");
  const [autoCtrlChildren] = await conn.query("SELECT id, t_name, ref_id, ref_value, f_type, `order` FROM t_direct_config WHERE ref_id=10 ORDER BY `order`");

  const out = {
    duty,
    pidNode,
    pidChildren,
    autoCtrlChildren
  };
  fs.writeFileSync('inspect3_out.json', JSON.stringify(out, null, 2), 'utf8');
  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
