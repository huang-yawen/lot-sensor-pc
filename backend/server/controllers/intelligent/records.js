/**
 * 【接口】GET /api/intelligent/records —— 智能判定历史记录（分页，"智能判定记录"页专用）
 *
 * 请求 query：
 *   page       可选  默认 1
 *   pageSize   可选  默认 DEFAULT_PAGE_SIZE，最大 100
 *   d_no       可选  设备编号模糊匹配
 *   status     可选  'success' | 'failed' | 'mock' 精确匹配
 *   startTime / endTime  可选  按 c_time 闭区间
 *
 * 响应 200：{ success:true, data:{ list:[{ id, d_no, data_type, source_ids, conclusion,
 *                                        confidence, status, error_message, c_time }...],
 *                                  total, page, pageSize } }
 * 出错 500：{ success:false, message }
 *
 * 直接读 t_judgment_record（每次判定不管成败都会往里落一条，见 recognize.js）。
 */
const promisePool = require('../../config/dbPool')
const { ensureTable } = require('./recognize')
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
