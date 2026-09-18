/**
 * 【文件职责】演示「自动判定出错」时，后端日志 + 前端表格 + 数据库记录分别长什么样。
 *
 * 不依赖数据库：只复刻 service/intelligent/intelligentJudgment.js 里 callService 的请求与
 * 错误包装逻辑（第 141~176 行）和 runAutoOnce 的失败分支（第 343~354 行），配合一个本地假
 * “判定服务”模拟几种常见故障，打印**真实**的报错文案。
 *
 * 用法：node tools/demo_auto_judgment_error.js
 */
import http from 'http'
import fs from 'fs'

// 与 backend/server/service/intelligent/config.js 的 INTELLIGENT_JUDGMENT 默认值一致
const BASE_CONFIG = {
  enabled: true,
  mockWhenDisabled: true,
  url: 'http://127.0.0.1:5000/judgment',
  method: 'POST',
  timeoutMs: 10000,
  headers: { 'Content-Type': 'application/json' },
  requestField: 'data',
}

/** 复刻 intelligentJudgment.js 的 callService（含全部错误分支）。 */
async function callService(records, config) {
  if (!config.enabled) {
    if (!config.mockWhenDisabled) throw new Error('智能判定服务尚未启用')
    return { mock: true, results: [] }
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

/** 演示输出缓冲：同时打印并在结束时写一份 UTF-8 文件（终端编码容易把中文搞乱码）。 */
const OUTPUT_LINES = []
function out(text) {
  OUTPUT_LINES.push(text)
  console.log(text)
}

/** 复刻 runAutoOnce 的失败分支：打后端日志 + 产出一条前端用的 failed 条目。 */
async function runAutoOnceDemo(config) {
  const time = new Date().toLocaleString('zh-CN', { hour12: false })
  const ids = [1201, 1202, 1203]
  try {
    const result = await callService([{ id: 1201 }], config)
    return { time, ids, status: result.mock ? 'auto_mock' : 'auto', error: null }
  } catch (error) {
    out(`[后端日志] [AutoJudgment] 本轮判定失败: ${error.message}`)
    return { time, ids, conclusion: null, confidence: null, results: null, status: 'failed', error: error.message }
  }
}

;(async () => {
  // 本地假“判定服务”，用来模拟 HTTP 500 / 返回 HTML / 响应很慢
  const fake = http.createServer((req, res) => {
    if (req.url === '/judgment-500') {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Internal Server Error: model not loaded')
      return
    }
    if (req.url === '/judgment-html') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body>502 Bad Gateway (nginx)</body></html>')
      return
    }
    if (req.url === '/judgment-slow') {
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"result":"正常"}') }, 3000)
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  })
  await new Promise((resolve) => fake.listen(5311, resolve))

  const scenarios = [
    { name: '① 判定服务没启动 / 地址写错（连接被拒）', cfg: { ...BASE_CONFIG, url: 'http://127.0.0.1:5999/judgment' } },
    { name: '② 判定服务响应超时（timeoutMs=500）', cfg: { ...BASE_CONFIG, url: 'http://127.0.0.1:5311/judgment-slow', timeoutMs: 500 } },
    { name: '③ 判定服务内部报错（HTTP 500）', cfg: { ...BASE_CONFIG, url: 'http://127.0.0.1:5311/judgment-500' } },
    { name: '④ 响应不是 JSON（返回了 HTML 错误页）', cfg: { ...BASE_CONFIG, url: 'http://127.0.0.1:5311/judgment-html' } },
    { name: '⑤ 判定服务未启用且禁止占位判定', cfg: { ...BASE_CONFIG, enabled: false, mockWhenDisabled: false } },
  ]

  for (const scenario of scenarios) {
    out(`\n===== ${scenario.name} =====`)
    const entry = await runAutoOnceDemo(scenario.cfg)
    out(`[数据库 t_judgment_record] status='failed'  error_message='${entry.error}'  conclusion=NULL  confidence=NULL  source_ids='${entry.ids.join(',')}'`)
    out(`[前端“自动判定”页] 判定时间=${entry.time}  状态=失败(红色标签)  判定结论=—  置信度=—  错误信息=${entry.error}`)
  }

  fake.close()
  out('\n（演示结束。以上错误文案与后端真实运行时一致。）')
  fs.writeFileSync(new URL('./demo_auto_judgment_error.output.txt', import.meta.url), OUTPUT_LINES.join('\n'), 'utf8')
})()
