const p = require('./config/dbPool');
(async () => {
  const [r] = await p.query("SELECT id,t_name,f_type,f_value,ref_id,ref_value,preffix FROM t_direct_config WHERE f_type='4'");
  console.log('=== f_type=4 时间框（含 f_value 动作绑定）===');
  console.log(JSON.stringify(r, null, 2));
  await p.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
