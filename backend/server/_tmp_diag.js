const p = require('./config/dbPool');
const { findSwitchConfig, resolveConfigIdByPrefix } = require('./service/controlShared/controlHelpers');

(async () => {
  // 所有开关类指令项
  const [sw] = await p.query("SELECT id,t_name,preffix,ref_id,ref_value,f_type FROM t_direct_config WHERE f_type='1' ORDER BY id");
  console.log('=== f_type=1 开关指令项 ===');
  console.log(JSON.stringify(sw, null, 2));

  // scheduleService 绑定的目标能否找到
  for (const prefix of ['pump', 'heater']) {
    const idByPrefix = await resolveConfigIdByPrefix(prefix);
    const conf = await findSwitchConfig(prefix);
    console.log(`=== setSwitch 目标 '${prefix}'：resolveId=${idByPrefix} findSwitchConfig=${conf ? `id=${conf.id} t_name=${conf.t_name}` : 'NULL(找不到!)'}`);
  }

  await p.end();
})().catch(e => { console.error('ERR:', e.message, e.stack); process.exit(1); });
