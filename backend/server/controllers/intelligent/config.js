/**
 * 【文件职责】HTTP 智能判定适配器的全部参数。逻辑在同目录 recognize.js。
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 【谁在读】recognize.js。
 *
 * 兼容多种现场判定接口：JSON/表单请求体、GET/POST、JSON/纯文本响应、同步直接返回 /
 * 异步先提交任务再轮询——这几个维度都在这里切换，不用改 recognize.js。
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
  method: 'POST',           // 常用 POST；也支持 GET/PUT 等。GET/HEAD 不发请求体
  timeoutMs: 10000,         // 单次请求超时（毫秒）；超时记一条 failed 判定记录
  // HTTP 请求头。接口需要 Token 时加 Authorization: 'Bearer xxx'。
  // bodyFormat='form-data' 时这里的 Content-Type 会被忽略（fetch 自动生成带边界串的 multipart）。
  headers: { 'Content-Type': 'application/json' },

  requestMode: 'batch',    // batch：勾选的多条一次提交；single：每条各请求一次再汇总
  // 请求体格式：'json' 整体 JSON.stringify；'form-data' 按 multipart 发（现场要文件/表单字段时用）
  bodyFormat: 'json',
  // 请求体模板。占位符：{{records}}=全部数据数组，{{record}}=当前/第一条，{{ids}}=原数据 ID 数组，
  // 也可取具体字段 {{record.field1}}。占位符独占整串时保留原类型。GET/HEAD 时模板渲染出的对象拼成 URL 查询参数。
  requestTemplate: { data: '{{records}}' },

  // 响应格式：'json' 按点路径取值；'text' 响应不是规范 JSON 时用下面的正则从原始文本抠。
  responseFormat: 'json',

  // ↓ responseFormat='json' 时生效 ↓
  resultPath: 'data.results',   // 从响应里提取结果数组的点路径；留空=用完整响应
  conclusionPath: 'result',     // 从单条结果提取"结论"的点路径
  confidencePath: 'confidence', // 从单条结果提取"置信度"的点路径；转不成数字存 null

  // ↓ responseFormat='text' 时生效 ↓
  conclusionRegex: '',  // 提取"结论"的正则，取第 1 个捕获组；留空=不解析
  confidenceRegex: '',  // 提取"置信度"的正则，取第 1 个捕获组并转数字

  // 异步任务模式：false 一次请求同步拿结果；true 先提交任务拿 job id，再轮询查结果。
  asyncMode: false,
  // ↓ asyncMode=true 时生效 ↓
  asyncJobIdPath: 'job_id',           // 从"提交任务"响应里提取任务 ID 的点路径
  asyncPollUrl: '',                   // 查结果的地址模板，用 {{jobId}} 代入任务 ID
  asyncPollMethod: 'GET',             // 查结果用的 HTTP 方法
  asyncPollIntervalMs: 1000,          // 两次轮询间隔（毫秒）
  asyncMaxWaitMs: 30000,              // 从提交算起最多等多久（毫秒），超时判失败；覆盖上面的 timeoutMs
  asyncStatusPath: 'status',          // 从轮询响应里判断任务状态的点路径
  asyncDoneStatusValues: ['done', 'success', 'completed'], // 命中任一视为"已完成"
  asyncFailedStatusValues: ['failed', 'error'],            // 命中任一视为"任务失败"
}
