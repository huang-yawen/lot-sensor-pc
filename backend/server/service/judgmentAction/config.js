/**
 * 【文件职责】智能判定联动的开关和规则。逻辑在同目录 judgmentAction.js。
 *
 * ★★ 赛场上要改"判定结论触发什么动作"，改本文件的 RULES 就够了，不用改代码 ★★
 *   加规则：复制一条改 id / name / keywords / actions
 *   停用某条：把该条 enabled 改成 false（或整条删掉）
 *   全部停用：把下面的 enabled 改成 false
 *   改完重启后端生效。
 *
 * ══════════════ 这个模块干什么 ══════════════
 *   智能判定服务返回一条结论文字（如"干烧""漏水""正常"）后，如果结论里**包含**某条规则的
 *   keywords 里的任意一个关键词，就按那条规则的 actions 去关泵/关加热，并写一条故障记录 +
 *   往前端推一个弹窗（WebSocket judgment_action_triggered → JudgmentActionAlertDialog）。
 *   写法照搬安全联锁 service/safety/，区别是：安全联锁看的是"传感器数值"，
 *   这里看的是"判定服务的结论文字"。
 *
 * ══════════════ 谁会触发它（很重要） ══════════════
 *   ✅ 自动判定（runAutoOnce）    —— 每轮判完都会尝试触发
 *   ✅ 实时判定（runRealtimeJudgment）—— 每条消息判完都会尝试触发（当前调用点被注释，默认不跑）
 *   ❌ 手动判定（页面点按钮）      —— **不会触发**！它只是追溯历史数据，不关泵不动加热
 *   ❌ mock 占位判定             —— 结论是本地瞎猜的，不算数，也不触发
 *
 * ══════════════ 规则字段怎么填 ══════════════
 *   id        规则编号：写进故障记录（t_error_msg.e_no），唯一即可，别重复
 *   name      规则中文名：故障记录/弹窗里显示，最终写成"智能判定-<name>"
 *   enabled   true=生效；false 或整条删掉=关掉这条规则（必须严格 `=== true` 才算开）
 *   keywords  关键词数组：结论文字里【包含任意一个】就触发（建议中英文都写一份，
 *             因为判定服务的结论可能是中文也可能是英文）
 *   actions   要下发的开关动作数组，每个 { prefix, value }：
 *               prefix = 指令中心 t_direct_config.preffix（本项目：pump=水泵、heater=加热）
 *                        ⚠ 必须是 t_direct_config 里真实存在的 preffix，且 t_direct 里要有值，
 *                          否则 setSwitch 找不到这个开关 → 只记"下发失败"、不真的动作
 *               value  = 'on' 或 'off'
 *               想一次关两个就写两个对象；只想记录不动作就写 []（记录里会写"开关：未调整（仅记录）"）
 *
 * ══════════════ 怎么验证规则生效 ══════════════
 *   1. 把 enabled 改成 true、并把判定服务的结论调成能命中关键词（或临时把 keywords 设成
 *      ['正常'] 试一次，验完记得改回来）；
 *   2. 重启后端，等一轮自动判定（默认 5 秒）或触发实时判定；
 *   3. 看三处：
 *      · 后端日志：`[JudgmentAction] 干烧：加热 -> off，设备 202606`（真下发了）
 *      · 页面：全局弹窗（JudgmentActionAlertDialog）
 *      · 数据库：t_error_msg（type='智能判定联动'）+ t_operation_history（开关变化）
 *   4. 没动作时按顺序排查：enabled 是否为 true → executeActions 是否为 true →
 *      keywords 有没有命中结论文字 → 是否在冷却期 → 是否处于故障锁定 → prefix 在指令中心存不存在。
 *
 * 【值的来源】首次设定；改完重启后端生效。
 * 【谁在读】judgmentAction.js；GET /api/system-config 会把它原样下发（前端只读，用于展示）。
 * 【详细手册】项目根目录 JUDGMENT_GUIDE.md 第 8 节。
 */
module.exports = {
  enabled: false,         // 总开关；关掉后判定结论再异常也不执行任何动作
  executeActions: true,   // 是否真的下发开关动作（false=只写记录+提示，不下发）
  alarmCooldownMs: 30000, // 同一个"设备+规则"多久内只触发一次（毫秒）
  requireReset: false,    // 是否启用复位功能：true=触发后锁定该设备，需人工点"复位"才解除（像普通故障一样）；false=触发即结束，不需要复位

  // ==================== ★★★ 赛场改这里：规则表 ★★★ ====================
  // 每条规则五个字段：
  //   id        规则编号（写进故障记录，唯一即可，别重复）
  //   name      规则中文名（故障记录里显示）
  //   enabled   true=生效；false 或整条删掉=关掉这条规则
  //   keywords  关键词数组：判定结论里【包含任意一个】就触发（建议中英文都写一份）
  //   actions   要下发的开关动作数组，每个 { prefix, value }：
  //             prefix = 指令中心里的开关 preffix（pump=水泵，heater=加热）
  //             value  = 'on' 或 'off'
  //             想一次关两个就写两个对象；只想记录不动作就写 []
  RULES: [
    {
      id: 'dry_burn',
      name: '干烧',
      enabled: true,
      keywords: ['干烧', '无水加热', 'dry', '超温'],
      actions: [{ prefix: 'heater', value: 'off' }], // 干烧 → 只关加热
    },
    {
      id: 'pipe_leak',
      name: '管道漏水',
      enabled: true,
      keywords: ['漏水', '泄漏', 'leak'],
      actions: [{ prefix: 'pump', value: 'off' }, { prefix: 'heater', value: 'off' }], // 漏水 → 关泵+关加热
    },
    {
      id: 'pipe_blockage',
      name: '管道堵塞',
      enabled: true,
      keywords: ['堵塞', 'blockage'],
      actions: [{ prefix: 'pump', value: 'off' }], // 堵塞 → 只关泵
    },
    // ── 加新规则：复制上面任意一条，改 id/name/keywords/actions 即可 ──
    // {
    //   id: 'xxx',
    //   name: '新故障',
    //   enabled: true,
    //   keywords: ['关键词1', '关键词2'],
    //   actions: [{ prefix: 'heater', value: 'off' }],
    // },
  ],
}
