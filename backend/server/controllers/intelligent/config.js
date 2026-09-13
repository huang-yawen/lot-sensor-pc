/**
 * 【文件职责】HTTP 智能判定适配器的全部参数。逻辑在同目录 recognize.js。
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 【谁在读】recognize.js；另外经 config/systemConfig.js 拼进 GET /api/system-config，
 *           前端只读下面三个 showXxx 开关。
 *
 * 只覆盖现场判定服务最常见的一种形态：POST 一个 JSON 请求体过去，同步拿到 JSON
 * 响应，按点路径把结论取出来。现场如果是异步提交+轮询、要 multipart 表单、或者
 * 返回纯文本，不在这里加配置，直接改 recognize.js 的 callService / summarize
 * （见那两个函数上方的说明）。
 */
module.exports = {
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
  // 只能用带请求体的方法（POST/PUT/PATCH）。fetch 不允许 GET 带 body，
  // 现场真要 GET 传参就在 callService 里改成拼 URL 查询参数。
  method: 'POST',
  timeoutMs: 10000,         // 单次请求超时（毫秒）；超时记一条 failed 判定记录，接口返回 504
  // HTTP 请求头。接口需要 Token 时加 Authorization: 'Bearer xxx'。
  headers: { 'Content-Type': 'application/json' },

  // 请求体字段名：实际发出去的是 { [requestField]: 勾选的记录数组 }。
  // 现场要 { samples: [...] } 就把这里改成 'samples'。
  requestField: 'data',

  resultPath: 'data.results',   // 从响应里提取结果数组的点路径；留空=用完整响应
  conclusionPath: 'result',     // 从单条结果提取"结论"的点路径
  confidencePath: 'confidence', // 从单条结果提取"置信度"的点路径；转不成数字存 null
}
