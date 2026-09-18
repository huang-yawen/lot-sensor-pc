/**
 * 【文件职责】智能判定联动的开关和规则。逻辑在同目录 judgmentAction.js。
 *
 * ★★ 赛场上要改智能判定联动，改本文件的 RULES 就够了，不用改代码 ★★
 *
 * 【这个模块干什么】
 *   智能判定服务（AI）返回一条结论文字后，如果结论里包含下面某条规则的 keywords
 *   里的关键词（比如"干烧""漏水"），就按那条规则的 actions 去关泵/关加热。
 *   写法照搬安全联锁 service/safety/，区别是：安全联锁看的是"传感器数值"，
 *   这里看的是"判定服务的结论文字"。
 *
 * 【值的来源】首次设定，改完重启后端生效。
 * 【谁在读】judgmentAction.js 本身。
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
