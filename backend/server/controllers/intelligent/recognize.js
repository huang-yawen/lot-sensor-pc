/**
 * 【文件职责】手动判定 API 控制器（POST /api/intelligent/judge）。
 * 用户在传感器/行为历史页勾选几条记录、点"智能判定"按钮走的就是这里：
 * 校验参数 → 调 service/intelligent/intelligentJudgment.js 的 runManualJudgment → 把结果/错误翻译成 HTTP 响应。
 * 查库、调用判定服务、存记录都在 service/intelligent/intelligentJudgment.js 里，这里不自己干。
 * 判定服务的参数在 service/intelligent/config.js。
 *
 * ────────────── 请求 / 响应长什么样 ──────────────
 * 前端发：  POST /api/intelligent/judge   { "type": "sensor", "ids": [101, 102, 103] }
 * 本文件回：{ success: true, data: { results, conclusion, confidence, mock }, message }
 *          出错时 HTTP 404（没查到数据）/ 502（判定服务报错）/ 504（判定服务超时）
 *
 * 本文件只负责把异常翻译成对应的 HTTP 状态码。
 */
const { runManualJudgment, TYPE_TABLES } = require('../../service/intelligent/intelligentJudgment')

/** 一次判定最多取多少条记录，防止前端全选几千条把判定服务打挂。 */
const MAX_IDS = 100

/** runManualJudgment 抛出的错误码 -> HTTP 状态码。没匹配上的一律当成 502（判定服务报错）。 */
const ERROR_STATUS = { NOT_FOUND: 404, TIMEOUT: 504, BAD_GATEWAY: 502 }

module.exports = async (req, res) => {
  const type = req.body?.type
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(Number).filter(Number.isInteger))].slice(0, MAX_IDS) : []
  if (!TYPE_TABLES[type] || ids.length === 0) {
    return res.status(400).json({ success: false, message: 'type 必须是 sensor/behavior，ids 必须是非空整数数组' })
  }

  try {
    const data = await runManualJudgment({ type, ids })
    return res.json({ success: true, data, message: data.mock ? '本地判定完成（服务未启用）' : '智能判定完成' })
  } catch (error) {
    console.error('[Judgment] 判定失败:', error.message)
    return res.status(ERROR_STATUS[error.code] || 502).json({ success: false, message: error.message })
  }
}
