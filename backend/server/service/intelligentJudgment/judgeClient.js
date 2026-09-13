/**
 * 【文件职责】判定服务 HTTP 客户端：发请求、解析响应、落库 t_judgment_record。
 *
 * 【谁在用】手动判定和自动判定两种模式共用这里。两者的区别只在"谁来决定判定哪几条
 * 数据、什么时候判定"，至于请求怎么发、响应怎么解析、结果怎么落库，完全一样：
 *   手动 controllers/intelligent/recognize.js ..... 用户在历史页勾选几条点按钮，一次一提交
 *   自动 service/autoJudgment/autoJudgment.js ..... 后端每隔几秒自动提交最新几条
 *
 * 【配置在哪】判定服务"长什么样"（地址、请求体字段名、结论字段路径）在
 * controllers/intelligent/config.js，两种模式共用一份，不要配两遍；
 * 自动模式特有的"多久跑一次、每次取几条"在 service/autoJudgment/config.js。
 *
 * 【只支持一种现场接口形态】
 * POST 一个 JSON 请求体 { [requestField]: 记录数组 } → 同步拿到 JSON 响应 → 按点路径取结论。
 *
 * ══════════════ 赛场现场接口不是这个形态怎么办 ══════════════
 * 先用 curl 打一下现场服务，看它到底要什么、回什么，再对照下表动手。
 * **不要往 config.js 里加配置项**——加一个键要同时改 config、改这里、改文档三处，
 * 赛场上时间不够；直接改函数，十几行的事，改完手动和自动两种模式一起生效。
 *
 * | 现场是这样的                          | 改哪个函数    | 怎么改              |
 * |--------------------------------------|-------------|--------------------|
 * | 请求体结构不一样（字段名、要套一层）      | 不用改代码   | config.js 的 requestField |
 * | 要 multipart 表单 / 要传文件            | callService | 看它上方的示例①      |
 * | 要 GET，参数拼在 URL 上                 | callService | 看它上方的示例②      |
 * | 响应不是 JSON，是一段中文文字            | summarize   | 看它上方的示例③      |
 * | 响应结构不一样（结论在别的字段里）        | 不用改代码   | config.js 的 resultPath / conclusionPath |
 * | 先提交任务拿 id，再轮询查结果（异步）      | callService | 看它上方的示例④      |
 *
 * 改完重启后端。验证（换成库里真实的记录 id）：
 *   curl -X POST http://127.0.0.1:3000/api/intelligent/judge \
 *     -H 'Content-Type: application/json' -d '{"type":"sensor","ids":[1]}'
 * 失败时别只看接口返回，`t_judgment_record` 里那条 status='failed' 的
 * error_message 带现场服务的原始响应前 300 字符，更能说明问题。
 */
const promisePool = require('../../config/dbPool')
const { getDeviceNo } = require('../../utils/protocol')

/** t_sensor_data / t_behavior_data 里真正存测量值的字段名（field1~field10）。
 *  只给本地占位判定 mockResult 筛字段用，详见那个函数的说明。 */
const MEASURE_FIELD = /^field\d+$/

/** 判定记录表懒建表：每次判定前调用一次，表已经存在时 CREATE TABLE IF NOT EXISTS
 * 直接跳过，不会报错也不会重复建。 */
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

/** 置信度转数字：取不到、空串、转不成数字都存 null。
 *  注意不能写成 `Number(x) || null`——置信度恰好是 0 时 0 是 falsy，会被吞成 null，
 *  而 0 是合法的置信度（服务明确表示"完全没把握"）。 */
function toConfidence(value) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/**
 * 智能判定服务还没配置/没启用时的本地兜底：不真的发请求，只看 field1~field10
 * 这些真实测量字段里有没有绝对值超过 10000 的值（对应传感器读数被钳位在异常
 * 最大值哨兵的情况），有就认为是异常数据。
 *
 * 只筛 field 开头的字段是必须的：记录里还有 id / d_no / c_time / online，
 * 它们不是测量值；早先版本把整行 Object.values 都算进来，结果 id 一旦超过
 * 10000（几千条数据之后必然发生）每条记录都被判成"数据异常"。
 *
 * 这只是让"现场还没接上真实判定服务时也能跑通整条流程、看到界面效果"的占位
 * 逻辑，不是真正的智能判定，结果会用带 mock 的 status 标记，跟真实判定结果区分开。
 */
function mockResult(records) {
  return records.map(record => {
    const values = Object.entries(record)
      .filter(([key]) => MEASURE_FIELD.test(key))
      .map(([, value]) => Number(value))
      .filter(Number.isFinite)
    const abnormal = values.some(value => Math.abs(value) > 10000)
    return { id: record.id, result: abnormal ? '数据异常' : '正常', confidence: abnormal ? 0.9 : 0.8 }
  })
}

/**
 * 发起判定：config.enabled=false 时返回本地占位结果（mock=true），否则向现场服务
 * 发一次 HTTP 请求。请求体固定是 { [requestField]: 记录数组 }，整体 JSON.stringify。
 *
 * 返回 { mock, body, data }：body 是发出去的请求体（诊断用，落库到 request_body），
 * data 是响应的 JSON 解析结果。响应不是合法 JSON 时直接抛错而不是当 null 往下走——
 * 现场最常见的情况是地址配错打到了别的服务上，抛错能在判定记录里留下原始响应片段，
 * 比"结论为空"好排查得多。
 *
 * ────────── 赛场改法示例（文件头那张表提到的 ①②④）──────────
 * ① 现场要 multipart 表单 / 要传文件：把下面的 body / headers 两行换成
 *      const form = new FormData()
 *      form.append('data', JSON.stringify(records))
 *      // 要当文件传就 form.append('file', new Blob([JSON.stringify(records)]), 'data.json')
 *    fetch 里 body 传 form，**并且不要再传 Content-Type**——multipart 的
 *    Content-Type 后面要跟一串 boundary，得让 fetch 自己生成，手写必然解析失败。
 *
 * ② 现场要 GET、参数拼在 URL 上：fetch 不允许 GET 带 body，改成
 *      const url = `${config.url}?ids=${records.map(r => r.id).join(',')}`
 *      response = await fetch(url, { method: 'GET', headers: config.headers, signal: controller.signal })
 *    把原来的 body 那一行删掉。
 *
 * ④ 现场是异步（先提交拿任务 id，再轮询查结果）：在本函数解析出 data 之后接一段轮询
 *      const jobId = data.job_id                         // 路径按现场实际的改
 *      for (let i = 0; i < 30; i++) {                    // 30 次 × 1 秒 = 最多等 30 秒
 *        await new Promise(r => setTimeout(r, 1000))
 *        const poll = await (await fetch(`${config.url}/result/${jobId}`)).json()
 *        if (poll.status === 'done') return { mock: false, body, data: poll }
 *        if (poll.status === 'failed') throw new Error('现场判定任务失败')
 *      }
 *      throw new Error('异步判定轮询超时')
 *    **循环一定要有上限**：自动模式是定时器在调，这里卡住不返回会一直占着那一轮
 *    （虽然有并发守卫挡着不会堆积，但自动判定会就此停更，看起来像页面坏了）。
 */
async function callService(records, config) {
  if (!config.enabled) {
    if (!config.mockWhenDisabled) throw new Error('智能判定服务尚未启用')
    return { mock: true, results: mockResult(records) }
  }

  const body = { [config.requestField]: records }
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

  if (!response.ok) throw new Error(`判定服务返回 HTTP ${response.status}: ${rawText.slice(0, 300)}`)
  try {
    return { mock: false, body, data: rawText ? JSON.parse(rawText) : null }
  } catch {
    throw new Error(`判定服务响应不是合法 JSON: ${rawText.slice(0, 300)}`)
  }
}

/**
 * 从响应里提取展示/落库用的 results / conclusion / confidence：
 * resultPath 定位结果数组（留空=用完整响应），再从里面第一条按 conclusionPath /
 * confidencePath 取结论和置信度——一次判定通常是同一台设备的一批数据，取第一条
 * 代表整批就够了。单条结果本身就是字符串时（服务直接返回结论文字），直接当结论用。
 *
 * ────────── 赛场改法示例（文件头那张表提到的 ③）──────────
 * ③ 现场响应不是 JSON，是一段中文文字，比如
 *      "检测结果：管道堵塞，置信度 0.87"
 *    这种情况 callService 那边会先抛"响应不是合法 JSON"，所以要改两处：
 *    (一) callService 里把 JSON.parse 那段改成直接返回原文
 *           return { mock: false, body, data: rawText }
 *    (二) 本函数开头插一段正则提取，命中就直接返回，不走下面的点路径逻辑：
 *           if (typeof responseData === 'string') {
 *             const c = responseData.match(/检测结果[：:]\s*([^，,]+)/)
 *             const p = responseData.match(/置信度[：:]?\s*([\d.]+)/)
 *             return {
 *               results: responseData,
 *               conclusion: c ? c[1] : null,
 *               confidence: p ? toConfidence(p[1]) : null,
 *             }
 *           }
 *    正则按现场实际措辞改，取的是第 1 个捕获组。拿不准就先 curl 一下把原文打出来，
 *    或者看 t_judgment_record.response_body 里存的那段。
 */
function summarize(responseData, config) {
  const results = readPath(responseData, config.resultPath) ?? responseData
  const first = Array.isArray(results) ? results[0] : results
  return {
    results,
    conclusion: readPath(first, config.conclusionPath) ?? (typeof first === 'string' ? first : null),
    confidence: toConfidence(readPath(first, config.confidencePath)),
  }
}

/** 本地占位结果是上面 mockResult 自己造的，结构已知，不走 resultPath 那套点路径解析。 */
function summarizeMock(results) {
  return { results, conclusion: results[0]?.result ?? null, confidence: results[0]?.confidence ?? null }
}

/**
 * 把一次判定的请求、响应、结论都落库到 t_judgment_record，供"智能判定记录"
 * 页面查询。d_no 从第一条被判定的记录里解析（一次判定通常是同一台设备的
 * 一批数据，取第一条代表整批就够了）；error 信息截到 1000 字符，避免异常
 * 堆栈太长把数据库字段撑爆。
 *
 * status 同时标明来自哪种模式，"智能判定记录"页可以按它筛：
 *   手动 'success' / 'mock'，自动 'auto' / 'auto_mock'，两种模式失败都是 'failed'
 */
async function saveRecord({ type, ids, records, requestBody, responseBody, conclusion, confidence, status, error }) {
  await ensureTable()
  await promisePool.execute(
    `INSERT INTO t_judgment_record
      (d_no, data_type, source_ids, request_body, response_body, conclusion, confidence, status, error_message, c_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [getDeviceNo(records[0] || {}), type, ids.join(','), JSON.stringify(requestBody ?? records), JSON.stringify(responseBody ?? null), conclusion, confidence, status, error?.slice(0, 1000) || null]
  )
}

/**
 * 一次完整判定：发请求 → 解析 → 落库，返回 { results, conclusion, confidence, mock }。
 * 手动和自动两种模式都走这里，差别只有 status 用哪一对取值，由 statusPair 传进来。
 * 判定失败时落一条 status='failed' 的记录再把异常抛出去，让调用方决定怎么回应
 * （手动模式转成 HTTP 502/504，自动模式只记日志继续下一轮）。
 */
async function judgeAndSave({ type, records, config, statusPair }) {
  const ids = records.map(record => record.id)
  try {
    const service = await callService(records, config)
    const summary = service.mock ? summarizeMock(service.results) : summarize(service.data, config)
    await saveRecord({
      type, ids, records,
      requestBody: service.mock ? records : service.body,
      responseBody: service.mock ? service.results : service.data,
      ...summary,
      status: service.mock ? statusPair.mock : statusPair.ok,
    })
    return { ...summary, mock: service.mock }
  } catch (error) {
    try {
      await saveRecord({ type, ids, records, status: 'failed', error: error.message })
    } catch (saveError) {
      console.error('[Judgment] 失败记录保存失败:', saveError.message)
    }
    throw error
  }
}

module.exports = {
  ensureTable,
  readPath,
  toConfidence,
  mockResult,
  callService,
  summarize,
  summarizeMock,
  saveRecord,
  judgeAndSave,
}
