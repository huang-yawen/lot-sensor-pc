/**
 * 【文件职责】手动判定 API 控制器（POST /api/intelligent/judge）。
 * 用户在传感器/行为历史页勾选几条记录、点"智能判定"按钮走的就是这里：
 * 校验参数 → 按 id 查出原始记录 → 交给 judgeClient 发请求解析落库 → 返回给前端弹窗。
 *
 * ────────────── 两种判定模式 ──────────────
 *   手动（本文件）................................. 用户勾选，一次一提交，结果弹窗展示
 *   自动（service/autoJudgment/autoJudgment.js）... 后端每隔几秒自动提交最新几条，
 *                                                  结果推给"自动判定"页渲染表格和图表
 * 两者共用 service/intelligentJudgment/judgeClient.js 发请求、解析响应、落库，
 * 也共用 ./config.js 里的判定服务地址等参数；落库时靠 status 区分是哪种模式来的。
 *
 * ────────────── 请求 / 响应长什么样 ──────────────
 * 前端发：  POST /api/intelligent/judge   { "type": "sensor", "ids": [101, 102, 103] }
 * 本文件回：{ success: true, data: { results, conclusion, confidence, mock }, message }
 *          出错时 HTTP 502（服务报错）/ 504（请求超时），body 同样是 { success:false, message }
 *
 * 判定失败时 judgeClient 已经往 t_judgment_record 落了一条 status='failed'，
 * 本文件只负责把异常翻译成对应的 HTTP 状态码。
 */
const promisePool = require('../../config/dbPool')
const CONFIG = require('./config')
const { judgeAndSave, ensureTable } = require('../../service/intelligentJudgment/judgeClient')

/** 判定的数据来源类型 -> 对应的原始数据表，请求体里的 type 只能是这两个之一。 */
const TYPE_TABLES = { sensor: 't_sensor_data', behavior: 't_behavior_data' }

/** 一次判定最多取多少条记录，防止前端全选几千条把判定服务打挂。 */
const MAX_IDS = 100

/** 手动模式落库用的 status：判定成功 'success'，本地占位判定 'mock'。
 *  自动模式用的是 'auto' / 'auto_mock'，见 service/autoJudgment/autoJudgment.js。 */
const MANUAL_STATUS = { ok: 'success', mock: 'mock' }

module.exports = async (req, res) => {
  const type = req.body?.type
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(Number).filter(Number.isInteger))].slice(0, MAX_IDS) : []
  const table = TYPE_TABLES[type]
  if (!table || ids.length === 0) return res.status(400).json({ success: false, message: 'type 必须是 sensor/behavior，ids 必须是非空整数数组' })

  try {
    const placeholders = ids.map(() => '?').join(',')
    const [records] = await promisePool.query(`SELECT * FROM ${table} WHERE id IN (${placeholders}) ORDER BY id`, ids)
    if (records.length === 0) return res.status(404).json({ success: false, message: '未找到待判定数据' })

    const data = await judgeAndSave({ type, records, config: CONFIG, statusPair: MANUAL_STATUS })
    return res.json({ success: true, data, message: data.mock ? '本地判定完成（服务未启用）' : '智能判定完成' })
  } catch (error) {
    console.error('[Judgment] 判定失败:', error.message)
    const timeout = error.name === 'AbortError'
    return res.status(timeout ? 504 : 502).json({ success: false, message: timeout ? '智能判定服务请求超时' : error.message })
  }
}

/** 转发给 ./records.js 用——判定记录页查询前也要确保表存在。表定义在 judgeClient。 */
module.exports.ensureTable = ensureTable
