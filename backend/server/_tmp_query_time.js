const p = require('./config/dbPool');
(async () => {
  // 1. t_direct_config 里 52-55 的完整字段
  const [cfgs] = await p.query(
    "SELECT id, t_name, f_type, preffix, topic, wire_template, wire_on_payload, wire_off_payload, ref_id, ref_value FROM t_direct_config WHERE id IN (52,53,54,55)"
  );
  console.log('=== t_direct_config 时间框配置 ===');
  console.log(JSON.stringify(cfgs, null, 2));

  // 2. t_direct 存值表里这些 config_id 有没有值
  const [vals] = await p.query(
    "SELECT id, config_id, d_no, value FROM t_direct WHERE config_id IN (52,53,54,55) ORDER BY config_id"
  );
  console.log('=== t_direct 存值记录 ===');
  console.log(JSON.stringify(vals, null, 2));

  // 3. 模拟 buildPayload 对 id=52 的判断
  const [rows] = await p.query(
    'SELECT preffix, f_type, t_name, wire_template, wire_on_payload, wire_off_payload FROM t_direct_config WHERE id = ? LIMIT 1',
    [52]
  );
  const config = rows[0];
  console.log('=== buildPayload(52) 模拟 ===');
  console.log('f_type =', JSON.stringify(config.f_type), ' String(f_type)==="1"?', String(config.f_type) === '1');
  const key = String(config.preffix || '').trim();
  console.log('preffix key =', JSON.stringify(key), ' key为空?', !key);
  console.log('payload 应为 =', JSON.stringify({ [key]: '08:00:00' }));

  await p.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
