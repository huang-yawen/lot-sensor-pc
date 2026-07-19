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

function readPath(value, path) {
  if (!path) return value
  return String(path).split('.').filter(Boolean).reduce((current, key) => current?.[key], value)
}

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

function mockResult(records, rules) {
  return records.map(record => {
    const values = Object.values(record).map(Number).filter(Number.isFinite)
    const abnormal = values.some(value => Math.abs(value) > 10000)
    return { id: record.id, result: abnormal ? '数据异常' : '正常', confidence: abnormal ? 0.9 : 0.8 }
  })
}

async function callService(records, config) {
  if (!config.enabled) {
    if (!config.mockWhenDisabled) throw new Error('智能判定服务尚未启用')
    return { mock: true, results: mockResult(records) }
  }

  async function request(context) {
    const body = renderTemplate(config.requestTemplate, context)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs || 10000)
    try {
      const method = String(config.method || 'POST').toUpperCase()
      const response = await fetch(config.url, {
        method,
        headers: config.headers || { 'Content-Type': 'application/json' },
        body: ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      const text = await response.text()
      let data
      try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
      if (!response.ok) throw new Error(`判定服务返回 HTTP ${response.status}: ${text.slice(0, 300)}`)
      return { body, data }
    } finally { clearTimeout(timer) }
  }

  if (config.requestMode === 'single') {
    const replies = []
    for (const record of records) {
      replies.push(await request({ records: [record], record, ids: [record.id] }))
    }
    return { body: replies.map(reply => reply.body), data: replies.map(reply => reply.data), single: true }
  }
  return request({ records, record: records[0] || {}, ids: records.map(item => item.id) })
}

function summarize(responseData, config) {
  if (Array.isArray(responseData)) {
    const results = responseData.map(item => readPath(item, config.resultPath) ?? item).flat()
    const first = results[0]
    return {
      results,
      conclusion: readPath(first, config.conclusionPath) ?? (typeof first === 'string' ? first : null),
      confidence: Number(readPath(first, config.confidencePath)) || null,
    }
  }
  const extracted = readPath(responseData, config.resultPath) ?? responseData
  const first = Array.isArray(extracted) ? extracted[0] : extracted
  return {
    results: extracted,
    conclusion: readPath(first, config.conclusionPath) ?? (typeof first === 'string' ? first : null),
    confidence: Number(readPath(first, config.confidencePath)) || null,
  }
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
      : summarize(responseData, config)
    await saveRecord({ type, ids, records, requestBody: serviceResult.body, responseBody: responseData, ...summary, status: serviceResult.mock ? 'mock' : 'success' })
    return res.json({ success: true, data: { ...summary, mock: !!serviceResult.mock }, message: serviceResult.mock ? '本地判定完成（服务未启用）' : '智能判定完成' })
  } catch (error) {
    console.error('[Judgment] 判定失败:', error.message)
    try { await saveRecord({ type, ids, records, status: 'failed', error: error.message }) } catch (saveError) { console.error('[Judgment] 失败记录保存失败:', saveError.message) }
    const status = error.name === 'AbortError' ? 504 : 502
    return res.status(status).json({ success: false, message: error.name === 'AbortError' ? '智能判定服务请求超时' : error.message })
  }
}

module.exports.ensureTable = ensureTable
