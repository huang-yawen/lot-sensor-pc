/**
 * 【文件职责】把"水泵恒流速控制"要用到的指令项写进 t_direct_config。
 * 用 Node 脚本而不是纯 SQL，是因为要在运行时查当前最大 id 和已有 preffix，
 * 才能做到「可重复执行不出错、不跟现有指令项撞 id」。
 *
 * 用法（在 backend/server 目录下）：
 *     node init/init_pump_velocity_control.js
 *
 * 幂等：按 preffix 判重，已经存在的指令项直接跳过，不覆盖现场已经调好的值。
 * 想重新初始化某一项，先在数据库里删掉它再跑一次即可。
 *
 * 层级（ref_id/ref_value 决定指令页面上的级联显示）：
 *     控制模式(mode) = 自动
 *       ├─ 目标流速 / 最小开启时长 / 最小关闭时长   ← 两套算法共用
 *       ├─ 水泵恒流速滞环通断(开关)
 *       │    └─ 流速滞回带                        ← 只有开这个才显示
 *       └─ 水泵恒流速PID控制(开关)
 *            └─ 控制周期 / Kp / Ki / Kd / 流速死区  ← 只有开这个才显示
 *
 * 【删除安全】这里加的每一项都可以随时删除：数值项走 getNumberValue 三级兜底
 * （指令中心 → 配置中心 PUMP_VELOCITY_CONTROL → 硬常量），开关项查不到就当未启用，
 * 删掉不会让后端报错，也不会把 NaN 带进控制判断。
 */
require('../config/env')
const pool = require('../config/dbPool')

/** 找"控制模式"这个根节点，恒流速的开关都挂在它的"自动"分支下。 */
async function findModeId() {
  const [rows] = await pool.query(
    "SELECT id FROM t_direct_config WHERE preffix = 'mode' OR t_name = '控制模式' ORDER BY id ASC LIMIT 1"
  )
  return rows[0]?.id ?? null
}

async function findIdByPreffix(preffix) {
  const [rows] = await pool.query('SELECT id FROM t_direct_config WHERE preffix = ? ORDER BY id ASC LIMIT 1', [preffix])
  return rows[0]?.id ?? null
}

async function nextId() {
  const [rows] = await pool.query('SELECT COALESCE(MAX(id), 0) + 1 AS nid FROM t_direct_config')
  return rows[0].nid
}

/**
 * 插入一个指令项；preffix 已存在就跳过。
 * @returns {Promise<number>} 该 preffix 对应的 config id（新插入的或已存在的）
 */
async function ensureItem({ preffix, name, fType, fValue, refId, refValue, min, max, order }) {
  const exist = await findIdByPreffix(preffix)
  if (exist != null) {
    console.log(`  跳过（已存在 id=${exist}）：${name} [${preffix}]`)
    return exist
  }
  const id = await nextId()
  await pool.query(
    `INSERT INTO t_direct_config
       (id, ref_id, ref_value, t_name, f_type, f_value, mode, max, min, \`order\`, topic, preffix, icon)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'control', ?, NULL)`,
    [id, refId, refValue, name, fType, fValue ?? null, max ?? null, min ?? null, String(order), preffix]
  )
  console.log(`  ✅ 新增 id=${id}：${name} [${preffix}]`)
  return id
}

async function main() {
  const modeId = await findModeId()
  if (modeId == null) {
    console.error('❌ 找不到"控制模式"指令项（preffix=mode），请先初始化基础指令表再跑本脚本。')
    process.exit(1)
  }
  console.log(`控制模式指令项 id=${modeId}，恒流速相关指令项挂到它的"自动(on)"分支下。\n`)

  console.log('[1/3] 两套算法共用的设定值与水泵保护')
  await ensureItem({ preffix: 'target_velocity', name: '目标流速(m/s)', fType: '2',
    refId: modeId, refValue: 'on', min: '0', max: '10', order: 40 })
  await ensureItem({ preffix: 'pump_velocity_min_on_ms', name: '水泵最小开启时长(ms)', fType: '2',
    refId: modeId, refValue: 'on', min: '0', max: '600000', order: 41 })
  await ensureItem({ preffix: 'pump_velocity_min_off_ms', name: '水泵最小关闭时长(ms)', fType: '2',
    refId: modeId, refValue: 'on', min: '0', max: '600000', order: 42 })

  console.log('\n[2/3] 算法① 滞环通断')
  const hysId = await ensureItem({ preffix: 'pump_velocity_hysteresis_enabled', name: '水泵恒流速滞环通断', fType: '1',
    fValue: '关闭:off|开启:on', refId: modeId, refValue: 'on', order: 43 })
  await ensureItem({ preffix: 'pump_velocity_hysteresis', name: '流速滞回带(m/s)', fType: '2',
    refId: hysId, refValue: 'on', min: '0', max: '10', order: 44 })

  console.log('\n[3/3] 算法② 占空比控制')
  const pidId = await ensureItem({ preffix: 'pump_velocity_pid_enabled', name: '水泵恒流速PID控制', fType: '1',
    fValue: '关闭:off|开启:on', refId: modeId, refValue: 'on', order: 45 })
  await ensureItem({ preffix: 'pump_velocity_window_ms', name: '恒流速控制周期(ms)', fType: '2',
    refId: pidId, refValue: 'on', min: '10000', max: '600000', order: 46 })
  await ensureItem({ preffix: 'pump_velocity_kp', name: '恒流速比例系数Kp', fType: '2',
    refId: pidId, refValue: 'on', min: '0', max: '10000', order: 47 })
  await ensureItem({ preffix: 'pump_velocity_ki', name: '恒流速积分系数Ki', fType: '2',
    refId: pidId, refValue: 'on', min: '0', max: '10000', order: 48 })
  await ensureItem({ preffix: 'pump_velocity_kd', name: '恒流速微分系数Kd', fType: '2',
    refId: pidId, refValue: 'on', min: '0', max: '10000', order: 49 })
  await ensureItem({ preffix: 'pump_velocity_deadband', name: '流速死区(m/s)', fType: '2',
    refId: pidId, refValue: 'on', min: '0', max: '10', order: 50 })

  console.log('\n完成。指令页面切到"自动"模式即可看到这些项；两个算法开关都开时占空比优先。')
  process.exit(0)
}

main().catch(err => {
  console.error('❌ 执行失败:', err.message)
  process.exit(1)
})
