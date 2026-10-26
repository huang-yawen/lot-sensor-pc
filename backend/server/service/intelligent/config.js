/**
 * 【文件职责】智能判定的全部参数——现场改判定，**先看这个文件**。
 *   逻辑在同目录 intelligentJudgment.js；组合判定的字段名拼装在 combinedJudgment.js；
 *   判定结论要触发动作去 service/judgmentAction/。
 * 【详细使用手册】项目根目录 JUDGMENT_GUIDE.md（报文样例、合并/分开两种显示形态的差异、排查表）。
 * 【改完要不要重启】本文件是代码常量，**改完必须重启后端**。
 *   （例外：字段映射表 t_sensor_field_mapper / t_behavior_field_mapper 的 visible、p_name
 *     属于数据库内容，改完不用重启；它们决定判定服务收到的字段。）
 * 【谁在读】
 *   intelligentJudgment.js（三种链路都读这里的 INTELLIGENT_JUDGMENT / AUTO_JUDGMENT）
 *   combinedJudgment.js（读 combinedPrefix 拼字段名）
 *   mqtt/combinedRealtime/combinedRealtimeHandler.js（读 REALTIME_JUDGMENT.enabled）
 *   config/systemConfig.js（把这三块原样拼进 GET /api/system-config，前端只读里面的 showXxx / showMenu）
 *
 * ══════════════════ 三条链路总览（最后都汇到 intelligentJudgment.js 的 judgeAndSave） ══════════════════
 *   ┌──────┬───────────────────────────┬───────────────────────────┬──────────────────────────┬──────────────────────┐
 *   │ 链路 │ 谁触发                    │ 开关                      │ 读哪张表                 │ 发给判定服务的字段   │
 *   ├──────┼───────────────────────────┼───────────────────────────┼──────────────────────────┼──────────────────────┤
 *   │ 手动 │ 页面勾选记录 → 点「智能判定」│ 无需开关，始终可用        │ combined：t_scene_data   │ combined：两侧都有   │
 *   │      │                           │ （按钮显隐看 showOnXxx）   │ sensor/behavior：对应真表│ sensor：只有传感器   │
 *   │ 自动 │ 后端定时器每 intervalMs   │ AUTO_JUDGMENT.enabled     │ t_sensor_data（写死）    │ 只有传感器           │
 *   │ 实时 │ 每条 MQTT 消息到达        │ REALTIME_JUDGMENT.enabled │ 内存报文（不回查数据库） │ 只有传感器           │
 *   └──────┴───────────────────────────┴───────────────────────────┴──────────────────────────┴──────────────────────┘
 *   注① 实时判定的**调用点**在 mqtt/combinedRealtime/combinedRealtimeHandler.js 底部，当前是注释状态：
 *      开关改成 true 也不会触发，要开还得把那一行注释解开（见文件底部 triggerRealtimeJudgment 上方说明）。
 *   注② 自动判定目前写死判"传感器"；要让它也带行为数据，见 JUDGMENT_GUIDE.md 第 9.1 节（改 runAutoOnce）。
 *   注③ 手动判定**不会**触发联动动作（不关泵），只有自动/实时判定会（且 mock 占位结论也不会）。
 *
 * ══════════════════ 三个 enabled 别搞混 ══════════════════
 *   INTELLIGENT_JUDGMENT.enabled  true=真的请求现场判定服务；false=本地占位判定（不发任何网络请求）
 *   AUTO_JUDGMENT.enabled         true=后端每隔几秒自动判一次；false=只能页面上手动点按钮
 *   REALTIME_JUDGMENT.enabled     true=每条消息到达异步判一次；false=消息到达只跑本地控制逻辑
 *
 * ══════════════════ 现场常见改法速查（想做什么 → 改哪一行） ══════════════════
 *   接上真实判定服务              INTELLIGENT_JUDGMENT.enabled = true + url
 *   判定服务在另一台电脑          url 改成那台机的局域网 IP（如 http://192.168.1.120:5000/judgment）
 *   响应格式与我默认的不一样      INTELLIGENT_JUDGMENT 的 resultPath / conclusionPath / confidencePath
 *   请求体里数组字段名不叫 data   INTELLIGENT_JUDGMENT.requestField
 *   判定太频繁 / 每次条数不合适   AUTO_JUDGMENT.intervalMs / recentCount
 *   关掉自动判定                  AUTO_JUDGMENT.enabled = false
 *   隐藏某个「智能判定」按钮      showOnSensorPage / showOnBehaviorPage / showOnCombinedPage
 *   两侧出现同名物理字段要区分    combinedPrefix
 *   结论要自动关泵/关加热         service/judgmentAction/config.js 的 RULES（另一个文件）
 *   报文里不要某个字段            字段映射表该行 visible 改成 0
 */
module.exports = {
  // ==========================================================================
  // 一、判定服务参数（手动 + 自动 + 实时 + 组合判定共用）
  // ==========================================================================
  INTELLIGENT_JUDGMENT: {
    // ★是否真的请求现场 HTTP 判定服务。
    //   true  → 每次判定都发一次 HTTP 请求（发什么、怎么解析由下面几项决定）
    //   false → 一个请求都不发，按 mockWhenDisabled 决定是否返回"本地占位判定"结果
    //           （占位判定：测量值绝对值 > 10000 判"数据异常"，否则"正常"，见 intelligentJudgment.js 的 mockResult）
    //   演示前记得确认这一项：false 时页面弹窗会出现黄色提示"本地占位判定（服务未启用，不是真实结果）"。
    enabled: false,
    // 服务未启用时是否允许本地占位判定。
    //   true  → 流程能跑通（用于没接服务时演示/自测）
    //   false → 判定直接报错（HTTP 502），相当于"必须接真服务"
    mockWhenDisabled: true,

    // ── 前端按钮 / 菜单显隐开关（这三个开关只影响"看得见看不见"，不影响判定本身）──
    // 分开显示形态：传感器汇总页（/sensor-history）是否显示「智能判定」按钮
    showOnSensorPage: true,
    // 分开显示形态：行为汇总页（/behavior-history）是否显示「智能判定」按钮
    showOnBehaviorPage: false,
    // 合并显示形态：组合数据/汇总数据页（/combined-history）是否显示「智能判定」按钮。
    // 这一项不写（undefined）时前端会跟随 showOnSensorPage。
    showOnCombinedPage: true,
    // 左侧菜单是否显示「智能判定记录」页（/judgment-history）
    showHistoryMenu: true,

    // ==================== 组合判定（type='combined'）的字段名前缀 ====================
    // 合并版把一条上报消息存成 t_scene_data 一行：传感器占 field1~field10、行为占 field11~field20。
    // 送判定服务之前，会按两张字段映射表的 p_name 把槽位"翻译"回设备上报时的字段名，例如：
    //   t_sensor_field_mapper.db_name=field1, p_name=temp_in  →  报文里的 temp_in = t_scene_data.field1
    //   t_behavior_field_mapper.db_name=field1, p_name=pump   →  报文里的 pump    = t_scene_data.field11
    // 只有两侧出现**同名物理字段**时才需要加前缀区分（例如两边都叫 flow）：
    //   { sensor: 's_', behavior: 'b_' }  →  报文变成 s_flow / b_flow
    // 不需要区分就都留空字符串（默认）。
    combinedPrefix: { sensor: '', behavior: '' },

    // ==================== 判定服务地址与请求方式 ====================
    // 完整 HTTP 地址。判定服务跑在另一台电脑时，127.0.0.1 要改成那台电脑的局域网 IP，
    // 例如 'http://192.168.1.120:5000/judgment'（注意能被本机 ping 通、端口没被防火墙挡）。
    url: 'http://127.0.0.1:5000/judgment',
    // 请求方法。本项目默认走"带请求体的方法"（POST/PUT/PATCH），因为要在 body 里塞记录数组。
    // 现场接口只支持 GET 时，改 intelligentJudgment.js 的 callService()（函数上方注释给了 GET/表单两种写法）。
    method: 'POST',
    // 单次请求超时（毫秒）。超时会被识别成 AbortError → 手动判定接口返回 HTTP 504，
    // 自动判定会落一条 status='failed' 的记录（不会中断定时器，下一轮照跑）。
    timeoutMs: 10000,
    // HTTP 请求头。接口要鉴权时加一项，例如：{ 'Content-Type': 'application/json', Authorization: 'Bearer xxx' }
    headers: { 'Content-Type': 'application/json' },

    // ==================== 请求体 / 响应解析字段路径（现场格式不同只改这里，不用改代码） ====================
    // 请求体里"记录数组"的字段名。实际发出去固定是 { [requestField]: 记录数组 }：
    //   'data'    → { "data":    [ {...}, {...} ] }   ← 默认
    //   'samples' → { "samples": [ {...}, {...} ] }
    requestField: 'data',

    // 响应里"结果数组"的点路径（点号分隔的嵌套路径；空串 '' 表示整个响应就是那个数组）：
    //   { data:{ results:[...] } } → 'data.results'   ← 默认
    //   { results:[...] }          → 'results'
    //   [{...},{...}]（顶层数组）   → ''
    resultPath: 'data.results',

    // 单条结果里"结论"字段的点路径（结论只看结果数组的第一条，这一批记录共用一个结论）：
    //   { result:'异常' }          → 'result'        ← 默认
    //   { conclusion:'异常' }      → 'conclusion'
    //   { data:{ status:'异常' } } → 'data.status'
    //   直接返回字符串 '异常'       → ''（空串，整条就是一句结论文字）
    // 取不到时结论存 null，前端弹窗会提示"未取到结论，请检查结果解析设置"。
    conclusionPath: 'result',

    // 单条结果里"置信度"字段的点路径（空串 '' = 没有置信度，存 null）：
    //   { result:'异常', confidence:0.9 } → 'confidence'  ← 默认
    //   { result:'异常', score:0.9 }      → 'score'
    // 注意 0 是合法置信度，不会被当成"没有"；前端进度条 0~1 与 0~100 两种约定都兼容。
    confidencePath: 'confidence',
  },

  // ==========================================================================
  // 二、自动判定节奏（只有"后端定时器"这条链路用）
  // ==========================================================================
  AUTO_JUDGMENT: {
    // 自动判定总开关。
    //   true  → 后端启动时拉起定时器，每 intervalMs 判一次；左侧菜单也显示「智能判定（自动）」
    //   false → 不启动定时器（只能页面上手动点按钮）；菜单项由 showMenu 单独控制
    enabled: true,
    // 每隔多少毫秒判定一次。小于 1000 按 1000 算（最快 1 秒一次）。
    // 现场判定服务响应慢时把它调大（否则日志会不停出现"上一轮还没判完，跳过这一轮"）。
    intervalMs: 5000,
    // 每次取最新多少条**传感器数据**去判定（1~100，超出会被夹到范围内）。
    // ⚠ 取样 SQL 在 intelligentJudgment.js 的 runAutoOnce() 里写死为 t_sensor_data + c_time DESC，
    //   所以：① 这条链路不带行为数据；② 设备时钟不准（例如上报 2005 年）时会取到旧数据。
    recentCount: 5,
    // 后端内存里保留最近多少轮结果（1~500），供「自动判定」页刚打开时补历史（GET /api/intelligent/auto-recent）。
    // 只影响前端展示，不影响判定本身。
    bufferSize: 50,
    // 左侧菜单是否显示「智能判定（自动）」页
    showMenu: true,
  },

  // ==========================================================================
  // 三、消息即触发判定（每条 MQTT 消息到达就异步判一次，"最快但压力最大"）
  // ==========================================================================
  REALTIME_JUDGMENT: {
    // 消息即触发总开关。
    //   false → 消息到达只跑本地控制逻辑（安全联锁/PID/…），不调判定服务
    //   true  → 每条消息都异步判定一次（fire-and-forget，不阻塞消息主流程）
    // ⚠ 只把这里改成 true **不会生效**：combinedRealtimeHandler.js 底部的
    //   triggerRealtimeJudgment(info) 调用目前是注释状态，要一起解开（见该文件底部说明）。
    // 由 mqtt/combinedRealtime/combinedRealtimeHandler.js 读取，改完重启后端生效。
    enabled: false,
  },
}
// // ====去年模拟题目=======
    // const RECOGNIZE_API_URL = 'http://localhost:5000/infer';
    // // 1. 读取本地图片转 base64
    // // 拼接路径、最终 imagePath = D:\project\iot_competitions\sensor-project\backend\sc\static\image4282.png（__dirname — Node.js 全局变量，表示当前文件所在目录）
    // const imagePath = path.join(__dirname, 'sc', 'static', 'image4282.png');
    // // fs.readFileSync()同步读取文件（读完后才继续执行下一行），返回 Buffer 对象（二进制数据）
    // const imageBuffer = fs.readFileSync(imagePath);
    // // toString('base64')  把二进制 Buffer 转成 base64 文本字符串
    // const base64Image = imageBuffer.toString('base64');
    // const dataUrl = `data:image/png;base64,${base64Image}`;
    // // 2. 调用 YOLO 服务
    // const response = await fetch(RECOGNIZE_API_URL, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },  
    //   body: JSON.stringify({ image: dataUrl })
    // });
    // const result = await response.json();
    // console.log('模型的返回结果result',result);
    // // 这个模型的返回结果
    // // result {
    // //  inference_results: [ { class: 61, confidence: 0.319576621055603, label: 'toilet' } ], 
    // //  processed_image: '....'
    // // }
