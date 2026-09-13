/**
 * 【文件职责】自动判定模式：每隔 intervalMs 取最新 recentCount 条传感器数据，提交给
 * 现场判定服务，结果落库 t_judgment_record + 推给"自动判定"页渲染成表格和图表。
 * 参数在同目录 config.js。
 *
 * ────────────── 跟手动模式的区别 ──────────────
 * 手动（controllers/intelligent/recognize.js）：用户在历史页勾选几条再点按钮，一次一提交。
 * 自动（本文件）：后端自己按固定节奏不停提交最新数据，关掉页面也照跑。
 * 两者共用 ../intelligentJudgment/judgeClient.js 发请求和解析响应，也共用
 * controllers/intelligent/config.js 里的判定服务参数；落库都进 t_judgment_record，
 * 靠 status 区分：手动 'success'/'mock'，自动 'auto'/'auto_mock'，失败都是 'failed'。
 *
 * ────────────── 结果怎么到页面 ──────────────
 * 不直接调 app.js 的 broadcast——那样 service 会反过来依赖入口文件。沿用项目里
 * safetyInterlock / sensorInverted 的写法：本文件只 emit 事件，app.js 用
 * onAutoJudgment(listener) 订阅后再 broadcast('auto_judgment', ...)。
 * 页面第一次打开时没有事件可收，所以另外留了 getRecent() 给
 * GET /api/intelligent/auto-recent 取内存里已有的最近几条。
 *
 * 【判定失败不停机】某一轮失败（服务没起、超时、响应不是 JSON）只记一条日志和一条
 * status='failed' 的判定记录，定时器继续跑下一轮——赛场上判定服务中途重启是常事，
 * 不能因为一次失败就把整个自动模式停掉，否则要重启后端才能恢复。
 *
 * ══════════════ 赛场要改什么，改哪里 ══════════════
 * | 赛题要求                          | 改这里                                      |
 * |----------------------------------|--------------------------------------------|
 * | 判快点/慢点、每次取几条、留几条      | 不用改代码，改 ./config.js 后重启后端         |
 * | 判的是行为数据，不是传感器数据        | runOnce() 里 SQL 的表名改 t_behavior_data，   |
 * |                                  | 同时把 judgeAndSave 的 type 改 'behavior'    |
 * | 只判某一台设备的数据                | runOnce() 的 SQL 加 WHERE d_no = '设备号'     |
 * | 只判"实时数据"、不判"保存数据"       | runOnce() 的 SQL 加 WHERE online = '实时数据' |
 * | 判定服务地址 / 请求体 / 结论路径     | 不在本文件，在 controllers/intelligent/config.js |
 * |                                  | （手动模式共用那一份，只配一遍）                |
 * | 现场接口形态完全不同（表单/异步/文本） | 不在本文件，改 ../intelligentJudgment/judgeClient.js |
 * | 嫌 t_judgment_record 涨太快        | 看 judgeAndSave（在 judgeClient.js 里），      |
 * |                                  | 那里是唯一的落库点                            |
 * | 出现某个结论时要告警/联动           | push() 调用前插判断，可参考 service/alarm 的写法 |
 * 改完都要**重启后端**（config.js 的值在定时器启动时读一次，不是热更新）。
 */
const { EventEmitter } = require('events')
const promisePool = require('../../config/dbPool')
const CONFIG = require('./config')
const JUDGE_CONFIG = require('../../controllers/intelligent/config')
const { judgeAndSave } = require('../intelligentJudgment/judgeClient')
const { nowLocalDateTime } = require('../../utils/helper')

/** 自动模式落库用的 status，跟手动模式的 'success'/'mock' 区分开，
 *  "智能判定记录"页可以按它筛出哪些是自动跑出来的。 */
const AUTO_STATUS = { ok: 'auto', mock: 'auto_mock' }

const events = new EventEmitter()

/** 最近若干次判定结果，新的在数组末尾。长度上限 config.bufferSize。 */
const buffer = []

let timer = null

/**
 * 这一轮是否还在跑。setInterval 不会等 async 回调结束就到点再触发一次，而判定一轮
 * 的耗时完全取决于现场服务（默认 timeoutMs=10000 比默认 intervalMs=5000 还长），
 * 服务一慢就会有两三轮并发压上去：判定服务被成倍请求、落库顺序也乱。
 * 所以上一轮没结束就跳过这一轮——宁可少判一次，也不要堆积。
 */
let running = false

/** 定时周期：低于 1000ms 会把判定服务和数据库打满，一律抬到 1000。
 *  抬而不是回退到默认值——用户把它配小就是想要更快，悄悄改成默认的 5000
 *  反而比他配的慢，不符合意图。 */
function resolveIntervalMs() {
  const configured = Number(CONFIG.intervalMs)
  if (!Number.isFinite(configured)) return 5000
  return Math.max(1000, Math.trunc(configured))
}

/** 每次取几条：至少 1 条，最多 100 条（跟手动模式的上限保持一致）。 */
function resolveRecentCount() {
  const configured = Number(CONFIG.recentCount)
  if (!Number.isFinite(configured)) return 5
  return Math.min(100, Math.max(1, Math.trunc(configured)))
}

/** 内存里留几条：至少 1 条，最多 500 条（再多前端图表也画不清，纯占内存）。 */
function resolveBufferSize() {
  const configured = Number(CONFIG.bufferSize)
  if (!Number.isFinite(configured)) return 50
  return Math.min(500, Math.max(1, Math.trunc(configured)))
}

/** 把一次判定结果压进内存缓冲并通知订阅者（app.js 收到后广播给页面）。 */
function push(entry) {
  buffer.push(entry)
  const max = resolveBufferSize()
  while (buffer.length > max) buffer.shift()
  events.emit('auto_judgment', entry)
  return entry
}

/**
 * 跑一轮：取最新 recentCount 条传感器数据 → 判定 → 落库 → 进缓冲 → 发事件。
 * 表里一条数据都没有时直接跳过这一轮（赛场刚开机、设备还没上报的正常情况，
 * 不必往判定记录里落一条失败）。
 * 返回这一轮的结果对象；失败时返回的是 status='failed' 的那条，不抛异常。
 */
async function runOnce() {
  const limit = resolveRecentCount()
  // 按 c_time 倒序取最新的，再翻回时间正序提交——跟手动模式勾选后按 id 升序提交一致，
  // 判定服务收到的记录顺序在两种模式下才是同一个语义。
  const [rows] = await promisePool.query(
    'SELECT * FROM t_sensor_data ORDER BY c_time DESC, id DESC LIMIT ?',
    [limit]
  )
  if (rows.length === 0) return null

  const records = [...rows].reverse()
  const ids = records.map(record => record.id)
  const time = nowLocalDateTime()

  try {
    const result = await judgeAndSave({
      type: 'sensor',
      records,
      config: JUDGE_CONFIG,
      statusPair: AUTO_STATUS,
    })
    return push({
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
    return push({
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

/**
 * 启动自动判定定时器（服务启动时调一次）。周期和每次取几条在启动时读一次，
 * 改了 config.js 要重启后端才生效，不是热更新——跟项目里其它 config.js 一样。
 */
function start() {
  if (timer) return
  if (!CONFIG.enabled) {
    console.log('[AutoJudgment] 自动判定未启用（service/autoJudgment/config.js 的 enabled=false）')
    return
  }
  const intervalMs = resolveIntervalMs()
  timer = setInterval(async () => {
    if (running) {
      console.warn(`[AutoJudgment] 上一轮还没判完，跳过这一轮（现场服务响应比 ${intervalMs}ms 慢，可以把 intervalMs 调大）`)
      return
    }
    running = true
    try {
      await runOnce()
    } catch (err) {
      // runOnce 内部已经兜住了判定失败，走到这里通常是查库失败（MySQL 宕了）。
      console.error('[AutoJudgment] 自动判定取数失败:', err.message)
    } finally {
      running = false
    }
  }, intervalMs)
  timer.unref?.()
  console.log(`[AutoJudgment] 自动判定已启动：每 ${intervalMs}ms 提交最新 ${resolveRecentCount()} 条传感器数据`)
}

module.exports = {
  start,
  runOnce,
  /** 页面首次打开时取内存里已有的结果（WebSocket 只能推之后新产生的）。 */
  getRecent: () => [...buffer],
  onAutoJudgment: (listener) => events.on('auto_judgment', listener),
}
