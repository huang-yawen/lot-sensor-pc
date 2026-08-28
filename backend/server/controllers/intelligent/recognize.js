/** 【文件职责】智能判定 API 控制器：把选中的传感器/行为数据记录，按配置中心
 * INTELLIGENT_JUDGMENT 定义的格式发给现场判定服务，解析并落库判定结果。
 * 兼容多种现场接口形态：JSON/表单请求体、GET/POST 方法、JSON/纯文本响应、
 * 同步直接返回结果/异步先提交任务再轮询结果——这几个维度都能在配置中心
 * 单独切换，不需要现场改代码去适配不同赛题提供的判定服务。
 * 【配置中心关联】INTELLIGENT_JUDGMENT 及相关开关由处理链路读取。 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')
const { getDeviceNo } = require('../../utils/protocol')

const TYPE_TABLES = { sensor: 't_sensor_data', behavior: 't_behavior_data' }

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

/** 按点号取嵌套字段值，比如 readPath({a:{b:1}}, 'a.b') === 1。path 为空直接返回原值。 */
function readPath(value, path) {
  if (!path) return value
  return String(path).split('.').filter(Boolean).reduce((current, key) => current?.[key], value)
}

/**
 * 用 context 里的值渲染模板：对象/数组递归渲染每一项；字符串里的 {{xxx}} 占位符替换成
 * context 对应路径的值——如果整个字符串就是一个占位符（比如 "{{records}}"），直接返回
 * 原始类型（数组/对象），不会被强转成字符串；如果占位符只是字符串的一部分（比如
 * "id-{{record.id}}"），按普通字符串拼接处理。
 */
function renderTemplate(template, context) {
  if (Array.isArray(template)) return template.map(item => renderTemplate(item, context))
  if (template && typeof template === 'object') {
    return Object.fromEntries(Object.entries(template).map(([key, value]) => [key, renderTemplate(value, context)]))
  }
  if (typeof template !== 'string') return template
  const exact = template.match(/^\{\{\s*([\w.]+)\s*\}\}$/)
  if (exact) return readPath(context, exact[1])
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => String(readPath(context, key) ?? ''))
}

function mockResult(records) {
  return records.map(record => {
    const values = Object.values(record).map(Number).filter(Number.isFinite)
    const abnormal = values.some(value => Math.abs(value) > 10000)
    return { id: record.id, result: abnormal ? '数据异常' : '正常', confidence: abnormal ? 0.9 : 0.8 }
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 发一次真正的 HTTP 请求，统一处理三个可能因现场接口不同而变化的维度：
 *   1) bodyFormat='form-data' 时用 FormData 发 multipart 请求（比如现场服务要求上传
 *      文件/表单字段），而不是 JSON.stringify；此时会自动去掉调用方传入 headers 里
 *      手写的 Content-Type，交给 fetch 自动生成带正确边界串的值（手动指定反而会因为
 *      缺 boundary 导致服务端解析失败）。
 *   2) method 为 GET/HEAD 时，bodyObj 不放进请求体，而是拼接成 URL 查询参数（数组值
 *      展开成多个同名参数，比如 {ids:[1,2]} 变成 ?ids=1&ids=2）。
 *   3) 响应文本会尝试 JSON.parse；解析失败时 data 为 null，原始文本单独通过 rawText
 *      返回，供 responseFormat='text' 场景用正则提取。
 *
 * @param {Object} options
 * @param {string} options.url
 * @param {string} options.method
 * @param {Object} [options.headers]
 * @param {Object|null} [options.bodyObj] - 已用 renderTemplate 渲染好的请求体对象；GET/HEAD 或无需请求体时传 null
 * @param {string} [options.bodyFormat] - 'json' | 'form-data'，仅在有请求体时生效
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{status:number, ok:boolean, data:*, rawText:string}>}
 */
async function sendHttpRequest({ url, method, headers, bodyObj, bodyFormat, timeoutMs }) {
  const upperMethod = String(method || 'GET').toUpperCase()
  const noBody = ['GET', 'HEAD'].includes(upperMethod)
  let finalUrl = url
  const fetchOptions = { method: upperMethod, headers: { ...(headers || {}) } }

  if (noBody) {
    // GET/HEAD：把请求体对象拼接成查询参数，数组值展开成多个同名参数。
    if (bodyObj && typeof bodyObj === 'object') {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(bodyObj)) {
        const values = Array.isArray(value) ? value : [value]
        for (const v of values) params.append(key, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''))
      }
      const query = params.toString()
      if (query) finalUrl += (url.includes('?') ? '&' : '?') + query
    }
  } else if (bodyFormat === 'form-data') {
    // multipart/form-data：每个顶层字段作为一个表单项；对象/数组值转成 JSON 字符串
    // （FormData 没有跨后端统一的数组字段约定，转 JSON 字符串是最通用的默认做法）。
    const form = new FormData()
    for (const [key, value] of Object.entries(bodyObj || {})) {
      form.append(key, typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? ''))
    }
    fetchOptions.body = form
    delete fetchOptions.headers['Content-Type']
    delete fetchOptions.headers['content-type']
  } else {
    fetchOptions.headers['Content-Type'] = fetchOptions.headers['Content-Type'] || 'application/json'
    fetchOptions.body = JSON.stringify(bodyObj)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs || 10000)
  try {
    const response = await fetch(finalUrl, { ...fetchOptions, signal: controller.signal })
    const rawText = await response.text()
    let data = null
    try { data = rawText ? JSON.parse(rawText) : null } catch { data = null }
    return { status: response.status, ok: response.ok, data, rawText }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 异步任务轮询：按 asyncPollIntervalMs 间隔反复请求 asyncPollUrl（其中 {{jobId}}
 * 占位符已替换成真实任务 ID），直到状态命中 asyncDoneStatusValues（成功，返回这次
 * 轮询的响应作为最终结果）、命中 asyncFailedStatusValues（抛错）、或等待超过
 * asyncMaxWaitMs（抛超时错误，跟单次请求的 timeoutMs 是两回事：timeoutMs 只管每一次
 * HTTP 请求本身，asyncMaxWaitMs 管的是从提交任务到拿到完成状态的整个轮询过程）。
 */
async function pollAsyncResult(jobId, config) {
  const pollUrl = renderTemplate(config.asyncPollUrl, { jobId })
  const doneSet = new Set((config.asyncDoneStatusValues || []).map(s => String(s).toLowerCase()))
  const failedSet = new Set((config.asyncFailedStatusValues || []).map(s => String(s).toLowerCase()))
  const deadline = Date.now() + (config.asyncMaxWaitMs || 30000)

  for (;;) {
    const resp = await sendHttpRequest({
      url: pollUrl,
      method: config.asyncPollMethod || 'GET',
      headers: config.headers,
      bodyObj: null,
      timeoutMs: config.timeoutMs,
    })
    if (!resp.ok) throw new Error(`异步判定轮询返回 HTTP ${resp.status}: ${resp.rawText.slice(0, 300)}`)
    const status = String(readPath(resp.data, config.asyncStatusPath) ?? '').toLowerCase()
    if (doneSet.has(status)) return resp
    if (failedSet.has(status)) throw new Error(`异步判定任务失败（状态=${status || '未知'}）`)
    if (Date.now() >= deadline) throw new Error(`异步判定任务轮询超时（超过 ${config.asyncMaxWaitMs}ms 仍未完成）`)
    await sleep(config.asyncPollIntervalMs || 1000)
  }
}

/**
 * 发起一次（或多次，取决于 requestMode）判定请求，asyncMode 开启时自动接轮询，
 * 返回 { body, data, rawText }：body 是渲染后的请求体（诊断用，落库到 request_body）；
 * data 是响应 JSON 解析结果（解析失败为 null）；rawText 是响应原始文本
 * （responseFormat='text' 时靠这个提取结论）。requestMode='single' 时三者都是数组。
 */
async function callService(records, config) {
  if (!config.enabled) {
    if (!config.mockWhenDisabled) throw new Error('智能判定服务尚未启用')
    return { mock: true, results: mockResult(records) }
  }

  async function requestOnce(context) {
    const bodyObj = renderTemplate(config.requestTemplate, context)
    const method = String(config.method || 'POST').toUpperCase()
    let resp = await sendHttpRequest({
      url: config.url, method, headers: config.headers,
      bodyObj, bodyFormat: config.bodyFormat, timeoutMs: config.timeoutMs,
    })
    if (!resp.ok) throw new Error(`判定服务返回 HTTP ${resp.status}: ${resp.rawText.slice(0, 300)}`)

    if (config.asyncMode) {
      // 同步阶段的这次响应只是"任务已提交"的回执，真正结果要另外轮询拿。
      const jobId = readPath(resp.data, config.asyncJobIdPath)
      if (jobId == null) {
        throw new Error(`异步判定：未能从提交响应里按 asyncJobIdPath="${config.asyncJobIdPath}" 取到任务 ID`)
      }
      resp = await pollAsyncResult(jobId, config)
    }
    return { body: bodyObj, data: resp.data, rawText: resp.rawText }
  }

  if (config.requestMode === 'single') {
    const replies = []
    for (const record of records) {
      replies.push(await requestOnce({ records: [record], record, ids: [record.id] }))
    }
    return {
      body: replies.map(r => r.body),
      data: replies.map(r => r.data),
      rawText: replies.map(r => r.rawText),
      single: true,
    }
  }
  return requestOnce({ records, record: records[0] || {}, ids: records.map(item => item.id) })
}

/** 从一条结果里按 responseFormat 提取 conclusion/confidence。text 模式下 item 是原始文本。 */
function extractOne(item, config) {
  if (config.responseFormat === 'text') {
    const text = typeof item === 'string' ? item : ''
    const conclusionMatch = config.conclusionRegex ? text.match(new RegExp(config.conclusionRegex)) : null
    const confidenceMatch = config.confidenceRegex ? text.match(new RegExp(config.confidenceRegex)) : null
    const confidence = confidenceMatch ? Number(confidenceMatch[1]) : null
    return {
      conclusion: conclusionMatch ? conclusionMatch[1] : null,
      confidence: Number.isFinite(confidence) ? confidence : null,
    }
  }
  return {
    conclusion: readPath(item, config.conclusionPath) ?? (typeof item === 'string' ? item : null),
    confidence: Number(readPath(item, config.confidencePath)) || null,
  }
}

/**
 * 汇总一次（或多次）判定的响应，提取展示/落库用的 results/conclusion/confidence。
 * responseFormat='json' 时沿用点路径从 data 里取；responseFormat='text' 时改用正则
 * 从 rawText 里取，此时 resultPath/conclusionPath/confidencePath 不生效。
 */
function summarize(responseData, rawText, config) {
  if (config.responseFormat === 'text') {
    if (Array.isArray(rawText)) {
      // requestMode='single'：每次请求各自一段文本，各自提取，取第一条作为整体代表。
      const items = rawText.map(text => extractOne(text, config))
      return { results: rawText, conclusion: items[0]?.conclusion ?? null, confidence: items[0]?.confidence ?? null }
    }
    return { results: rawText, ...extractOne(rawText, config) }
  }
  if (Array.isArray(responseData)) {
    const results = responseData.map(item => readPath(item, config.resultPath) ?? item).flat()
    return { results, ...extractOne(results[0], config) }
  }
  const extracted = readPath(responseData, config.resultPath) ?? responseData
  const first = Array.isArray(extracted) ? extracted[0] : extracted
  return { results: extracted, ...extractOne(first, config) }
}

async function saveRecord({ type, ids, records, requestBody, responseBody, conclusion, confidence, status, error }) {
  await ensureTable()
  await promisePool.execute(
    `INSERT INTO t_judgment_record
      (d_no, data_type, source_ids, request_body, response_body, conclusion, confidence, status, error_message, c_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [getDeviceNo(records[0] || {}), type, ids.join(','), JSON.stringify(requestBody ?? records), JSON.stringify(responseBody ?? null), conclusion, confidence, status, error?.slice(0, 1000) || null]
  )
}

module.exports = async (req, res) => {
  const type = req.body?.type
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(Number).filter(Number.isInteger))].slice(0, 100) : []
  const table = TYPE_TABLES[type]
  if (!table || ids.length === 0) return res.status(400).json({ success: false, message: 'type 必须是 sensor/behavior，ids 必须是非空整数数组' })

  let records = []
  try {
    const placeholders = ids.map(() => '?').join(',')
    const [rows] = await promisePool.query(`SELECT * FROM ${table} WHERE id IN (${placeholders}) ORDER BY id`, ids)
    records = rows
    if (records.length === 0) return res.status(404).json({ success: false, message: '未找到待判定数据' })

    const config = systemConfig.getConfig().INTELLIGENT_JUDGMENT
    const serviceResult = await callService(records, config)
    const responseData = serviceResult.mock ? serviceResult : serviceResult.data
    const summary = serviceResult.mock
      ? { results: serviceResult.results, conclusion: serviceResult.results[0]?.result || null, confidence: serviceResult.results[0]?.confidence || null }
      : summarize(responseData, serviceResult.rawText, config)
    // text 响应模式下 data 通常是 null（不是规范 JSON），落库存原始文本更有诊断价值。
    const responseBodyToSave = serviceResult.mock
      ? responseData
      : (config.responseFormat === 'text' ? serviceResult.rawText : responseData)
    await saveRecord({ type, ids, records, requestBody: serviceResult.body, responseBody: responseBodyToSave, ...summary, status: serviceResult.mock ? 'mock' : 'success' })
    return res.json({ success: true, data: { ...summary, mock: !!serviceResult.mock }, message: serviceResult.mock ? '本地判定完成（服务未启用）' : '智能判定完成' })
  } catch (error) {
    console.error('[Judgment] 判定失败:', error.message)
    try { await saveRecord({ type, ids, records, status: 'failed', error: error.message }) } catch (saveError) { console.error('[Judgment] 失败记录保存失败:', saveError.message) }
    const status = error.name === 'AbortError' ? 504 : 502
    return res.status(status).json({ success: false, message: error.name === 'AbortError' ? '智能判定服务请求超时' : error.message })
  }
}

module.exports.ensureTable = ensureTable
/** 【文件职责】智能判定接口，发起一次传感器或行为数据的分析流程，支持
 * json/form-data 请求体、GET/POST 方法、json/text 响应解析、同步/异步任务模式。
 * 【配置中心关联】INTELLIGENT_JUDGMENT 与功能开关由下层服务/调用链读取。 */
