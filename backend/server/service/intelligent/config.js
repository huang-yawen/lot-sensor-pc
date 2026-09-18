/**
 * 【文件职责】智能判定的全部参数。逻辑在同目录 intelligentJudgment.js。改完重启后端生效。
 *
 * ────────────── 三种判定模式的总览 ──────────────
 * 三种模式共用同一条「发请求 → 取结论 → 落库」链路（intelligentJudgment.js 的 judgeAndSave），
 * 只有「谁挑数据、什么时候判」不同：
 *
 *   ┌────────┬────────────────────────┬──────────────────────────────┬─────────────────────┐
 *   │ 模式   │ 触发方式                │ 开关（改完重启）              │ 数据来源            │
 *   ├────────┼────────────────────────┼──────────────────────────────┼─────────────────────┤
 *   │ 手动   │ 历史页勾选几条点按钮    │ 无需开关，始终可用            │ 库里已存记录（按 id）│
 *   │ 自动   │ 后端定时器每隔几秒判一次│ AUTO_JUDGMENT.enabled        │ 库里最新 N 条        │
 *   │ 实时   │ 每条 MQTT 消息到达即判  │ REALTIME_JUDGMENT.enabled    │ 刚解析的消息（内存） │
 *   └────────┴────────────────────────┴──────────────────────────────┴─────────────────────┘
 *
 * ────────────── 三个 enabled 别搞混 ──────────────
 *   INTELLIGENT_JUDGMENT.enabled   true=真的请求现场判定服务；false=本地占位判定（不发请求）
 *   AUTO_JUDGMENT.enabled          true=后端每隔几秒自动判定；false=只能页面上手动点按钮
 *   REALTIME_JUDGMENT.enabled      true=每条消息到达异步判定；false=消息到达只跑本地规则
 *
 * 这三块会原样出现在 GET /api/system-config 里（config/systemConfig.js 拼进去的），
 * 前端只读里面的 showXxx / showMenu 显示开关。
 */
module.exports = {
  // ==================== 判定服务参数（手动 + 自动 + 实时共用） ====================
  INTELLIGENT_JUDGMENT: {
    // true 才请求现场 HTTP 服务；false 时按 mockWhenDisabled 决定是否返回占位结果。
    enabled: false,
    // 服务未启用时是否允许确定性的本地占位判定。正式演示建议启用真实服务。
    mockWhenDisabled: true,

    // 前端显示开关
    showOnSensorPage: true,    // 传感器历史页是否显示"智能判定"按钮
    showOnBehaviorPage: false, // 运行状态/行为历史页是否显示"智能判定"按钮
    showHistoryMenu: true,     // 左侧菜单是否显示"智能判定记录"页

    // 完整 HTTP 地址。服务在另一台电脑时，127.0.0.1 要改成那台电脑的局域网 IP。
    url: 'http://127.0.0.1:5000/judgment',
    // 只能用带请求体的方法（POST/PUT/PATCH）。现场要 GET，看 intelligentJudgment.js 的 callService 上方说明。
    method: 'POST',
    timeoutMs: 10000,         // 单次请求超时（毫秒）；超时接口返回 504
    // HTTP 请求头。接口需要 Token 时加 Authorization: 'Bearer xxx'。
    headers: { 'Content-Type': 'application/json' },

    // ==================== 请求体 / 响应解析字段路径（现场格式不同只改这里，不用改代码） ====================
    // 请求体字段名：实际发出去固定是 { [requestField]: 记录数组 }。
    //   现场要 { samples:[...] } 改成 'samples'；要 { records:[...] } 改成 'records'。
    requestField: 'data',

    // 响应里「结果数组」的点路径。空串 '' = 整个响应就是数组。
    //   { data:{ results:[...] } } → 'data.results'
    //   { results:[...] }          → 'results'
    //   [{...},{...}] 顶层就是数组  → ''
    resultPath: 'data.results',

    // 单条结果里「结论」字段的点路径。空串 '' = 整条结果就是一句结论文字。
    //   { result:'异常' }           → 'result'
    //   { conclusion:'异常' }       → 'conclusion'
    //   { data:{ status:'异常' } }  → 'data.status'
    //   直接返回字符串 '异常'        → ''（空串）
    conclusionPath: 'result',

    // 单条结果里「置信度」字段的点路径。空串 '' = 没有置信度（存 null）。
    //   { result:'异常', confidence:0.9 } → 'confidence'
    //   { result:'异常', score:0.9 }      → 'score'
    confidencePath: 'confidence',
  },

  // ==================== 自动判定节奏（只有自动模式用） ====================
  AUTO_JUDGMENT: {
    enabled: true,     // 自动判定总开关；false 时后端不启动定时器，左侧菜单也不显示
    intervalMs: 5000,  // 每隔多少毫秒判定一次；小于 1000 按 1000 算
    recentCount: 5,    // 每次取最新多少条传感器数据去判定（1~100）
    bufferSize: 50,    // 后端内存里保留最近多少条结果，给"自动判定"页画图（1~500）
    showMenu: true,    // 左侧菜单是否显示"自动判定"页
  },

  // ==================== 消息即触发判定节奏（方式③，每条 MQTT 消息都异步判定一次） ====================
  REALTIME_JUDGMENT: {
    // 消息即触发总开关。false 时消息到达只跑本地规则、不调判定服务（手动/自动不受影响）。
    // true 时每条传感器消息都会异步判定一次，判定服务压力最大——只在需要秒级实时判定的赛题开。
    // 由 mqtt/combinedRealtime/combinedRealtimeHandler.js 读取，改完重启后端生效。
    enabled: false,
  },
}
