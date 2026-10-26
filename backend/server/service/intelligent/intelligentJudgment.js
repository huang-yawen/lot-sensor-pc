/**
 * 【一句话版】这个文件负责「把数据交给判定服务，再存结果、按结果做动作」。
 *
 * 具体干三件事：
 *   1. 把数据发给「智能判定服务」（一个会判断"数据正不正常"的外部 HTTP 接口）
 *   2. 把它回的结果（正常 / 异常 / 干烧…）存进数据库 t_judgment_record
 *   3. 如果结论命中关键词（如"干烧 / 漏水"），交给 service/judgmentAction 去关泵关加热
 *
 * ═════════════════════════════════════════════════════════════════════
 * 【三条触发链路】差别只在"谁、什么时候发起判定"，判定本身完全一样：
 *
 *   手动 runManualJudgment   —— 你在汇总页勾几条，点「智能判定」按钮，判一次
 *   自动 runAutoOnce         —— 后端自己每隔几秒取最新几条去判，不用你管
 *   实时 runRealtimeJudgment —— 每条 MQTT 消息一到就立刻判一次，最快
 *
 *   三条链路最后都汇到同一个 judgeAndSave()：
 *      judgeAndSave ── callService  把数据发给判定服务（组装 { [requestField]: records }）
 *                  ├─ summarize    从响应里按点路径挑出 结论 / 置信度
 *                  └─ saveRecord   存一条记录（成功、占位、失败都存）
 *
 *   三条链路各自读哪张表、发给服务什么字段（★ 合并显示 / 分开显示的关键差异）：
 *     type='sensor'    → t_sensor_data（真表，与合并表同时写入）     → 只有传感器，字段是裸槽位名 field1~field10
 *     type='behavior'  → t_behavior_data（真表，同上）               → 只有行为，字段是裸槽位名 field1~field10
 *     type='combined'  → t_scene_data 整行（传感器+行为在同一行）     → 两侧都有，字段还原成设备上报语义名
 *                         还原逻辑见同目录 combinedJudgment.js（temp_in / pump / heater / mode …）
 *     自动判定 runAutoOnce 目前**写死**走 t_sensor_data + type='sensor'；
 *     实时判定目前只映射传感器侧，且调用点被注释（见文件底部与 combinedRealtimeHandler.js）。
 *     要让这两条也带行为数据 → 见项目根目录 JUDGMENT_GUIDE.md 第 9.1 节。
 *
 * ═════════════════════════════════════════════════════════════════════
 * 【发给判定服务的报文长什么样】（config.js 的 requestField = 'data'）
 *   组合判定（带行为）：
 *     { "data": [ { "d_no":"202606", "c_time":"2005-01-01 00:14:47",
 *                   "temp_in":"24.6", "temp_out":"25.9", "flow":"0", "pressure":"1.4",
 *                   "mode":"0", "heater":"0", "pump":"0" } ] }
 *   传感器判定 / 自动判定（只有传感器，且是数据库整行）：
 *     { "data": [ { "id":113331, "d_no":"202606", "field1":"37.7", "field2":"38.1", "field3":"0",
 *                   "field4":"1.3", "field5":null, …, "c_time":"2026-09-18 17:34:01",
 *                   "online":"保存数据" } ] }
 *
 * ═════════════════════════════════════════════════════════════════════
 * 【结果存哪】都存 t_judgment_record，用 status + data_type 两个字段区分：
 *   status：  手动 success / mock  自动 auto / auto_mock  实时 realtime / realtime_mock  失败 failed
 *   data_type：sensor / behavior / combined
 *   排查时最有用的是 request_body（真正发出去的请求体）和 response_body（服务原样返回）。
 *
 * ═════════════════════════════════════════════════════════════════════
 * 【文件里各部分在哪】
 *   第 1 部分  判定记录表：ensureTable（建表）+ saveRecord（存一条记录）
 *   第 2 部分  调服务与解析：readPath / toConfidence / mockResult / callService / summarize
 *   第 3 部分  手动判定：TYPE_TABLES + MANUAL_STATUS + runManualJudgment
 *   第 4 部分  自动判定：AUTO_STATUS + startAutoJudgment（定时器）+ runAutoOnce（★取样 SQL 在这里）
 *   第 5 部分  实时判定：REALTIME_STATUS + runRealtimeJudgment + triggerJudgmentAction（判定联动）
 *   文件末尾    对外导出的函数清单（谁在调一目了然）
 *
 * ═════════════════════════════════════════════════════════════════════
 * 【赛场要改什么 → 去哪改】（参数都在 config.js，改完重启后端）：
 *   判定服务地址 / 超时 / 请求体字段名 / 响应字段路径 → config.js 的 INTELLIGENT_JUDGMENT
 *   自动判定开不开、多久判一次、每次取几条            → config.js 的 AUTO_JUDGMENT
 *   实时判定开不开（每条消息判一次）                  → config.js 的 REALTIME_JUDGMENT
 *   自动判定改成判"行为"或"行为+传感器"（默认只判传感器）→ 第 4 部分 runAutoOnce 里的 SQL 与 type
 *   没接服务时本地"瞎猜"的异常标准                    → 第 2 部分 mockResult 里的 > 10000
 *   服务要 GET / 表单 / 响应不是 JSON 而是纯文本       → 第 2 部分 callService / summarize
 *
 * 【排查入口】
 *   日志：`[Judgment] 判定失败:`（每次失败都打）、`[AutoJudgment] …`（自动判定节奏与跳过）
 *   数据库：SELECT id, data_type, status, conclusion, request_body, response_body
 *           FROM t_judgment_record ORDER BY id DESC LIMIT 5;
 *   接口：POST /api/intelligent/judge（手动）、GET /api/intelligent/records（记录）、
 *         GET /api/intelligent/auto-recent（自动判定内存缓冲）
 *
 * 【术语小抄】
 *   mock / 占位判定：没接真实服务时，程序在本地瞎猜一个"正常 / 数据异常"，用来跑通流程
 *   field1~field10：数据库里测量值的槽位列。传感器表：field1=进水温度、field2=出水温度、
 *                   field3=瞬时流量、field4=瞬时压力；行为表：field1=水泵、field2=加热、
 *                   field3=控制模式、field4=PID恒温（具体以 t_*_field_mapper 配置为准）
 *   t_scene_data：合并表，一条上报消息一行；field1~10 传感器、field11~20 行为
 *   status / data_type：这条判定记录是哪条链路、判的哪类数据、成功还是失败
 */

const { EventEmitter } = require('events')
const promisePool = require('../../config/dbPool')
const { getDeviceNo } = require('../../utils/protocol')
const { nowLocalDateTime } = require('../../utils/helper')
const { INTELLIGENT_JUDGMENT, AUTO_JUDGMENT } = require('./config')
const { toCombinedPayloadRecords } = require('./combinedJudgment')


// #####################################################################
// 第 1 部分：判定记录表（建表 + 存一条记录）
// #####################################################################

/** 建表。表已经存在时这句什么都不做，所以每次存记录前调一下也没关系。 */
async function ensureTable() {
  await promisePool.query(`CREATE TABLE IF NOT EXISTS t_judgment_record (
    id BIGINT NOT NULL AUTO_INCREMENT,
    d_no VARCHAR(64) NULL,
    data_type VARCHAR(32) NOT NULL,
    source_ids VARCHAR(1000) NULL,
    request_body LONGTEXT NULL,
    response_body LONGTEXT NULL,
    conclusion VARCHAR(255) NULL,
    confidence DECIMAL(8,4) NULL,
    status VARCHAR(32) NOT NULL,
    error_message VARCHAR(1000) NULL,
    c_time DATETIME NOT NULL,
    PRIMARY KEY (id), KEY idx_judgment_time (c_time), KEY idx_judgment_device (d_no)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8`)
}

/**
 * 往 t_judgment_record 存一条判定记录。成功 / 占位 / 失败三种情况都走这里。
 *
 * 各字段怎么填：
 *   d_no         本批第一条记录的设备号（由 utils/protocol.js 的 getDeviceNo 从 DEVICE_ID_FIELDS
 *                候选字段里取；合并判定的记录带 d_no，传感器判定带 id 字段——它是行主键不是设备号，
 *                所以能对上的靠 d_no）
 *   data_type    传入的 type：'sensor' / 'behavior' / 'combined'
 *   source_ids   判了哪几条的 id，逗号拼接；**实时判定传 null**（那一刻消息还没入库、没有自增 id）。
 *                字段是 varchar(1000)，一次最多 100 个 id（recognize.js 的 MAX_IDS）≈700 字符，
 *                所以别把 MAX_IDS 调太大。
 *   request_body 真正发出去的请求体（占位判定时存本地记录）；response_body 服务原样返回。
 *                这两个字段是排查"判定服务到底收到了什么"的关键。
 *   status       见文件头 status 对照表；失败时 error_message 存原因（截断到 1000 字）。
 *
 * 每次写之前都会 ensureTable()：表不存在就建（CREATE TABLE IF NOT EXISTS，已存在时无副作用）。
 */
async function saveRecord({ type, ids, records, requestBody, responseBody, conclusion, confidence, status, error }) {
  await ensureTable()
  await promisePool.execute(
    `INSERT INTO t_judgment_record
      (d_no, data_type, source_ids, request_body, response_body, conclusion, confidence, status, error_message, c_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      getDeviceNo(records[0] || {}),          // 设备编号，取第一条记录的
      type,                                   // 'sensor' 或 'behavior'
      Array.isArray(ids) && ids.length ? ids.join(',') : null,  // 判了哪几条；消息实时判定还没入库、没有自增 id 时存 null
      JSON.stringify(requestBody ?? records), // 发出去的请求体
      JSON.stringify(responseBody ?? null),   // 判定服务回的原始内容
      conclusion,
      confidence,
      status,
      error?.slice(0, 1000) || null,          // 失败原因，最多存 1000 个字
    ]
  )
}


// #####################################################################
// 第 2 部分：发请求给判定服务，从响应里取结论
// #####################################################################

/** 按点号取嵌套字段，比如 readPath({ a: { b: 1 } }, 'a.b') 得到 1。path 为空直接返回原值。 */
function readPath(value, path) {
  if (!path) return value
  let current = value
  for (const key of String(path).split('.').filter(Boolean)) {
    if (current === null || current === undefined) return undefined
    current = current[key]
  }
  return current
}

/** 置信度转数字：取不到、空串、转不成数字都存 null。
 *  不能写成 `Number(x) || null`——置信度是 0 时会被当成"没有"，但 0 是合法值。 */
function toConfidence(value) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/**
 * 【本地占位判定】没接真实 AI 服务时的"兜底"：程序在本地自己猜一个结果。
 * 猜法：每条记录里，只要有一个测量值的绝对值超过 10000，就判"数据异常"。
 * 想改猜法就改下面函数里的 `> 10000`（比如改成 > 5000，或只看 temp_in 这一个字段）。
 * 跳过的是系统字段（id / 设备号 / 时间 / 在线标记 / 合并表的两侧标记）：
 *   旧版这里用 `/^field\d+$/` 只认裸槽位名，但组合判定的记录是按映射表 p_name
 *   还原过的语义名（temp_in / pump ...），那样会一个字段都匹配不到、永远判"正常"，
 *   所以改成"排除系统字段"的黑名单写法，两种记录的测量字段都能覆盖。
 */
const MOCK_SKIP_KEYS = new Set(['id', 'd_no', 'c_time', 'online', 'has_sensor', 'has_behavior', 'trace_id'])

function mockResult(records) {
  return records.map(record => {
    let abnormal = false
    for (const [key, value] of Object.entries(record)) {
      if (MOCK_SKIP_KEYS.has(String(key).toLowerCase())) continue
      const num = Number(value)
      if (Number.isFinite(num) && Math.abs(num) > 10000) abnormal = true  // 👈 要改阈值就改这里 > 10000
    }
    return { id: record.id, result: abnormal ? '数据异常' : '正常', confidence: abnormal ? 0.9 : 0.8 }
  })
}

/**
 * 把记录发给判定服务，拿回响应。请求体字段名由 config.requestField 决定，超时由 config.timeoutMs。
 * 现场接口形态不同时改这个函数（改一次，手动/自动/实时三种模式同时生效）：
 *   · 要 GET：把 fetch 改成 `fetch(config.url + '?' + config.requestField + '=' + encodeURIComponent(JSON.stringify(records)), { method:'GET', signal })`
 *   · 要表单：headers 换 `application/x-www-form-urlencoded`，body 换 `new URLSearchParams({ [config.requestField]: JSON.stringify(records) })`
 *   · 响应是纯文本：直接 `return { mock:false, body, data: rawText }`，summarize 会把整句话当结论
 *   · 想硬编码结果测试：把整个 fetch 注释掉，直接 `return { mock:false, body, data:{...} }`
 */
async function callService(records, config) {
  // 判定服务没启用：不发请求，用本地占位判定（或者直接报错）
  if (!config.enabled) {
    if (!config.mockWhenDisabled) throw new Error('智能判定服务尚未启用')
    return { mock: true, results: mockResult(records) }
  }

  // 请求体：{ data: [记录1, 记录2, ...] }
  const body = { [config.requestField]: records }

  // 超过 timeoutMs 还没回来就主动断开，fetch 会抛 AbortError
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  let response
  let rawText
  try {
    response = await fetch(config.url, {
      method: config.method,
      headers: config.headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    rawText = await response.text()
  } finally {
    clearTimeout(timer)
  }

  // 服务报错（比如 404、500）：把服务回的前 300 个字带上，方便看出是哪里错了
  if (!response.ok) throw new Error(`判定服务返回 HTTP ${response.status}: ${rawText.slice(0, 300)}`)

  try {
    return { mock: false, body, data: rawText ? JSON.parse(rawText) : null }
  } catch {
    throw new Error(`判定服务响应不是合法 JSON: ${rawText.slice(0, 300)}`)
  }
}

/**
 * 从判定服务响应里取出「结果列表、结论、置信度」。
 * 取哪几个字段完全由 config.js 的 INTELLIGENT_JUDGMENT 决定：
 *   resultPath      —— 结果数组的点路径（空串 = 整个响应就是数组）
 *   conclusionPath  —— 单条结果里结论字段的点路径（空串 = 整条结果就是一句文字）
 *   confidencePath  —— 单条结果里置信度字段的点路径（空串 = 没有置信度）
 * 结论只看结果数组的第一条（这批记录共用一个结论）。
 */
function summarize(responseData, config) {
  const results = readPath(responseData, config.resultPath) ?? responseData
  const first = Array.isArray(results) ? results[0] : results   // 结论只看第一条
  return {
    results,
    conclusion: readPath(first, config.conclusionPath) ?? (typeof first === 'string' ? first : null),
    confidence: toConfidence(readPath(first, config.confidencePath)),
  }
}

/** 解析本地占位判定的结果。占位结果固定是 [{ id, result, confidence }] 这种格式，取第一条的 result 当结论、confidence 当置信度。 */
function summarizeMock(results) {
  return { results, conclusion: results[0]?.result ?? null, confidence: results[0]?.confidence ?? null }
}

/**
 * 判定 + 存库，手动、自动、消息实时三种模式都调它。
 * @param {Object} params
 * @param {'sensor'|'behavior'} params.type   数据类型
 * @param {Array<Object>} params.records      要判定的记录
 * @param {{ok:string, mock:string}} params.statusPair  存库用的 status，手动/自动/实时各一套
 * @param {Array<number>|null} [params.ids]   记录对应的库自增 id；消息实时判定还没入库，传 null
 * @returns {Promise<{results, conclusion, confidence, mock}>}  失败时会抛错
 */
async function judgeAndSave({ type, records, statusPair, ids }) {
  const config = INTELLIGENT_JUDGMENT
  // 消息实时判定传 ids=null（消息还没入库、没有自增 id）；手动/自动不传则回退到 records 的 id。
  const effectiveIds = ids === undefined ? records.map(record => record.id) : ids
  try {
    const service = await callService(records, config)
    const summary = service.mock ? summarizeMock(service.results) : summarize(service.data, config)
    await saveRecord({
      type, ids: effectiveIds, records,
      requestBody: service.mock ? records : service.body,
      responseBody: service.mock ? service.results : service.data,
      ...summary,
      status: service.mock ? statusPair.mock : statusPair.ok,
    })
    return { ...summary, mock: service.mock }
  } catch (error) {
    // 失败也存一条记录，再把错误继续往上抛
    try {
      await saveRecord({ type, ids: effectiveIds, records, status: 'failed', error: error.message })
    } catch (saveError) {
      console.error('[Judgment] 失败记录保存失败:', saveError.message)
    }
    throw error
  }
}


// #####################################################################
// 第 3 部分：手动判定（用户在历史页勾选几条，点"智能判定"按钮）
// #####################################################################

/** 前端传的 type → 去哪张表查记录。控制器也拿它校验 type 合不合法。
 *  combined = 合并版的组合判定：t_scene_data 一行就是"一条消息"（传感器 + 行为）。 */
const TYPE_TABLES = { sensor: 't_sensor_data', behavior: 't_behavior_data', combined: 't_scene_data' }

/** 手动判定存库用的 status。 */
const MANUAL_STATUS = { ok: 'success', mock: 'mock' }

/**
 * 按勾选的 id 查出记录，然后判定。
 * 出错时 error.code 告诉控制器该回哪个 HTTP 状态码：
 *   'NOT_FOUND'   一条都没查到        → 404
 *   'TIMEOUT'     判定服务超时         → 504
 *   'BAD_GATEWAY' 判定服务报错/格式不对 → 502
 */
async function runManualJudgment({ type, ids }) {
  // 1. 按 id 查记录
  const table = TYPE_TABLES[type]
  const placeholders = ids.map(() => '?').join(',')   // 3 个 id → "?,?,?"
  const [records] = await promisePool.query(`SELECT * FROM ${table} WHERE id IN (${placeholders}) ORDER BY id`, ids)
  if (records.length === 0) {
    const error = new Error('未找到待判定数据')
    error.code = 'NOT_FOUND'
    throw error
  }

  // 2. 组合判定：库里一行就是"一条消息"，但判定服务要的是设备上报时的语义字段名，
  //    所以先按两张映射表的 p_name 把槽位还原（temp_in / pump ...），再统一走 judgeAndSave。
  //    ids 显式传进去：还原后的记录里故意不带 id（见 combinedJudgment.js 头部说明），
  //    不传的话 judgeAndSave 会取 records.map(r => r.id) 得到一堆 undefined。
  const payloadRecords = type === 'combined' ? await toCombinedPayloadRecords(records) : records

  // 3. 判定 + 存库；出错时给错误贴上 code
  try {
    return await judgeAndSave({ type, records: payloadRecords, statusPair: MANUAL_STATUS, ids })
  } catch (error) {
    const timeout = error.name === 'AbortError'
    const wrapped = new Error(timeout ? '智能判定服务请求超时' : error.message)
    wrapped.code = timeout ? 'TIMEOUT' : 'BAD_GATEWAY'
    throw wrapped
  }
}


// #####################################################################
// 第 4 部分：自动判定（后端每隔几秒自己取最新几条去判）
// #####################################################################

/** 自动判定存库用的 status。 */
const AUTO_STATUS = { ok: 'auto', mock: 'auto_mock' }

/** 每判完一轮就 emit 'auto_judgment'，app.js 转成 WebSocket 推给"自动判定"页。 */
const events = new EventEmitter()
/** 最近几轮的结果放内存里，"自动判定"页刚打开时用它补齐图表。 */
const recentResults = []

let autoTimer = null     // 定时器
let autoRunning = false  // 上一轮是不是还没判完

/** 把 config 里的数字规整一下：不是数字就用默认值，太大太小就夹到范围内。 */
function getIntervalMs() {
  const n = Number(AUTO_JUDGMENT.intervalMs)
  if (!Number.isFinite(n)) return 5000
  return Math.max(1000, Math.trunc(n))                   // 最快 1 秒一次
}
function getRecentCount() {
  const n = Number(AUTO_JUDGMENT.recentCount)
  if (!Number.isFinite(n)) return 5
  return Math.min(100, Math.max(1, Math.trunc(n)))       // 1~100 条
}
function getBufferSize() {
  const n = Number(AUTO_JUDGMENT.bufferSize)
  if (!Number.isFinite(n)) return 50
  return Math.min(500, Math.max(1, Math.trunc(n)))       // 1~500 条
}

/** 存一轮结果到内存（超出上限就丢掉最旧的），并通知 app.js 推给前端。 */
function pushResult(entry) {
  recentResults.push(entry)
  while (recentResults.length > getBufferSize()) recentResults.shift()
  events.emit('auto_judgment', entry)
  return entry
}

/**
 * 自动判定跑一轮：取最新几条**传感器数据** → 判定 → 结果推给前端。
 *
 * ★ 取样 SQL 就在下面这一句，是"自动判定只判传感器"的唯一原因，改判定数据源就改这里：
 *   · 只判传感器（现状）：'SELECT * FROM t_sensor_data ORDER BY c_time DESC, id DESC LIMIT ?'
 *                         + 下面 judgeAndSave({ type: 'sensor' })
 *   · 改成只判行为     ：表名换 t_behavior_data、type 换 'behavior'、字段含义以行为映射表为准
 *   · 改成"行为+传感器" ：表名换 t_scene_data，条件加 has_sensor = 1 AND has_behavior = 1，
 *                         再用 toCombinedPayloadRecords() 还原字段名、type 用 'combined'，
 *                         并**显式把 ids 传给 judgeAndSave**（还原后的记录故意不带 id）。
 *                         完整示例见项目根目录 JUDGMENT_GUIDE.md 第 9.1 节。
 *
 * ⚠ 两个已知影响：
 *   1) 这里按 c_time DESC 取"最新"，设备时钟不准（例如上报 2005 年）时会取到旧数据；
 *      设备 RTC 校准，或把 config/protocol.js 的 TIME_FIELDS 里的 Time 去掉改用服务器时间。
 *   2) 查出来是"新 → 旧"，所以要 reverse 成"旧 → 新"再提交（判定服务按时间顺序看更直观）。
 */
async function runAutoOnce() {
  // 1. 取最新 N 条传感器数据（要判行为数据就把表名改成 t_behavior_data，下面 type 也改成 'behavior'）
  const [rows] = await promisePool.query(
    'SELECT * FROM t_sensor_data ORDER BY c_time DESC, id DESC LIMIT ?',
    [getRecentCount()]
  )
  if (rows.length === 0) return null

  const records = [...rows].reverse()      // 查出来是新→旧，翻成旧→新再提交
  const ids = records.map(record => record.id)
  const time = nowLocalDateTime()

  // 2. 判定；失败也推一条 failed 给前端，定时器照常跑下一轮
  try {
    const result = await judgeAndSave({ type: 'sensor', records, statusPair: AUTO_STATUS })
    triggerJudgmentAction(result, records[0])   // 智能判定联动（干烧→关加热等），不阻塞结果推送
    return pushResult({
      time,
      ids,
      conclusion: result.conclusion,
      confidence: result.confidence,
      results: result.results,
      status: result.mock ? AUTO_STATUS.mock : AUTO_STATUS.ok,
      error: null,
    })
  } catch (error) {
    console.error('[AutoJudgment] 本轮判定失败:', error.message)
    return pushResult({
      time,
      ids,
      conclusion: null,
      confidence: null,
      results: null,
      status: 'failed',
      error: error.message,
    })
  }
}

/** 启动自动判定定时器。app.js 启动时调一次。 */
function startAutoJudgment() {
  if (autoTimer) return
  if (!AUTO_JUDGMENT.enabled) {
    console.log('[AutoJudgment] 自动判定未启用（service/intelligent/config.js 的 AUTO_JUDGMENT.enabled=false）')
    return
  }
  const intervalMs = getIntervalMs()
  autoTimer = setInterval(async () => {
    // 上一轮还没判完就跳过这一轮，免得请求越堆越多
    if (autoRunning) {
      console.warn(`[AutoJudgment] 上一轮还没判完，跳过这一轮（现场服务响应比 ${intervalMs}ms 慢，可以把 intervalMs 调大）`)
      return
    }
    autoRunning = true
    try {
      await runAutoOnce()
    } catch (err) {
      console.error('[AutoJudgment] 自动判定取数失败:', err.message)
    } finally {
      autoRunning = false
    }
  }, intervalMs)
  autoTimer.unref?.()
  console.log(`[AutoJudgment] 自动判定已启动：每 ${intervalMs}ms 提交最新 ${getRecentCount()} 条传感器数据`)
}

// #####################################################################
// 第 5 部分：消息实时判定（每条 MQTT 消息到达即判一次，fire-and-forget）
// #####################################################################

/** 消息即触发判定（方式③）存库用的 status。 */
const REALTIME_STATUS = { ok: 'realtime', mock: 'realtime_mock' }

/**
 * 消息即触发判定（方式③）：对单条已映射成 field1..field4 的传感器记录做一次判定并落库，
 * 然后 emit 'realtime_judgment' 事件（app.js 转 WebSocket 推给前端）。由
 * mqtt/combinedRealtime/combinedRealtimeHandler.js 在每条消息到达时异步调用（fire-and-forget）。
 * 复用 judgeAndSave 这条手动/自动共用的链路：判定服务地址/格式/mock 都走同一份 config。
 */
async function runRealtimeJudgment({ type, record }) {
  const records = [record]
  const time = nowLocalDateTime()
  try {
    const result = await judgeAndSave({ type, records, statusPair: REALTIME_STATUS, ids: null })
    triggerJudgmentAction(result, record)       // 智能判定联动（干烧→关加热等），不阻塞结果推送
    return emitRealtimeResult({
      time,
      conclusion: result.conclusion,
      confidence: result.confidence,
      results: result.results,
      status: result.mock ? REALTIME_STATUS.mock : REALTIME_STATUS.ok,
      error: null,
    })
  } catch (error) {
    console.error('[RealtimeJudgment] 本轮判定失败:', error.message)
    return emitRealtimeResult({ time, conclusion: null, confidence: null, results: null, status: 'failed', error: error.message })
  }
}

/** 把一条消息实时判定结果广播出去（不缓存内存，只推给前端展示用）。 */
function emitRealtimeResult(entry) {
  events.emit('realtime_judgment', entry)
  return entry
}

/**
 * 智能判定联动（配合 service/judgmentAction/）：判定出结论后，如果结论里包含
 * "干烧/漏水"等关键词，就按 judgmentAction/config.js 里配的动作关泵/关加热。
 * 只在自动判定、消息实时判定两种模式下调用；手动判定只是追溯历史，不触发联动。
 * mock 占位判定（没接真实判定服务）的结论是本地算的，不算数，也不触发。
 * fire-and-forget：不 await，联动在后台跑，不阻塞判定结果推送给前端。
 */
function triggerJudgmentAction(result, record) {
  if (!result || result.mock) return
  const { evaluateJudgmentAction } = require('../judgmentAction/judgmentAction')
  evaluateJudgmentAction(result.conclusion, record).catch((err) => {
    console.error('[IntelligentJudgment] 智能判定联动失败:', err.message)
  })
}


// #####################################################################
// 对外提供的函数（谁在调用一目了然）
// #####################################################################
//   ensureTable             controllers/intelligent/records.js 查记录前建表
//   TYPE_TABLES             controllers/intelligent/recognize.js 校验 type（sensor/behavior/combined）
//   runManualJudgment       controllers/intelligent/recognize.js 手动判定（页面点按钮）
//   startAutoJudgment       app.js 启动时拉起自动判定定时器
//   onAutoJudgment          app.js 监听每轮结果 → WebSocket 'auto_judgment' → 自动判定页
//   getAutoJudgmentRecent   routes/sensorRoutes.js 的 GET /api/intelligent/auto-recent（补历史）
//   runRealtimeJudgment     mqtt/combinedRealtime/combinedRealtimeHandler.js 消息即触发判定
//   onRealtimeJudgment      app.js 监听 → WebSocket 'realtime_judgment'（当前前端无页面订阅）
module.exports = {
  ensureTable,                                                     // controllers/intelligent/records.js 查记录前建表
  TYPE_TABLES,                                                     // controllers/intelligent/recognize.js 校验 type
  runManualJudgment,                                               // controllers/intelligent/recognize.js 手动判定
  startAutoJudgment,                                               // app.js 启动自动判定
  onAutoJudgment: (listener) => events.on('auto_judgment', listener), // app.js 监听每轮结果，推给前端
  getAutoJudgmentRecent: () => [...recentResults],                 // routes/sensorRoutes.js 的 /api/intelligent/auto-recent
  runRealtimeJudgment,                                             // combinedRealtimeHandler.js 消息即触发判定
  onRealtimeJudgment: (listener) => events.on('realtime_judgment', listener), // app.js 监听，推给前端
}
