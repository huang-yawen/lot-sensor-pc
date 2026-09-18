/**
 * 【一句话版】这个文件负责「把数据交给 AI 判定，再存结果、按结果做动作」。
 *
 * 具体干三件事：
 *   1. 把数据发给「智能判定服务」（一个会判断"数据正不正常"的外部接口）
 *   2. 把 AI 回的结果（正常 / 异常）存进数据库 t_judgment_record
 *   3. 如果 AI 说"干烧 / 漏水"了，交给 service/judgmentAction 去关泵关加热
 *
 * ═════════════════════════════════════════════════════════════════════
 * 【三种触发方式】差别只在"谁、什么时候发起判定"，判定本身完全一样：
 *
 *   手动 runManualJudgment   —— 你在历史页勾几条，点"智能判定"按钮，判一次
 *   自动 runAutoOnce         —— 后端自己每隔几秒取最新几条去判，不用你管
 *   实时 runRealtimeJudgment —— 每条 MQTT 消息一到就立刻判一次，最快
 *
 *   三种方式最后都汇到同一个 judgeAndSave()：
 *      judgeAndSave ── callService  把数据发给 AI
 *                  ├─ summarize    从 AI 的回复里挑出结论
 *                  └─ saveRecord   存一条记录
 *
 * ═════════════════════════════════════════════════════════════════════
 * 【结果存哪】都存 t_judgment_record，用 status 字段区分是哪种模式、成功还是失败：
 *   手动成功 'success' / 自动成功 'auto' / 实时成功 'realtime'
 *   本地占位 'mock' / 'auto_mock' / 'realtime_mock'，失败 'failed'
 *
 * ═════════════════════════════════════════════════════════════════════
 * 【赛场要改什么 → 去哪改】（都在 config.js，改完重启后端）：
 *   AI 服务地址 / 超时 / 请求体字段名 / 响应字段路径 → config.js 的 INTELLIGENT_JUDGMENT
 *   自动判定开不开、多久判一次、每次取几条            → config.js 的 AUTO_JUDGMENT
 *   实时判定开不开（每条消息判一次）                  → config.js 的 REALTIME_JUDGMENT
 *   自动判定改成判"行为数据"（默认只判传感器）        → 第 4 部分 runAutoOnce 里的表名
 *   没接 AI 时本地"瞎猜"的异常标准                    → 第 2 部分 mockResult 里的 > 10000
 *   AI 接口要 GET / 表单 / 回复不是 JSON 而是中文      → 第 2 部分 callService / summarize
 *
 * 【术语小抄】
 *   mock / 占位判定：没接真实 AI 服务时，程序在本地瞎猜一个"正常 / 数据异常"，用来跑通流程
 *   field1~field4：数据库里测量值的列（field1=进水温度，field2=出水温度，field3=流量，field4=压力）
 *   status：这条判定记录是哪来的、成功还是失败
 */

const { EventEmitter } = require('events')
const promisePool = require('../../config/dbPool')
const { getDeviceNo } = require('../../utils/protocol')
const { nowLocalDateTime } = require('../../utils/helper')
const { INTELLIGENT_JUDGMENT, AUTO_JUDGMENT } = require('./config')


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

/** 往 t_judgment_record 存一条判定记录。成功、占位、失败都走这里。 */
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
 * 猜法：每条记录里，只要有一个测量值（field1~field4）的绝对值超过 10000，就判"数据异常"。
 * 想改猜法就改下面函数里的 `> 10000`（比如改成 > 5000，或只看 field1 这一个字段）。
 * 只检查 field* 开头的字段是故意的：id/d_no/c_time 这些系统字段不参与判定，否则 id 涨过 10000 会误判。
 */
function mockResult(records) {
  return records.map(record => {
    let abnormal = false
    for (const [key, value] of Object.entries(record)) {
      if (!/^field\d+$/.test(key)) continue      // 只看 field1、field2... 这样的测量字段，其他都跳过
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

/** 前端传的 type → 去哪张表查记录。控制器也拿它校验 type 合不合法。 */
const TYPE_TABLES = { sensor: 't_sensor_data', behavior: 't_behavior_data' }

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

  // 2. 判定 + 存库；出错时给错误贴上 code
  try {
    return await judgeAndSave({ type, records, statusPair: MANUAL_STATUS })
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

/** 自动判定跑一轮：取最新几条传感器数据 → 判定 → 结果推给前端。 */
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
// 对外提供的函数
// #####################################################################
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
