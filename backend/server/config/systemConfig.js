/** 【文件职责】配置中心核心模块：默认值、持久化、校验和热更新通知均在此实现。
 * 【配置中心关联】本文件定义所有场景项；调用 getConfig() 必须实时取值，不要复制后长期缓存。 */
const fs = require('fs')
const path = require('path')
const EventEmitter = require('events')

/**
 * 【文件职责】配置中心的唯一数据源与热更新发布器。
 * 维护默认场景、读取和原子保存 system-config.json、校验配置，并通过 onChange
 * 让 MQTT、告警、页面接口等模块即时应用新场景。
 * 【配置中心关联】本文件定义全部配置项；MQTT_URL/MQTT_TOPICS/MQTT_QOS 驱动 MQTT
 * 重连订阅，HEARTBEAT_TIMEOUT 驱动在线判定，CONTROL_VALUE_MAP/字段数组驱动协议适配。
 *
 * ============================================================================
 * 系统配置中心 / 场景配置说明
 * ============================================================================
 *
 * 这份文件是系统的“默认场景模板”，负责保存不应写死在业务代码里的参数，
 * 例如 MQTT 主题、设备编号字段、页面术语、告警规则和智能判定接口。
 * 更换比赛题目时，通常只修改场景配置和数据库元数据，不需要改 Vue/Node.js 代码。
 *
 * 【配置从哪里来，谁的优先级最高】
 * 1. defaultConfig：本文件中的出厂默认值，第一次启动或执行“恢复默认”时使用。
 * 2. backend/server/data/system-config.json：用户在页面/API 保存后的持久化配置，
 *    启动时会覆盖默认值。该文件自动生成，不建议运行期间手工修改。
 * 3. 环境变量：MQTT_URL/MQTT_USERNAME/MQTT_PASSWORD 只用于生成默认值；一旦已经
 *    保存 system-config.json，持久化配置优先。SYSTEM_CONFIG_FILE 可修改配置文件位置。
 *
 * 【推荐修改方法】
 * - 浏览器：“场景配置”页面 -> 导出备份 -> 修改 JSON -> 校验并应用。
 * - API：GET /api/system-config/export 导出完整场景包；
 *        POST /api/system-config/import 导入完整场景包；
 *        POST /api/system-config 只更新传入的配置项。
 * - 源码：只有需要修改所有新场景的出厂默认值时，才修改 defaultConfig。
 *
 * 【保存和生效机制】
 * - 保存前会校验类型、范围、必填主题和必要字段；拼错的顶层配置名会被拒绝。
 * - 配置先写入 .tmp 临时文件，再原子替换正式文件，降低断电造成文件损坏的风险。
 * - 页面显示、超时和告警规则立即生效；MQTT 参数发生变化时自动断开并重新连接。
 * - 场景包中的 metadata 保存三张数据库元数据表，不属于 defaultConfig；导入时由
 *   configController 在数据库事务中处理，失败会回滚。
 *
 * 【布尔值规则】true=开启，false=关闭。不要写成字符串 "true"/"false"。
 * 【时间单位】除数据库时间外，本文件中的 timeout/interval 均以毫秒为单位。
 * 【安全原则】ENABLE_AUTO_INTERLOCK 默认必须保持 false，只有确认设备接线、继电器
 * 高低电平和控制协议后才能开启。错误联锁可能导致水泵或加热模块误动作。
 * ============================================================================
 */

// 场景结构版本。以后配置结构升级时用于兼容旧场景包，不表示项目版本。
const CONFIG_VERSION = 2

// 配置落盘位置。生产环境可用 SYSTEM_CONFIG_FILE 指向其他可写目录。
const CONFIG_FILE = process.env.SYSTEM_CONFIG_FILE
  ? path.resolve(process.env.SYSTEM_CONFIG_FILE)
  : path.join(__dirname, '../data/system-config.json')

const defaultConfig = {
  // --------------------------------------------------------------------------
  // 1. 场景身份与页面标题
  // --------------------------------------------------------------------------
  // 自动写入的结构版本，不要手动修改。
  CONFIG_VERSION,

  // 场景短名称：用于场景包文件名和现场区分，例如“仓储环境监测”。
  SCENE_TAG: '2026水循环系统',

  // 场景用途说明：建议写清传感器、执行器和主要功能，便于交接。
  SCENE_DESCRIPTION: '双温度、流量、压力监测及水泵、加热模块控制',

  // 左侧导航标题和浏览器页签标题。
  SYSTEM_TITLE: '水循环智能监控系统',

  // 设备的通用称呼，供需要显示“设备/灯杆/水循环控制器”等名称的页面使用。
  DEVICE_LABEL: '设备',

  // --------------------------------------------------------------------------
  // 2. 设备模式与字段显示
  // --------------------------------------------------------------------------
  // true：系统只控制一套设备，自动选数据库中的第一台设备并隐藏选择器。
  // false：多设备模式，操作时允许选择设备，控制消息会按需要携带 d_no。
  SINGLE_DEVICE_MODE: true,

  // 是否隐藏数据库自增主键 id。只影响页面显示，不影响查询、判定和数据库存储。
  HIDE_ID_FIELDS: true,

  // 是否隐藏设备编号列（设备编号、d_no、deviceId 等）。
  HIDE_NUMBER_FIELDS: false,

  // 时间格式是否显示秒：true 显示为 "2026/07/20 11:51:03"，false 显示为 "2026/07/20 11:51"。
  SHOW_SECONDS: true,

  // 在多设备模式下强制隐藏设备选择器。单设备模式下选择器始终隐藏。
  HIDE_DEVICE_SELECTOR: false,

  // --------------------------------------------------------------------------
  // 2.1 传感器字段语义槽位（业务语义 → t_sensor_data 物理字段）
  // --------------------------------------------------------------------------
  // 自动控制、安全联锁、故障判断、分层联动、需要计算的数据这几个模块，都要从
  // t_sensor_data 里区分出"哪个字段是温度1/温度2/流量/压力"，但数据库字段名
  // 只是 field1~field10 这种无语义的槽位，具体谁是谁由 t_sensor_field_mapper
  // 表的实际配置决定。这里集中配置一份"语义→槽位"映射，避免分散在多个后端
  // 文件里各自硬编码——以后调整传感器接线/字段布局，只需要改这一处。
  // key 是业务语义，代码里按这些固定 key 读取，不能改名：
  //   temp1    - 温度1（进水）
  //   temp2    - 温度2（出水）
  //   flow     - 瞬时流量
  //   pressure - 压力
  // value 是 t_sensor_data 表对应的物理字段名（field1~field10），要跟
  // t_sensor_field_mapper 表里实际配置的 db_name 保持一致。
  SENSOR_FIELD_MAP: {
    temp1: 'field1',
    temp2: 'field2',
    flow: 'field3',
    pressure: 'field4',
  },

  // --------------------------------------------------------------------------
  // 3. 页面功能开关
  // --------------------------------------------------------------------------
  // 是否在传感器历史页面显示“智能判定”按钮。
  ENABLE_SENSOR_RECOGNIZE: true,

  // 是否在运行状态/行为历史页面显示“智能判定”按钮。
  ENABLE_BEHAVIOR_RECOGNIZE: true,

  // 是否在左侧菜单显示“智能判定记录”页面。
  ENABLE_JUDGMENT_HISTORY: true,

  // 操作历史记录模式：
  // both=同时记录软件指令和底层操作（推荐）；software_only=只记录软件指令；
  // device_only=只记录底层设备操作；off=完全关闭操作历史写入。
  // “软件指令”包括页面在线下发、离线补发、自动联锁和自动校时；
  // “底层操作”指设备状态上报与系统保存的期望状态不一致时识别出的现场操作。
  OPERATION_HISTORY_MODE: 'both',

  // 是否显示历史/实时数据图表。关闭后只保留表格或卡片。
  ENABLE_CHARTS: true,

  // 是否根据 ALARM_RULES 在服务端自行计算告警；不影响设备主动上报的告警。
  ENABLE_LOCAL_ALARM: true,

  // 是否在本地规则触发后执行 rule.action。默认关闭，开启前必须进行实机安全测试。
  ENABLE_AUTO_INTERLOCK: false,

  // --------------------------------------------------------------------------
  // 4. 累计与滑动统计指标
  // --------------------------------------------------------------------------
  // 每条配置代表一个“累计某字段”的指标，后端用 MySQL 窗口函数 SUM/AVG/COUNT
  // OVER (ORDER BY c_time ROWS UNBOUNDED PRECEDING) 计算累加值。
  // 字段说明：
  //   metric_key   - 数据库标识（小写字母+下划线），如 cumulative_flow
  //   metric_name  - 页面显示中文名，如“累计流量”
  //   source_table - 源表：t_sensor_data 或 t_behavior_data
  //   source_field - 源表中的数值字段（如 field3）
  //   unit         - 单位，如 L、min
  //   enabled      - true 启用累计计算；false 仅保留配置不查询
  //   mode         - "inline"=合入历史表/图表，"standalone"=仅首页独立展示，"both"=两者同时
  //   precision    - 小数位数
  //   chart_type   - ECharts 图表类型：line 或 bar
  //   color        - 图表系列颜色
  // 2026 水循环示例：累计流量、累计加热时长、累计水泵运行时长
  CUMULATIVE_METRICS: [
    {
      metric_key: 'cumulative_flow',
      metric_name: '累计流量',
      source_table: 't_sensor_data',
      source_field: 'field3',
      unit: 'L',
      enabled: false,
      mode: 'standalone',
      precision: 2,
      chart_type: 'bar',
      color: '#0ea5e9',
    },
    {
      metric_key: 'cumulative_heat_time',
      metric_name: '累计加热时长',
      source_table: 't_behavior_data',
      source_field: 'heater_on_seconds',
      unit: 'min',
      enabled: false,
      mode: 'standalone',
      precision: 1,
      chart_type: 'line',
      color: '#f59e0b',
    },
    {
      metric_key: 'cumulative_pump_time',
      metric_name: '累计水泵运行时长',
      source_table: 't_behavior_data',
      source_field: 'pump_on_seconds',
      unit: 'min',
      enabled: false,
      mode: 'standalone',
      precision: 1,
      chart_type: 'line',
      color: '#10b981',
    },
  ],

  // --------------------------------------------------------------------------
  // 时间窗口指标使用 MySQL 窗口函数实时计算滑动平均、波动幅度和相邻变化量。
  // 每条配置使用 MySQL LAG + 窗口函数实时计算滑动统计指标。
  // 字段说明：
  //   metric_key    - 数据库标识（小写字母+下划线）
  //   metric_name   - 页面显示中文名
  //   source_table  - 源表：t_sensor_data 或 t_behavior_data
  //   source_field  - 源字段 db_name（如 field2）
  //   aggregation   - 聚合类型：avg(滑动平均) | volatility(MAX-MIN波动) | rate(变化率)
  //   window_size   - 滑动窗口行数（rate类型固定为2行差值）
  //   unit          - 单位
  //   enabled       - true 启用
  //   mode          - "standalone"=仅首页独立展示，"inline"=合入历史图表，"both"=两者同时
  //   chart_type    - ECharts 图表类型：line 或 bar
  //   color         - 图表系列颜色
  // 王玺博士关注的：滑动平均（热惯性）、波动幅度（湍流/水锤）、变化率（升温速率/堵塞检测）
  TIME_WINDOW_METRICS: [
    {
      metric_key: 'rolling_avg_temp',
      metric_name: '出水温度滑动平均(5点)',
      source_table: 't_sensor_data',
      source_field: 'field2',
      aggregation: 'avg',
      window_size: 5,
      unit: '℃',
      precision: 2,
      enabled: false,
      mode: 'standalone',
      chart_type: 'line',
      color: '#3b82f6',
    },
    {
      metric_key: 'rolling_avg_flow',
      metric_name: '流量滑动平均(5点)',
      source_table: 't_sensor_data',
      source_field: 'field3',
      aggregation: 'avg',
      window_size: 5,
      unit: 'L/min',
      precision: 2,
      enabled: false,
      mode: 'standalone',
      chart_type: 'line',
      color: '#0ea5e9',
    },
    {
      metric_key: 'flow_volatility',
      metric_name: '流量波动幅度(10点)',
      source_table: 't_sensor_data',
      source_field: 'field3',
      aggregation: 'volatility',
      window_size: 10,
      unit: 'L/min',
      precision: 2,
      enabled: false,
      mode: 'standalone',
      chart_type: 'bar',
      color: '#f59e0b',
    },
    {
      metric_key: 'pressure_pulsation',
      metric_name: '压力脉动(20点)',
      source_table: 't_sensor_data',
      source_field: 'field5',
      aggregation: 'volatility',
      window_size: 20,
      unit: 'kPa',
      precision: 2,
      enabled: false,
      mode: 'standalone',
      chart_type: 'bar',
      color: '#ef4444',
    },
    {
      metric_key: 'temp_rising_rate',
      metric_name: '升温速率',
      source_table: 't_sensor_data',
      source_field: 'field2',
      aggregation: 'rate',
      window_size: 2,
      unit: '℃/次',
      precision: 2,
      enabled: false,
      mode: 'standalone',
      chart_type: 'line',
      color: '#f97316',
    },
    {
      metric_key: 'flow_decay_rate',
      metric_name: '流量衰减率',
      source_table: 't_sensor_data',
      source_field: 'field3',
      aggregation: 'rate',
      window_size: 2,
      unit: 'L/min/次',
      precision: 2,
      enabled: false,
      mode: 'standalone',
      chart_type: 'line',
      color: '#8b5cf6',
    },
  ],

  // --------------------------------------------------------------------------
  // 5. 分页、刷新与在线判定（单位：毫秒）
  // --------------------------------------------------------------------------
  // 历史表格默认每页条数，允许 1-100。
  DEFAULT_PAGE_SIZE: 5,

  // 实时页面刷新间隔；0 表示不自动刷新。3000 即 3 秒。
  REALTIME_REFRESH_INTERVAL: 3000,

  // 超过该时间没有收到某设备心跳，就判定离线。最小 1000；10000 即 10 秒。
  HEARTBEAT_TIMEOUT: 10000,

  // 心跳判定模式：
  // 'receive' = 自动上报：设备发一条 receive 主题的数据（传感器/行为字段）就代表在线，
  //             不需要单独发心跳包（默认）。
  // 'topic'   = 只认专门的心跳主题（MQTT_TOPICS.heartbeat），receive 主题的数据不影响在线判定。
  // 两种模式互斥，同一时刻只有一种在生效。
  HEARTBEAT_MODE: 'receive',

  // --------------------------------------------------------------------------
  // 6. MQTT 连接与主题
  // --------------------------------------------------------------------------
  // Broker 地址，必须以 mqtt:// 或 mqtts:// 开头，例如 mqtt://192.168.1.10:1883。
  MQTT_URL: process.env.MQTT_URL || 'mqtt://localhost:1883',

  // Broker 用户名；无需认证时留空字符串。不要把真实公网密码提交到 Git。
  MQTT_USERNAME: process.env.MQTT_USERNAME || '',

  // Broker 密码；无需认证时留空。配置导出会包含该值，场景包应妥善保管。
  MQTT_PASSWORD: process.env.MQTT_PASSWORD || '',

  // MQTT 服务质量：0=最多一次，1=至少一次，2=仅一次。现场通常使用 1。
  MQTT_QOS: 1,

  // 五种语义主题。值必须与设备固件一致，键名 sensor/behavior/... 不可改名。
  MQTT_TOPICS: {
    // 传感量上报：温度、流量、压力等连续测量值。
    // 设备把传感器字段和行为字段放在同一条消息里上报，所以 behavior 也指向这个主题；
    // mqtt/index.js 检测到两者相同时会用合并处理器代替分开的处理器。
    sensor: 'sensor_data',
    // 执行器/运行状态上报：水泵、加热、阀门状态等。
    behavior: 'sensor_data',
    // 设备主动告警上报。
    alarm: 'abnormal_state',
    // 设备心跳上报，用于在线/离线判断。
    heartbeat: 'heart_beat',
    // PC 端向设备下发控制指令。
    control: 'control',
  },

  // --------------------------------------------------------------------------
  // 7. 上报协议兼容
  // --------------------------------------------------------------------------
  // 普通数据包中“设备编号”的候选字段，按数组顺序查找，大小写不敏感。
  // 例如设备上报 {"deviceId":"water-01"} 时会命中 deviceId。
  // id 排第一个：现场设备上报的字段就叫 id（值是设备的硬件编号，需要跟 t_device.number
  // 完全一致才会被采信，见 utils/mappedData.js resolveDeviceNo）。
  DEVICE_ID_FIELDS: ['id', 'VID', 'deviceId', 'device_id', 'd_no', 'DNO'],

  // 普通数据包中“采集时间”的候选字段，按顺序查找；都没有时使用服务器当前时间。
  // 推荐设备直接上报 YYYY-MM-DD HH:mm:ss，避免现场时区解析差异。
  TIME_FIELDS: ['Time', 'time', 'timestamp', 'c_time'],

  // JSON 格式心跳中的设备编号候选字段。纯文本心跳（如 water-01）也支持。
  HEARTBEAT_DEVICE_FIELDS: ['id', 'VID', 'deviceId', 'device_id', 'd_no', 'DNO'],

  // 页面/数据库控制值 -> 设备真实值的映射。
  // 示例：页面存 on，设备协议要求 open，则下发 open；设备回报 open 时反向存为 on。
  // 若设备直接接受 on/off，请改为 { on: 'on', off: 'off' }。
  CONTROL_VALUE_MAP: { on: 'open', off: 'close' },

  // 设备主动告警 JSON 字段 -> 中文名称。值为 1 时记为异常，0 时记为正常。
  // 现场字段不同，只改左侧属性名即可；也可继续增加键值对。
  ALARM_FIELD_MAP: {
    temperature_warn: '温度',
    flow_warn: '流量',
    pressure_warn: '压力',
    pump_warn: '水泵',
    heater_warn: '加热模块',
  },

  // --------------------------------------------------------------------------
  // 8. 页面术语
  // --------------------------------------------------------------------------
  // 只改变页面名称，不影响 MQTT、数据库表名或 API 路径。
  TERMINOLOGY: {
    sensor: '传感器数据',
    behavior: '运行状态',
    device: '设备',
    alarm: '告警记录',
    judgment: '智能判定',
  },

  // --------------------------------------------------------------------------
  // 9. HTTP 智能判定适配器
  // --------------------------------------------------------------------------
  INTELLIGENT_JUDGMENT: {
    // true 才请求现场 HTTP 服务；false 时根据 mockWhenDisabled 决定是否返回占位结果。
    enabled: false,

    // 服务未启用时是否允许确定性的本地占位判定。比赛正式演示建议启用真实服务。
    mockWhenDisabled: true,

    // 完整 HTTP 地址。若服务在另一台电脑，127.0.0.1 必须改成那台电脑的局域网 IP。
    url: 'http://127.0.0.1:5000/judgment',

    // 常用 POST；也支持 GET/PUT 等 fetch 可用方法。GET/HEAD 不发送请求体。
    method: 'POST',

    // 单次请求超时时间，10000 表示 10 秒；超时会记录一条 failed 判定记录。
    timeoutMs: 10000,

    // HTTP 请求头。若接口需要 Token，可增加 Authorization: 'Bearer xxx'。
    // bodyFormat='form-data' 时这里配的 Content-Type 会被忽略（浏览器/Node fetch 会
    // 给 FormData 自动生成带边界串的 multipart Content-Type，手动指定反而会传错）。
    headers: { 'Content-Type': 'application/json' },

    // batch：勾选的多条数据一次提交；single：每条数据分别请求一次再汇总。
    requestMode: 'batch',

    // 请求体格式：
    //   'json'      - 默认，整个请求体按 JSON.stringify 发送（Content-Type: application/json）。
    //   'form-data' - 按 multipart/form-data 发送（比如现场服务要求文件上传/表单字段），
    //                  requestTemplate 渲染出的每个顶层字段会被当成一个 FormData 字段。
    //                  常见于去年那种“Python + 模型”接口，图像/数据文件用 multipart 传。
    bodyFormat: 'json',

    // 请求体模板。可用占位符：
    // {{records}}=全部数据数组，{{record}}=当前/第一条数据，{{ids}}=原数据 ID 数组；
    // 也可取具体字段，如 {{record.field1}}。占位符独占整个字符串时保留原数据类型。
    // method 为 GET/HEAD 时，这里渲染出的对象会被拼接成 URL 查询参数（不再放进请求体）。
    requestTemplate: { data: '{{records}}' },

    // 响应格式：
    //   'json' - 默认，把响应体当 JSON 解析，用下面的 resultPath/conclusionPath/
    //            confidencePath 这三个“点路径”从解析后的对象里取值。
    //   'text' - 响应不是规范 JSON（纯文字描述、或者解析失败），改用下面的
    //            conclusionRegex/confidenceRegex 两个正则直接从原始文本里抠结论和置信度。
    responseFormat: 'json',

    // ↓↓↓ responseFormat='json' 时生效 ↓↓↓
    // 从 HTTP 响应中提取结果的点路径。例如响应 {data:{results:[]}} 对应 data.results。
    // 留空字符串表示直接使用完整响应。
    resultPath: 'data.results',

    // 从单条结果中提取“结论”的点路径，例如 result、label 或 data.status。
    conclusionPath: 'result',

    // 从单条结果中提取“置信度”的点路径；无法转成数字时保存为 null。
    confidencePath: 'confidence',

    // ↓↓↓ responseFormat='text' 时生效 ↓↓↓
    // 从原始响应文本里提取“结论”的正则表达式，取第 1 个捕获组，例如响应文本是
    // “检测结果：异常，置信度0.87”，可以填 '检测结果：(\\S+?)，' 取出“异常”。
    // 留空表示不解析，结论会是 null。
    conclusionRegex: '',

    // 同上，用于提取“置信度”，取第 1 个捕获组并转成数字，例如上面例子可以填
    // '置信度([\\d.]+)' 取出 0.87。
    confidenceRegex: '',

    // 是否为异步任务模式：
    //   false - 默认，一次请求直接同步拿到判定结果（下面 async 开头的参数不生效）。
    //   true  - 现场服务处理较慢时的常见设计：第一次请求只是“提交任务”，响应里带一个
    //           任务 ID，真正的判定结果要另外发请求去查、且可能还没算完，需要轮询几次
    //           直到状态变成“完成”。开启后走 asyncJobIdPath 起手的这一组参数。
    asyncMode: false,

    // ↓↓↓ asyncMode=true 时生效 ↓↓↓
    // 从“提交任务”这次响应里提取任务 ID 的点路径，例如响应 {job_id:"abc"} 对应 job_id。
    asyncJobIdPath: 'job_id',

    // 查询任务结果的地址模板，用 {{jobId}} 占位符代入上面提取到的任务 ID，
    // 例如 'http://127.0.0.1:5000/result/{{jobId}}'。
    asyncPollUrl: '',

    // 查询任务结果用的 HTTP 方法，通常是 GET。
    asyncPollMethod: 'GET',

    // 两次轮询之间的间隔（毫秒）。
    asyncPollIntervalMs: 1000,

    // 从提交任务算起，最多等待多久（毫秒）；超过这个时间还没等到完成状态就判定超时失败。
    // 会覆盖上面的 timeoutMs（timeoutMs 只管每一次单独的 HTTP 请求本身，不管整个轮询过程）。
    asyncMaxWaitMs: 30000,

    // 从轮询响应里判断任务状态的点路径，例如响应 {status:"done"} 对应 status。
    asyncStatusPath: 'status',

    // 状态值命中这个列表里的任意一个，视为“已完成”，停止轮询、按 json/text 规则解析结果。
    asyncDoneStatusValues: ['done', 'success', 'completed'],

    // 状态值命中这个列表里的任意一个，视为“任务失败”，停止轮询并记录失败（不会一直轮询到超时）。
    asyncFailedStatusValues: ['failed', 'error'],
  },

  // --------------------------------------------------------------------------
  // 10. 安全联锁（安全锁联）规则
  // --------------------------------------------------------------------------
  // 触发任一启用条件时，自动关闭水泵和加热。阈值不从本配置写死，而是实时读取
  // 指令中心 t_direct 里对应的上下限阈值（温度/流量/压力），用户在页面改阈值即时生效。
  // 每个条件可用布尔值独立控制开关：
  //   enabled             - 安全联锁总开关
  //   flowLow             - 流量低于下限阈值或流量为 0
  //   pressureHigh        - 压力高于上限阈值或压力为 0
  //   tempHigh            - 任一温度高于上限阈值
  //   tempDiff            - 温差过大（两路温度差超过 tempDiffThreshold）
  //   tempDiffThreshold   - 温差阈值（℃），tempDiff=true 时生效
  //   manualMode          - 进入手动模式时安全关闭一次（人工修复）
  //   sensorOffline       - 任一传感器掉线（长期无数据上报 / 长期为 0 / 异常最大值）
  //   heaterWithoutPump   - 没打开水泵却打开了加热（水泵、加热开关状态均明确上报时才判断）
  //   alarmCooldownMs     - 同一告警的冷却时间（毫秒），避免高频重复触发
  //   showOnErrorPage     - 故障记录页面是否显示“安全联锁记录”表格（只控制前端展示，不影响联锁本身是否生效）
  // 模式语义：安全联锁在自动和手动模式下全程生效——触发任一启用条件都强制关闭水泵
  // 和加热。自动模式由自动控制按目标启停，手动模式人工开关，但安全联锁不会因手动
  // 强制开启而失效（如手动开加热但检测无水流仍会强制关闭加热）。
  SAFETY_INTERLOCK: {
    enabled: false,
    flowLow: true,
    pressureHigh: true,
    tempHigh: true,
    tempDiff: true,
    tempDiffThreshold: 3,
    manualMode: true,
    sensorOffline: true,
    heaterWithoutPump: true,
    alarmCooldownMs: 30000,
    showOnErrorPage: true,
  },

  // --------------------------------------------------------------------------
  // 11. 正常状况联动（自动控制）规则
  // --------------------------------------------------------------------------
  // 仅在“自动模式”下运行，按目标温度自动启停水泵和加热。可逐项开关：
  //   enabled              - 自动控制总开关
  //   pump                 - 允许自动控制水泵
  //   heater               - 允许自动控制加热
  //   targetTemp           - 默认目标温度（指令中心 target_temperature 优先）
  //   tempDiffCloseThreshold - 温差小于该值才允许“两侧达标后关泵”
  //   tempDiffOpenThreshold  - 温差超过该值判定“温差过大”，关闭加热
  //   totalFlowTarget      - 累计流量目标；达到后关闭水泵（0=不启用）
  AUTO_CONTROL: {
    enabled: false,
    pump: true,
    heater: true,
    targetTemp: 22,
    tempDiffCloseThreshold: 2,
    tempDiffOpenThreshold: 3,
  },

  // --------------------------------------------------------------------------
  // 11.1 自动模式下用哪一套联动逻辑
  // --------------------------------------------------------------------------
  // 'simple'  - 使用上面的 AUTO_CONTROL（按目标温度综合判断一次开关）
  // 'layered' - 使用下面的 LAYERED_CONTROL（严格按“单一传感器层 -> 多传感器融合层”分层规则判断）
  // 两套逻辑互斥，同一时刻只有一套在跑；SAFETY_INTERLOCK 安全联锁不受此项影响，全程独立生效。
  CONTROL_MODE: 'simple',

  // --------------------------------------------------------------------------
  // 11.2 分层联动规则（单一传感器独立控制层 + 多传感器融合联动层）
  // --------------------------------------------------------------------------
  // 仅在 CONTROL_MODE='layered' 且当前为“自动模式”且无安全故障时运行。
  // 每条规则可用布尔值独立开关；同一执行器本轮如有多条规则同时命中且结论矛盾，
  // “关闭”优先于“打开”（fail-safe）；多传感器融合层的结论优先于单一传感器层
  // （融合层对某执行器有结论就用融合层的，融合层没结论的执行器再看单一传感器层）。
  //   enabled                 - 分层联动总开关
  //   ---- 二、单一传感器独立控制层 ----
  //   tempSingle               - 温度：任一温度低于目标/下限开加热，高于目标/上限关加热
  //   tempHysteresis           - 温度滞回回差（℃），开、关阈值各向外扩这么多，避免频繁通断
  //   flowSingle                - 流量：区间内或低于下限开水泵（低于下限也要开泵才能把流量拉回来），高于上限关水泵保护
  //   pressureSingle            - 压力：低于下限开水泵，高于上限关水泵、关加热
  //   ---- 三、多传感器融合联动层 ----
  //   dualTemp                 - 双温度：温差超过 dualTempDiffThreshold 打开水泵
  //   dualTempDiffThreshold    - 双温度融合层的温差阈值（℃），建议比 SAFETY_INTERLOCK.tempDiffThreshold 小，
  //                              否则安全联锁会先于本条触发（安全联锁触发后整套系统强制关闭，本条不会生效）
  //   tempFlow                  - 温度+流量：温度超上限且流量正常关加热；温度未超上限且流量低于下限开加热开水泵
  //   pressureFlow              - 压力+流量：压力超上限且流量低于下限关水泵；压力低于下限且流量正常开水泵；压力超上限且流量超上限关水泵
  //   tempPressure              - 温度+压力：压力超上限且加热温度持续上升关加热；压力低于下限且温度低于下限先开水泵再开加热
  LAYERED_CONTROL: {
    enabled: false,
    tempSingle: true,
    tempHysteresis: 1,
    flowSingle: true,
    pressureSingle: true,
    dualTemp: true,
    dualTempDiffThreshold: 2,
    tempFlow: true,
    pressureFlow: true,
    tempPressure: true,
  },

  // --------------------------------------------------------------------------
  // 12. 定量停机规则
  // --------------------------------------------------------------------------
  // 设定一个定量值（单位 L）。当本次计量周期的累计流量 >= 该值时，关闭水泵和加热，
  // 整套系统自动停机，完成定量换热。
  //   enabled           - 定量停机总开关
  //   totalFlowTarget   - 定量值（L），例如 500
  // 总流量只做累计统计，不参与水泵/加热的实时调节，仅用于停机判定。
  // 每次进入自动模式会开始新的计量周期；切回手动模式则重置计量周期。
  QUANTITY_SHUTDOWN: {
    enabled: false,
    totalFlowTarget: 500,
  },

  // --------------------------------------------------------------------------
  // 12.1 故障状态（硬故障保护 + 复位按钮状态机）
  // --------------------------------------------------------------------------
  // 触发任一启用条件时：①保存故障前快照 ②强制关闭水泵和加热 ③系统状态置 FAULT
  // ④复位按钮自动拨到"开"（仅 UI 显示，不修改硬件）⑤指令页面其他开关和参数全部锁定只读。
  // 用户人工修复设备后手动把复位按钮拨回"关"，系统按快照恢复所有参数和开关显示、按快照
  // 重启执行器，回到 NORMAL。修复后又复发的情形：故障态下拨回 OFF 但故障条件仍存在 ->
  // 立即重新触发故障。
  //
  // 五种故障（编号对应需求文档）：
  //   ① pipe_blockage      进水口/管道堵塞：压力 < 压力下限 OR 压力 > 压力上限
  //   ② outlet_blockage    出水口堵塞：流量 < 流量下限
  //   ③ dry_burn           干烧：加热开启后连续 dryBurnDurationMs 出水温度变化 < dryBurnMinRiseC
  //   ④ pump_idle          水泵空转：水泵开启但流量 = 0
  //   ⑤ pump_fault         水泵故障：水泵开启，进出水温差 > tempDiffThreshold（从指令中心读取）
  //
  // 优先级（同时触发时取最高优先级处理和显示）：
  //   干烧(③) > 管道堵塞(①) > 水泵故障(⑤) > 水泵空转(④) > 出水口堵塞(②)
  //
  // 与安全联锁（SAFETY_INTERLOCK）相互独立、都全程生效，条件可能同时命中（多层防护叠加，
  // 不冲突）。每条条件可用布尔值独立开关：
  //   enabled              - 故障状态总开关
  //   pipeBlockage         - 故障①：进水口/管道堵塞
  //   outletBlockage       - 故障②：出水口堵塞
  //   dryBurn              - 故障③：干烧
  //   pumpIdle             - 故障④：水泵空转
  //   pumpFault            - 故障⑤：水泵故障
  //   dryBurnDurationMs    - 加热开启后判定"温度不上升"所需的持续时长（毫秒），默认 5000
  //   dryBurnMinRiseC      - 温度上升超过这个值（℃）就算"有在升温"，重新计时，默认 0.1
  //   alarmCooldownMs      - 同一故障的冷却时间（毫秒），避免高频重复触发
  //   tempDiffThreshold    - 故障⑤水泵故障的温差阈值兜底默认值（℃）。指令中心配置了
  //     "温差阈值"指令项（preffix=temp_diff）就优先用指令中心的，未配置时才用这里的值；
  //     跟 Kp/Ki/Kd 那套"指令中心优先、配置中心兜底"是同一套模式。
  // 注：压力上下限、流量下限、目标温度等其余阈值类参数仍然只从指令中心 t_direct 实时
  //     读取，不在配置中心维护，本次改动不影响它们。
  FAULT_STATUS: {
    enabled: false,
    pipeBlockage: true,
    outletBlockage: true,
    dryBurn: true,
    pumpIdle: true,
    pumpFault: true,
    dryBurnDurationMs: 5000,
    dryBurnMinRiseC: 0.1,
    alarmCooldownMs: 30000,
    tempDiffThreshold: 3,
  },

  // --------------------------------------------------------------------------
  // 12.2 PID 恒温控制（时间比例控制）
  // --------------------------------------------------------------------------
  // 加热模块只有开关量、没有功率输出，用“时间比例控制”模拟 PWM：固定周期 windowMs，
  // PID 输出的占空比 duty(0~100%) 决定这个周期内加热开多久。仅接管加热这一个执行器，
  // 水泵仍由 CONTROL_MODE（simple/layered）对应模块决定；enabled=true 时 autoControl.js /
  // layeredControl.js 会跳过各自的加热下发。
  //   enabled       - PID 恒温控制总开关
  //   kp/ki/kd      - PID 三个系数
  //   windowMs      - 时间比例控制周期（毫秒），默认 10000（10 秒）
  //   targetTemp    - 默认目标温度（指令中心 target_temperature 优先）
  PID_HEATING: {
    enabled: false,
    kp: 20,
    ki: 0.5,
    kd: 5,
    windowMs: 10000,
    targetTemp: 22,
    // 精准控制增强参数（未配置时使用这些默认值）
    deadband: 0.2,            // 死区(℃)：误差小于此值保持上一次 duty
    derivativeFilter: 0.3,    // 微分滤波系数 0~1：越小滤波越强
    dutyRampLimit: 15,        // 占空比斜率限制(%/周期)：0=不限制
    kff: 0,                   // 前馈系数：0=禁用，建议 0.5~2
  },

  // --------------------------------------------------------------------------
  // 12.3 PID 自整定（继电反馈整定法 / Relay Feedback Autotuning）
  // --------------------------------------------------------------------------
  // 开启后暂时接管加热输出：让加热器在“目标温度 ± 回差”之间强制切换高/低占空比，
  // 逼出温度的稳定振荡，记录振荡周期和振幅后按 Ziegler-Nichols 公式反推 Kp/Ki/Kd，
  // 只写入 result 作为“建议值”，不会自动覆盖当前生效的 Kp/Ki/Kd，需要在页面点“应用”。
  //   enabled       - 开始/停止自整定
  //   relayHighDuty - 继电测试高电平占空比(%)
  //   relayLowDuty  - 继电测试低电平占空比(%)
  //   hysteresis    - 温度回差(℃)，防止在目标温度附近抖动切换
  //   minCycles     - 至少采集多少个完整振荡周期才计算结果（第 1 个周期数据不稳定会丢弃）
  //   timeoutMs     - 整定超时时间，超时未完成自动判定失败并停止
  // status/progress/message/result 由服务运行时写回，不需要手动填。
  PID_AUTOTUNE: {
    enabled: false,
    relayHighDuty: 100,
    relayLowDuty: 0,
    hysteresis: 0.3,
    minCycles: 4,
    timeoutMs: 1800000,
    status: 'idle',   // idle | running | done | failed
    progress: 0,
    message: '',
    result: null,     // { ku, pu, amplitude, kp, ki, kd, tunedAt }
  },

  // --------------------------------------------------------------------------
  // 13. 需要计算的数据（首页专用展示板块）
  // --------------------------------------------------------------------------
  // 每个指标可用布尔值独立控制是否在首页展示；enabled 是总开关。
  //   resistanceK              - 系统阻力系数 K = ΔP / Q²（结垢/堵塞黄金指标）
  //   pressureDropRate         - 压力陡降速率 V = dP/dt（吸入空气紧急停泵判定）
  //   tempChangeRate           - 温度变化率 dT/dt（断线/开路/短路判定）
  //   heatExchangeEfficiency   - 换热效率 η = ρ·Cp·Q·ΔT / P_heater
  //   eerHeatBalance           - 系统能效比（COP）与热平衡（换热量/热损失）
  //   flowPressureCurve        - 流量-压力特性曲线拟合（线性回归斜率）
  //   cumulativeFlow           - 累计流量（上一时刻总流量 + 瞬时流量 × 时间）
  //   averageVelocity          - 平均流速 v = Q / A
  //   waterLevel               - 液位（基于两水箱初始水量与累计流量）
  // 计算参数：
  //   heaterRatedPower（W）、pipeAreaCm2（水管横截面积）、
  //   initialWaterTank1/2（两水箱初始水量 L）、tankAreaCm2（水箱横截面积，用于液位高度）
  COMPUTED_METRICS: {
    enabled: true,
    resistanceK: true,
    pressureDropRate: true,
    tempChangeRate: true,
    heatExchangeEfficiency: true,
    eerHeatBalance: true,
    flowPressureCurve: true,
    cumulativeFlow: true,
    averageVelocity: true,
    waterLevel: true,
    averageTempChart: true,
    averageVelocityChart: true,
    heaterRatedPower: 2000,
    pipeAreaCm2: 3.14,
    initialWaterTank1: 5,
    initialWaterTank2: 5,
    tankAreaCm2: 100,
  },

  // --------------------------------------------------------------------------
  // 13.1 历史图表页面显示控制
  // --------------------------------------------------------------------------
  // 控制"历史图表"页面上每张图是否展示、每张图最多显示多少个数据点（对应各查询接口
  // 的 limit 参数）。比赛现场可以按需临时关掉不需要的图，减少页面干扰、加快加载。
  //   pointLimit             - 每张图最多显示多少个数据点
  //   showCumulative          - 显示"累计统计"
  //   showTimeWindow          - 显示"滑动统计"
  //   showAverageChart        - 显示"平均温度与平均流速"
  //   showTempChart           - 显示"温度曲线"（温度1/温度2 原始读数对比）
  //   showFlowPressureChart   - 显示"瞬时流量与压力"
  //   showPidTrackingChart    - 显示"PID跟踪对比"（目标温度参考线 + 温度2 实际值）
  //   showDeviceStateChart    - 显示"设备状态时间线"（水泵/加热开关阶梯图）
  //   showDerivedMetricCharts - 显示"公式与图表"里勾选了"历史图表"的自定义指标
  HISTORY_CHARTS: {
    pointLimit: 300,
    showCumulative: true,
    showTimeWindow: true,
    showAverageChart: true,
    showTempChart: true,
    showFlowPressureChart: true,
    showPidTrackingChart: true,
    showDeviceStateChart: true,
    showDerivedMetricCharts: true,
  },

  // --------------------------------------------------------------------------
  // 13.2 首页开关运行时长显示
  // --------------------------------------------------------------------------
  // 控制首页"最新传感数据"运行状态区，水泵/加热开启时是否额外显示"累计运行时长"
  // 和"本次已运行时长"。数据来源固定为 CUMULATIVE_METRICS 中 metric_key 为
  // cumulative_pump_time / cumulative_heat_time 的两条记录（字段改了不用同步改这里）。
  SWITCH_DURATION_DISPLAY: {
    enabled: true,
  },

  // --------------------------------------------------------------------------
  // 14. 本地告警与自动联锁规则
  // --------------------------------------------------------------------------
  // 每条规则字段说明：
  // id：稳定且唯一的英文编号，也作为告警编号；name：页面显示名称；
  // source_table + source_field：待比较字段的"槽位"（跟 CUMULATIVE_METRICS/
  //   TIME_WINDOW_METRICS 认字段的方式一致），实际物理名从对应的字段映射表
  //   （t_sensor_field_mapper/t_behavior_field_mapper）动态解析，字段映射表改了
  //   物理名不用同步改这里；旧规则仍可以用 field 直接写死候选别名数组兼容。
  // operator：支持 >、>=、<、<=、==、!=；threshold：数值阈值；
  // enabled：是否启用该规则；cooldownMs：可选告警冷却时间；
  // require：可选前置条件，同样用 source_table+source_field（或 field），
  //   values 为任一允许值；
  // action：联锁动作，field 是下发 JSON 属性名，value 会经过 CONTROL_VALUE_MAP 转换。
  // 注意：action 只有 ENABLE_AUTO_INTERLOCK=true 时才实际下发。
  ALARM_RULES: [
    {
      id: 'temperature_high',
      name: '出水温度过高',
      source_table: 't_sensor_data',
      source_field: 'field2',
      operator: '>',
      threshold: 80,
      action: { field: 'heater', value: 'off' },
      enabled: true,
    },
    {
      id: 'flow_low',
      name: '循环流量过低',
      source_table: 't_sensor_data',
      source_field: 'field3',
      operator: '<',
      threshold: 0.5,
      // 只有水泵处于开启状态时，低流量才属于异常。
      require: { source_table: 't_behavior_data', source_field: 'field2', values: ['open', 'on', 1, true] },
      action: { field: 'heater', value: 'off' },
      enabled: true,
    },
    {
      id: 'pressure_high',
      name: '管路压力过高',
      source_table: 't_sensor_data',
      source_field: 'field5',
      operator: '>',
      threshold: 500,
      action: { field: 'pump', value: 'off' },
      enabled: true,
    },
  ],
}

const events = new EventEmitter()

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

/** 拒绝拼错的嵌套键和错误类型，避免 API 返回成功但配置被静默忽略。 */
function assertCompatibleShape(reference, incoming, pathPrefix = '') {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw new Error(`${pathPrefix || '配置'} 必须是 JSON 对象`)
  }
  for (const [key, value] of Object.entries(incoming)) {
    const pathName = pathPrefix ? `${pathPrefix}.${key}` : key
    if (!Object.prototype.hasOwnProperty.call(reference, key)) {
      throw new Error(`未知配置项: ${pathName}`)
    }
    const expected = reference[key]
    if (Array.isArray(expected)) {
      if (!Array.isArray(value)) throw new Error(`${pathName} 必须是数组`)
    } else if (expected && typeof expected === 'object') {
      if (['CONTROL_VALUE_MAP', 'ALARM_FIELD_MAP', 'INTELLIGENT_JUDGMENT.headers', 'INTELLIGENT_JUDGMENT.requestTemplate'].includes(pathName)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${pathName} 必须是 JSON 对象`)
        continue
      }
      assertCompatibleShape(expected, value, pathName)
    } else if (typeof value !== typeof expected) {
      throw new Error(`${pathName} 必须是 ${typeof expected} 类型`)
    }
  }
}

function mergeKnown(base, incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return clone(base)
  const result = clone(base)
  for (const key of Object.keys(base)) {
    if (!(key in incoming)) continue
    if (base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      if (incoming[key] && typeof incoming[key] === 'object' && !Array.isArray(incoming[key])) {
        result[key] = { ...result[key], ...clone(incoming[key]) }
      }
    } else if (typeof incoming[key] === typeof base[key]) {
      result[key] = clone(incoming[key])
    }
  }
  result.CONFIG_VERSION = CONFIG_VERSION
  return result
}

const METRIC_TABLES = new Set(['t_sensor_data', 't_behavior_data'])
const METRIC_MODES = new Set(['standalone', 'inline', 'both'])
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function validateMetricBase(metric, pathName) {
  if (!metric || typeof metric !== 'object' || Array.isArray(metric)) throw new Error(`${pathName} 必须是 JSON 对象`)
  for (const key of ['metric_key', 'metric_name', 'source_table', 'source_field']) {
    if (typeof metric[key] !== 'string' || !metric[key].trim()) throw new Error(`${pathName}.${key} 不能为空`)
  }
  if (!IDENTIFIER_PATTERN.test(metric.metric_key)) throw new Error(`${pathName}.metric_key 只能包含字母、数字和下划线，且不能以数字开头`)
  if (!METRIC_TABLES.has(metric.source_table)) throw new Error(`${pathName}.source_table 只能是 t_sensor_data 或 t_behavior_data`)
  if (!IDENTIFIER_PATTERN.test(metric.source_field)) throw new Error(`${pathName}.source_field 必须是合法字段名`)
  if (typeof metric.enabled !== 'boolean') throw new Error(`${pathName}.enabled 必须是布尔值`)
  if (!METRIC_MODES.has(metric.mode)) throw new Error(`${pathName}.mode 只能是 standalone、inline 或 both`)
  if (metric.precision !== undefined && (!Number.isInteger(metric.precision) || metric.precision < 0 || metric.precision > 6)) throw new Error(`${pathName}.precision 必须是 0-6 的整数`)
  if (!['line', 'bar'].includes(metric.chart_type)) throw new Error(`${pathName}.chart_type 只能是 line 或 bar`)
  if (typeof metric.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(metric.color)) throw new Error(`${pathName}.color 必须是 #RRGGBB 颜色`)
  if (typeof metric.unit !== 'string') throw new Error(`${pathName}.unit 必须是字符串`)
}

function validateAggregationMetrics(config) {
  const keys = new Set()
  config.CUMULATIVE_METRICS.forEach((metric, index) => {
    const pathName = `CUMULATIVE_METRICS[${index}]`
    validateMetricBase(metric, pathName)
    if (keys.has(metric.metric_key)) throw new Error(`指标标识重复: ${metric.metric_key}`)
    keys.add(metric.metric_key)
  })
  config.TIME_WINDOW_METRICS.forEach((metric, index) => {
    const pathName = `TIME_WINDOW_METRICS[${index}]`
    validateMetricBase(metric, pathName)
    if (keys.has(metric.metric_key)) throw new Error(`指标标识重复: ${metric.metric_key}`)
    keys.add(metric.metric_key)
    if (!['avg', 'volatility', 'rate'].includes(metric.aggregation)) throw new Error(`${pathName}.aggregation 只能是 avg、volatility 或 rate`)
    if (!Number.isInteger(metric.window_size) || metric.window_size < 2 || metric.window_size > 100) throw new Error(`${pathName}.window_size 必须是 2-100 的整数`)
  })
}

/** 校验影响稳定性和连接安全的关键字段；校验失败时不会写入配置文件。 */
function validate(config) {
  for (const key of ['SCENE_TAG', 'SCENE_DESCRIPTION', 'SYSTEM_TITLE', 'DEVICE_LABEL']) {
    if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`${key} 不能为空`)
  }
  for (const key of [
    'SINGLE_DEVICE_MODE', 'HIDE_ID_FIELDS', 'HIDE_NUMBER_FIELDS', 'HIDE_DEVICE_SELECTOR',
    'SHOW_SECONDS',
    'ENABLE_SENSOR_RECOGNIZE', 'ENABLE_BEHAVIOR_RECOGNIZE', 'ENABLE_JUDGMENT_HISTORY',
    'ENABLE_CHARTS', 'ENABLE_LOCAL_ALARM', 'ENABLE_AUTO_INTERLOCK',
  ]) {
    if (typeof config[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`)
  }
  if (!Number.isInteger(config.DEFAULT_PAGE_SIZE) || config.DEFAULT_PAGE_SIZE < 1 || config.DEFAULT_PAGE_SIZE > 100) throw new Error('DEFAULT_PAGE_SIZE 必须是 1-100 的整数')
  if (!Number.isFinite(config.REALTIME_REFRESH_INTERVAL) || config.REALTIME_REFRESH_INTERVAL < 0) throw new Error('REALTIME_REFRESH_INTERVAL 不能小于 0')
  if (!Number.isFinite(config.HEARTBEAT_TIMEOUT) || config.HEARTBEAT_TIMEOUT < 1000) throw new Error('HEARTBEAT_TIMEOUT 不能小于 1000')
  if (!['receive', 'topic'].includes(config.HEARTBEAT_MODE)) throw new Error('HEARTBEAT_MODE 只能是 receive 或 topic')
  if (!Number.isInteger(config.MQTT_QOS) || config.MQTT_QOS < 0 || config.MQTT_QOS > 2) throw new Error('MQTT_QOS 只能是 0、1、2')
  if (!['both', 'software_only', 'device_only', 'off'].includes(config.OPERATION_HISTORY_MODE)) throw new Error('OPERATION_HISTORY_MODE 只能是 both、software_only、device_only 或 off')
  if (!/^mqtts?:\/\//i.test(config.MQTT_URL)) throw new Error('MQTT_URL 必须以 mqtt:// 或 mqtts:// 开头')
  for (const key of ['sensor', 'behavior', 'alarm', 'heartbeat', 'control']) {
    if (!String(config.MQTT_TOPICS[key] || '').trim()) throw new Error(`MQTT_TOPICS.${key} 不能为空`)
  }
  if (!Array.isArray(config.DEVICE_ID_FIELDS) || config.DEVICE_ID_FIELDS.length === 0) throw new Error('DEVICE_ID_FIELDS 至少需要一个字段')
  if (!Array.isArray(config.TIME_FIELDS) || config.TIME_FIELDS.length === 0) throw new Error('TIME_FIELDS 至少需要一个字段')
  if (!Array.isArray(config.HEARTBEAT_DEVICE_FIELDS) || config.HEARTBEAT_DEVICE_FIELDS.length === 0) throw new Error('HEARTBEAT_DEVICE_FIELDS 至少需要一个字段')
  for (const key of ['temp1', 'temp2', 'flow', 'pressure']) {
    if (!/^field\d+$/.test(config.SENSOR_FIELD_MAP?.[key] || '')) throw new Error(`SENSOR_FIELD_MAP.${key} 必须是 field1~field10 这样的字段名`)
  }
  if (!config.INTELLIGENT_JUDGMENT.url || !/^https?:\/\//i.test(config.INTELLIGENT_JUDGMENT.url)) throw new Error('INTELLIGENT_JUDGMENT.url 必须是 http:// 或 https:// 地址')
  if (!Number.isFinite(config.INTELLIGENT_JUDGMENT.timeoutMs) || config.INTELLIGENT_JUDGMENT.timeoutMs <= 0) throw new Error('INTELLIGENT_JUDGMENT.timeoutMs 必须大于 0')
  if (!['batch', 'single'].includes(config.INTELLIGENT_JUDGMENT.requestMode)) throw new Error('INTELLIGENT_JUDGMENT.requestMode 只能是 batch 或 single')
  if (!['json', 'form-data'].includes(config.INTELLIGENT_JUDGMENT.bodyFormat)) throw new Error('INTELLIGENT_JUDGMENT.bodyFormat 只能是 json 或 form-data')
  if (!['json', 'text'].includes(config.INTELLIGENT_JUDGMENT.responseFormat)) throw new Error('INTELLIGENT_JUDGMENT.responseFormat 只能是 json 或 text')
  // 正则语法错误只在保存这一刻拦截；不拦的话现场只会在真正发起判定请求时才炸出运行时
  // 异常，界面上只看得到笼统的"判定失败"，不容易联想到是正则写错了。
  if (config.INTELLIGENT_JUDGMENT.responseFormat === 'text') {
    for (const key of ['conclusionRegex', 'confidenceRegex']) {
      const pattern = config.INTELLIGENT_JUDGMENT[key]
      if (!pattern) continue
      try { new RegExp(pattern) } catch (err) {
        throw new Error(`INTELLIGENT_JUDGMENT.${key} 不是合法的正则表达式：${err.message}`)
      }
    }
  }
  // asyncPollUrl/间隔/等待时长只在开启异步模式时才要求填对，避免没用到异步的场景被强制填一堆用不上的字段。
  if (config.INTELLIGENT_JUDGMENT.asyncMode) {
    if (!config.INTELLIGENT_JUDGMENT.asyncPollUrl || !/^https?:\/\//i.test(config.INTELLIGENT_JUDGMENT.asyncPollUrl)) {
      throw new Error('INTELLIGENT_JUDGMENT.asyncMode 开启时，asyncPollUrl 必须是 http:// 或 https:// 地址')
    }
    if (!Number.isFinite(config.INTELLIGENT_JUDGMENT.asyncPollIntervalMs) || config.INTELLIGENT_JUDGMENT.asyncPollIntervalMs <= 0) {
      throw new Error('INTELLIGENT_JUDGMENT.asyncPollIntervalMs 必须大于 0')
    }
    if (!Number.isFinite(config.INTELLIGENT_JUDGMENT.asyncMaxWaitMs) || config.INTELLIGENT_JUDGMENT.asyncMaxWaitMs <= 0) {
      throw new Error('INTELLIGENT_JUDGMENT.asyncMaxWaitMs 必须大于 0')
    }
    if (!Array.isArray(config.INTELLIGENT_JUDGMENT.asyncDoneStatusValues) || config.INTELLIGENT_JUDGMENT.asyncDoneStatusValues.length === 0) {
      throw new Error('INTELLIGENT_JUDGMENT.asyncDoneStatusValues 至少需要一个值，否则轮询永远等不到"完成"状态')
    }
  }
  const safety = config.SAFETY_INTERLOCK
  if (!safety || typeof safety !== 'object' || Array.isArray(safety)) throw new Error('SAFETY_INTERLOCK 必须是 JSON 对象')
  for (const key of ['enabled', 'flowLow', 'pressureHigh', 'tempHigh', 'tempDiff', 'manualMode', 'sensorOffline', 'heaterWithoutPump', 'showOnErrorPage']) {
    if (typeof safety[key] !== 'boolean') throw new Error(`SAFETY_INTERLOCK.${key} 必须是布尔值`)
  }
  if (!Number.isFinite(safety.tempDiffThreshold)) throw new Error('SAFETY_INTERLOCK.tempDiffThreshold 必须是数字')
  if (!Number.isFinite(safety.alarmCooldownMs) || safety.alarmCooldownMs < 0) throw new Error('SAFETY_INTERLOCK.alarmCooldownMs 必须是大于等于 0 的数字')
  const auto = config.AUTO_CONTROL
  if (!auto || typeof auto !== 'object' || Array.isArray(auto)) throw new Error('AUTO_CONTROL 必须是 JSON 对象')
  for (const key of ['enabled', 'pump', 'heater']) {
    if (typeof auto[key] !== 'boolean') throw new Error(`AUTO_CONTROL.${key} 必须是布尔值`)
  }
  for (const key of ['targetTemp', 'tempDiffCloseThreshold', 'tempDiffOpenThreshold']) {
    if (!Number.isFinite(auto[key])) throw new Error(`AUTO_CONTROL.${key} 必须是数字`)
  }
  if (!['simple', 'layered'].includes(config.CONTROL_MODE)) throw new Error('CONTROL_MODE 只能是 simple 或 layered')
  const layered = config.LAYERED_CONTROL
  if (!layered || typeof layered !== 'object' || Array.isArray(layered)) throw new Error('LAYERED_CONTROL 必须是 JSON 对象')
  for (const key of ['enabled', 'tempSingle', 'flowSingle', 'pressureSingle', 'dualTemp', 'tempFlow', 'pressureFlow', 'tempPressure']) {
    if (typeof layered[key] !== 'boolean') throw new Error(`LAYERED_CONTROL.${key} 必须是布尔值`)
  }
  for (const key of ['tempHysteresis', 'dualTempDiffThreshold']) {
    if (!Number.isFinite(layered[key]) || layered[key] < 0) throw new Error(`LAYERED_CONTROL.${key} 必须是大于等于 0 的数字`)
  }
  const qty = config.QUANTITY_SHUTDOWN
  if (!qty || typeof qty !== 'object' || Array.isArray(qty)) throw new Error('QUANTITY_SHUTDOWN 必须是 JSON 对象')
  if (typeof qty.enabled !== 'boolean') throw new Error('QUANTITY_SHUTDOWN.enabled 必须是布尔值')
  if (!Number.isFinite(qty.totalFlowTarget) || qty.totalFlowTarget < 0) throw new Error('QUANTITY_SHUTDOWN.totalFlowTarget 必须是大于等于 0 的数字')
  const fault = config.FAULT_STATUS
  if (!fault || typeof fault !== 'object' || Array.isArray(fault)) throw new Error('FAULT_STATUS 必须是 JSON 对象')
  for (const key of ['enabled', 'pipeBlockage', 'outletBlockage', 'dryBurn', 'pumpIdle', 'pumpFault']) {
    if (typeof fault[key] !== 'boolean') throw new Error(`FAULT_STATUS.${key} 必须是布尔值`)
  }
  if (!Number.isFinite(fault.dryBurnDurationMs) || fault.dryBurnDurationMs < 0) throw new Error('FAULT_STATUS.dryBurnDurationMs 必须是大于等于 0 的数字')
  if (!Number.isFinite(fault.dryBurnMinRiseC) || fault.dryBurnMinRiseC < 0) throw new Error('FAULT_STATUS.dryBurnMinRiseC 必须是大于等于 0 的数字')
  if (!Number.isFinite(fault.alarmCooldownMs) || fault.alarmCooldownMs < 0) throw new Error('FAULT_STATUS.alarmCooldownMs 必须是大于等于 0 的数字')
  if (!Number.isFinite(fault.tempDiffThreshold) || fault.tempDiffThreshold < 0) throw new Error('FAULT_STATUS.tempDiffThreshold 必须是大于等于 0 的数字')
  const pid = config.PID_HEATING
  if (!pid || typeof pid !== 'object' || Array.isArray(pid)) throw new Error('PID_HEATING 必须是 JSON 对象')
  if (typeof pid.enabled !== 'boolean') throw new Error('PID_HEATING.enabled 必须是布尔值')
  for (const key of ['kp', 'ki', 'kd', 'targetTemp']) {
    if (!Number.isFinite(pid[key])) throw new Error(`PID_HEATING.${key} 必须是数字`)
  }
  if (!Number.isFinite(pid.windowMs) || pid.windowMs <= 0) throw new Error('PID_HEATING.windowMs 必须是大于 0 的数字')
  const autoTune = config.PID_AUTOTUNE
  if (!autoTune || typeof autoTune !== 'object' || Array.isArray(autoTune)) throw new Error('PID_AUTOTUNE 必须是 JSON 对象')
  if (typeof autoTune.enabled !== 'boolean') throw new Error('PID_AUTOTUNE.enabled 必须是布尔值')
  for (const key of ['relayHighDuty', 'relayLowDuty', 'hysteresis']) {
    if (!Number.isFinite(autoTune[key])) throw new Error(`PID_AUTOTUNE.${key} 必须是数字`)
  }
  if (!Number.isInteger(autoTune.minCycles) || autoTune.minCycles < 2) throw new Error('PID_AUTOTUNE.minCycles 必须是大于等于 2 的整数')
  if (!Number.isFinite(autoTune.timeoutMs) || autoTune.timeoutMs <= 0) throw new Error('PID_AUTOTUNE.timeoutMs 必须是大于 0 的数字')
  if (!['idle', 'running', 'done', 'failed'].includes(autoTune.status)) throw new Error('PID_AUTOTUNE.status 取值非法')
  if (!Number.isFinite(autoTune.progress) || autoTune.progress < 0) throw new Error('PID_AUTOTUNE.progress 必须是大于等于 0 的数字')
  if (autoTune.result !== null && (typeof autoTune.result !== 'object' || Array.isArray(autoTune.result))) {
    throw new Error('PID_AUTOTUNE.result 必须是 null 或 JSON 对象')
  }
  const computed = config.COMPUTED_METRICS
  if (!computed || typeof computed !== 'object' || Array.isArray(computed)) throw new Error('COMPUTED_METRICS 必须是 JSON 对象')
  for (const key of ['enabled', 'resistanceK', 'pressureDropRate', 'tempChangeRate', 'heatExchangeEfficiency', 'eerHeatBalance', 'flowPressureCurve', 'cumulativeFlow', 'averageVelocity', 'waterLevel', 'averageTempChart', 'averageVelocityChart']) {
    if (typeof computed[key] !== 'boolean') throw new Error(`COMPUTED_METRICS.${key} 必须是布尔值`)
  }
  for (const key of ['heaterRatedPower', 'pipeAreaCm2', 'initialWaterTank1', 'initialWaterTank2', 'tankAreaCm2']) {
    if (!Number.isFinite(computed[key]) || computed[key] < 0) throw new Error(`COMPUTED_METRICS.${key} 必须是大于等于 0 的数字`)
  }
  const historyCharts = config.HISTORY_CHARTS
  if (!historyCharts || typeof historyCharts !== 'object' || Array.isArray(historyCharts)) throw new Error('HISTORY_CHARTS 必须是 JSON 对象')
  for (const key of ['showCumulative', 'showTimeWindow', 'showAverageChart', 'showTempChart', 'showFlowPressureChart', 'showPidTrackingChart', 'showDeviceStateChart', 'showDerivedMetricCharts']) {
    if (typeof historyCharts[key] !== 'boolean') throw new Error(`HISTORY_CHARTS.${key} 必须是布尔值`)
  }
  if (!Number.isInteger(historyCharts.pointLimit) || historyCharts.pointLimit < 10 || historyCharts.pointLimit > 2000) {
    throw new Error('HISTORY_CHARTS.pointLimit 必须是 10~2000 之间的整数')
  }
  const switchDurationDisplay = config.SWITCH_DURATION_DISPLAY
  if (!switchDurationDisplay || typeof switchDurationDisplay !== 'object' || Array.isArray(switchDurationDisplay)) {
    throw new Error('SWITCH_DURATION_DISPLAY 必须是 JSON 对象')
  }
  if (typeof switchDurationDisplay.enabled !== 'boolean') throw new Error('SWITCH_DURATION_DISPLAY.enabled 必须是布尔值')
  validateAggregationMetrics(config)
  return true
}

/** 使用“临时文件 + 原子重命名”持久化，避免直接写正式文件留下半截 JSON。 */
function persist(config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  const temp = `${CONFIG_FILE}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}
`, 'utf8')
  fs.renameSync(temp, CONFIG_FILE)
}

/** 启动时加载持久化配置；文件不存在或损坏时安全降级到默认配置。 */
function load() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return clone(defaultConfig)
    const loaded = mergeKnown(defaultConfig, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')))
    validate(loaded)
    return loaded
  } catch (error) {
    console.error('[SystemConfig] 配置文件无效，使用默认配置:', error.message)
    return clone(defaultConfig)
  }
}

let currentConfig = load()
process.env.SINGLE_DEVICE_MODE = String(currentConfig.SINGLE_DEVICE_MODE)

function getConfig() {
  // 始终返回深拷贝，防止调用方绕过校验直接修改内存配置。
  return clone(currentConfig)
}

/** 完整替换当前内存配置，并通知 MQTT 等消费者执行必要的热更新。 */
function replaceConfig(next) {
  validate(next)
  persist(next)
  currentConfig = next
  process.env.SINGLE_DEVICE_MODE = String(currentConfig.SINGLE_DEVICE_MODE)
  events.emit('changed', getConfig())
  return getConfig()
}

/** 部分更新：只改变传入字段；未知顶层字段会报错，防止现场拼写错误静默失效。 */
function updateConfig(partial) {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) throw new Error('配置必须是 JSON 对象')
  assertCompatibleShape(defaultConfig, partial)
  return replaceConfig(mergeKnown(currentConfig, partial))
}

/** 恢复本文件中的 defaultConfig；该操作同样会覆盖持久化文件。 */
function resetConfig() {
  return replaceConfig(clone(defaultConfig))
}

/** 导出场景配置外壳；数据库 metadata 由 configController 追加。 */
function exportConfig() {
  return { schema: 'lot-scene', version: CONFIG_VERSION, exportTime: new Date().toISOString(), config: getConfig() }
}

/** 导入新版完整场景包或旧版纯配置对象；缺失字段使用默认值补齐。 */
function importConfig(scene) {
  const source = scene?.config || scene
  if (!source || typeof source !== 'object') throw new Error('场景配置格式无效')
  const ignored = new Set(['exportTime', 'schema', 'version', 'metadata'])
  const unknown = Object.keys(source).filter(key => !(key in defaultConfig) && !ignored.has(key))
  if (unknown.length) throw new Error(`场景包含未知配置项: ${unknown.join(', ')}`)
  const configOnly = Object.fromEntries(Object.entries(source).filter(([key]) => key in defaultConfig))
  assertCompatibleShape(defaultConfig, configOnly)
  return replaceConfig(mergeKnown(defaultConfig, source))
}

module.exports = {
  CONFIG_FILE,
  defaultConfig,
  getConfig,
  updateConfig,
  resetConfig,
  exportConfig,
  importConfig,
  onChange: (listener) => events.on('changed', listener),
}
