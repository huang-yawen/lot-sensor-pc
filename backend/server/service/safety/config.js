/**
 * 【文件职责】安全联锁的规则表与参数。逻辑在同目录 safetyInterlock.js。
 *
 * ★★ 赛场上要改安全联锁，改下面的 rules 数组就够了，不用动 safetyInterlock.js ★★
 *
 * 一条规则 = 一个判断（when）+ 一个动作（then）。规则之间互不影响，可随意增删改。
 *
 *   when(s, ctx) 返回 false / null  → 不触发
 *                返回 true          → 触发（故障记录里没有详情）
 *                返回一段字符串      → 触发，这段字符串就写进故障记录的详情
 *
 *   then         触发后要下发的开关，写几个就下发几个，值随便填：
 *                  { heater: 'off' }                只关加热，水泵继续转着散热
 *                  { pump: 'off', heater: 'off' }   两个都关
 *                  { pump: 'on' }                   也可以是"开"，不是只能关
 *                  { }                              只记一笔故障，不动执行器
 *                键是指令中心里的开关 preffix（pump / heater / ...），值会过
 *                CONTROL_VALUE_MAP 转成设备认识的报文（'off' → 'close'）。
 *
 *   s —— 这一条上报解析出来的现场数据，直接拿来判断：
 *     s.flow             流量              s.pressure    压力
 *     s.temp1            进水温度          s.temp2       出水温度
 *     s.tempDiff         温差（两路温度缺一个就是 null）
 *     s.pumpOn           水泵开着吗（true / false / null=这条消息没带这个字段）
 *     s.heatOn           加热开着吗（同上）
 *     s.flowVolatility   最近 N 个流量读数的极差（没攒够点数是 null）
 *     s.missingFields    这条上报缺了哪些字段（数组，空数组 = 字段齐全）
 *     s.modeJustToManual 这一刻是不是刚从"自动"切到"手动"
 *     s.mode             当前控制模式 'auto' / 'manual'
 *
 *   ctx —— 只有要用指令中心（网页上能改、不用重启）的值时才需要：
 *     await ctx.threshold('tempHigh')   温度上限，没配置返回 null
 *          可用槽位：tempHigh tempLow flowLow flowHigh pressureLow pressureHigh tempDiff
 *     await ctx.number('flow_volatility', 兜底值, 默认值)   按 preffix 读任意数值指令项
 *     ctx.abnormalMax    传感器异常哨兵值（读数 >= 它视为掉线/短路，默认 9999）
 *     ctx.deviceNo       当前设备号
 *     ctx.config         就是本文件这个对象（用来取下面那些兜底参数）
 *
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 【谁在读】safetyInterlock.js 本身；abnormalMax 和 requirePumpBeforeHeater 另被
 *   controlHelpers / pidHeating / scheduleService / updateDirectConfigAndPublish 读取。
 */
module.exports = {
  enabled: true, // 安全联锁总开关；关掉后下面所有规则都不判（requirePumpBeforeHeater 除外）

  // ======================== 规则表：赛场改这里 ========================
  rules: [
    {
      id: 'manual_mode',
      name: '进入手动模式（人工修复）',
      enabled: false,
      when: (s) => s.modeJustToManual && '控制模式 自动->手动',
      then: { pump: 'off', heater: 'off' },
    },
    {
      id: 'flow_low',
      name: '流量异常（低于下限/为0/掉线）',
      enabled: false,
      when: async (s, ctx) => {
        if (s.flow == null) return false
        if (s.flow === 0) return '流量=0'
        if (s.flow >= ctx.abnormalMax) return `流量=${s.flow}，顶到异常哨兵值 ${ctx.abnormalMax}`
        const min = await ctx.threshold('flowLow')
        if (min != null && s.flow < min) return `流量=${s.flow}，下限=${min}`
        return false
      },
      then: { pump: 'off', heater: 'off' },
    },
    {
      id: 'pressure_high',
      name: '压力异常（高于上限/为0/掉线）',
      enabled: false,
      when: async (s, ctx) => {
        if (s.pressure == null) return false
        if (s.pressure === 0) return '压力=0'
        if (s.pressure >= ctx.abnormalMax) return `压力=${s.pressure}，顶到异常哨兵值 ${ctx.abnormalMax}`
        const max = await ctx.threshold('pressureHigh')
        if (max != null && s.pressure > max) return `压力=${s.pressure}，上限=${max}`
        return false
      },
      then: { pump: 'off', heater: 'off' },
    },
    {
      id: 'temp_high',
      name: '任一温度高于上限',
      enabled: false,
      when: async (s, ctx) => {
        const max = await ctx.threshold('tempHigh')
        for (const [value, label] of [[s.temp1, '温度1（进水）'], [s.temp2, '温度2（出水）']]) {
          if (value == null) continue
          if (value >= ctx.abnormalMax) return `${label}=${value}，顶到异常哨兵值 ${ctx.abnormalMax}`
          if (max != null && value > max) return `${label}=${value}，上限=${max}`
        }
        return false
      },
      then: { pump: 'off', heater: 'off' },
    },
    {
      // 温差阈值走安全联锁专用的指令项 safety_temp_diff_threshold，跟联动规则的
      // temp_diff_open、双温度融合的 dual_temp_diff、故障机的 temp_diff 各自独立，
      // 现场调参别调错了对应那一项。
      id: 'temp_diff',
      name: '温差过大',
      enabled: false,
      when: async (s, ctx) => {
        if (s.tempDiff == null) return false
        const max = await ctx.number('safety_temp_diff_threshold', ctx.config.tempDiffThreshold, 10)
        return s.tempDiff > max && `温差=${s.tempDiff.toFixed(2)} > ${max}℃`
      },
      then: { pump: 'off', heater: 'off' },
    },
    {
      // 跟前面几条不同：这条不是拿单次读数比阈值，而是要先攒够 flowVolatilityWindow
      // 个读数才能算出波动幅度，所以哪怕这次读数本身正常，跟前几次差太多照样触发。
      id: 'flow_volatility',
      name: '流量剧烈波动（疑似水锤/湍流）',
      enabled: false,
      when: async (s, ctx) => {
        if (s.flowVolatility == null) return false
        const max = await ctx.number('flow_volatility', ctx.config.flowVolatilityThreshold, 20)
        return s.flowVolatility > max && `最近${ctx.config.flowVolatilityWindow}个读数波动幅度=${s.flowVolatility.toFixed(2)} > ${max}`
      },
      then: { pump: 'off', heater: 'off' },
    },
    {
      // 两条掉线路径共用这一条规则、共用同一份冷却：①本条消息缺字段（下面的 when）；
      // ②整台设备心跳超时、根本没消息进来（safetyInterlock.js 里的定时器 monitorOffline
      // 直接拿这条规则的 then 去执行）。任一条先触发，冷却期内另一条就不会重复关。
      id: 'sensor_offline',
      name: '传感器掉线',
      enabled: true,
      when: (s) => s.missingFields.length > 0 && `本条上报缺少字段：${s.missingFields.join('、')}`,
      then: { pump: 'off', heater: 'off' },
    },
    {
      // 只在两个开关状态都明确上报时才判，避免纯传感器消息（不带行为字段）误触发。
      id: 'heater_without_pump',
      name: '未开水泵却开启加热',
      enabled: false,
      when: (s) => s.heatOn === true && s.pumpOn === false && '水泵=关，加热=开',
      then: { pump: 'off', heater: 'off' },
    },
  ],

  // ==================== 参数：规则里用 ctx.config 取 ====================
  tempDiffThreshold: 10,      // 温差阈值兜底值（℃），指令中心没配才用它
  flowVolatilityThreshold: 20, // 流量波动阈值兜底值
  flowVolatilityWindow: 10,    // 波动判定的滑动窗口点数（攒够这么多个读数才开始判）

  // 源头拦截：开加热前必须先开水泵，否则拒绝这次开加热请求。
  // 这条不在 rules 里，也不受上面 enabled 总开关约束——它不是"事后关掉"，而是
  // 在 updateDirectConfigAndPublish / pidHeating / scheduleService 三处下发前直接拦住。
  requirePumpBeforeHeater: false,

  alarmCooldownMs: 30000,  // 同一个"设备+规则"多久内只触发一次（毫秒）
  showOnErrorPage: true,   // 故障记录页是否显示"安全联锁记录"表格（只控制前端展示）
  abnormalMax: 9999,       // 传感器异常哨兵值：读数 >= 它视为掉线/短路（联动规则也共用这一处）
  monitorIntervalMs: 5000, // 掉线监测定时器周期，启动时读一次，改了要重启后端
}
