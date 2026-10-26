/**
 * 【接口】GET /api/intelligent/records —— 智能判定历史记录（分页，"智能判定记录"页专用）
 *
 * 请求 query：
 *   page       可选  默认 1
 *   pageSize   可选  默认 DEFAULT_PAGE_SIZE，最大 100
 *   d_no       可选  设备编号模糊匹配（LIKE %值%）
 *   status     可选  精确匹配。能取的值就是判定落库时写的那些：
 *                   成功类 success / auto / realtime
 *                   占位类 mock / auto_mock / realtime_mock（本地占位判定，非真实结论）
 *                   失败类 failed（原因在 error_message 列）
 *   startTime / endTime  可选  按判定时间 c_time 的闭区间（前端是精确到秒的 datetime 选择器）
 *
 * 响应 200：{ success:true, data:{ list:[{ id, d_no, data_type, source_ids, conclusion,
 *                                        confidence, status, error_message, c_time }...],
 *                                  total, page, pageSize } }
 * 出错 500：{ success:false, message }
 *
 * 说明：
 *   · 直接读 t_judgment_record（记录在 service/intelligent/intelligentJudgment.js 的 saveRecord 里写入）；
 *   · 查询前先 ensureTable()，表不存在时自动建（首次部署不用手动建表）；
 *   · data_type 列区分这条记录是哪种判定：sensor / behavior / combined；
 *   · 想排查"判定服务到底收到了什么"，直接查 t_judgment_record 的 request_body / response_body
 *     （本接口为了列表轻量，没有把它们返回给前端）。
 *
 * 前端调用：src/views/JudgmentHistory.vue（菜单「智能判定记录」，显隐由
 * INTELLIGENT_JUDGMENT.showHistoryMenu 控制）；自测：
 *   curl "http://127.0.0.1:3000/api/intelligent/records?page=1&pageSize=5&status=mock"
 */
const promisePool = require('../../config/dbPool')
const { ensureTable } = require('../../service/intelligent/intelligentJudgment')
const { DEFAULT_PAGE_SIZE } = require('../../config/appSettings')

module.exports = async (req, res) => {
  try {
    await ensureTable()
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || DEFAULT_PAGE_SIZE))
    const where = []
    const values = []
    if (req.query.d_no) { where.push('d_no LIKE ?'); values.push(`%${req.query.d_no}%`) }
    if (req.query.status) { where.push('status = ?'); values.push(req.query.status) }
    if (req.query.startTime) { where.push('c_time >= ?'); values.push(req.query.startTime) }
    if (req.query.endTime) { where.push('c_time <= ?'); values.push(req.query.endTime) }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : ''
    const [[count]] = await promisePool.query(`SELECT COUNT(*) AS total FROM t_judgment_record${clause}`, values)
    const [list] = await promisePool.query(
      `SELECT id, d_no, data_type, source_ids, conclusion, confidence, status, error_message, c_time
       FROM t_judgment_record${clause} ORDER BY c_time DESC, id DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize]
    )
    res.json({ success: true, data: { list, total: count.total, page, pageSize } })
  } catch (error) {
    res.status(500).json({ success: false, message: `查询判定记录失败: ${error.message}` })
  }
}
