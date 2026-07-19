/**
 * 操作历史 API 控制器
 * GET    /api/operation-history         — 获取操作历史列表（分页）
 * GET    /api/operation-history/configs — 获取指令配置下拉选项
 */

const promisePool = require('../../config/dbPool')
const { getOperationHistory } = require('../../service/operationHistory/getOperationHistory')
const { ensureOperationHistoryTable } = require('../../service/operationHistory/saveOperationHistory')

// GET /api/operation-history — 获取操作历史列表
const getHistoryList = async (req, res) => {
  try {
    const { currentPage = 1, pageSize = 10, config_id, startTime, endTime } = req.query
    const result = await getOperationHistory({
      currentPage: Number(currentPage),
      pageSize: Number(pageSize),
      config_id: config_id !== undefined && config_id !== null && config_id !== '' ? Number(config_id) : null,
      startTime: startTime || null,
      endTime: endTime || null
    })
    res.json({
      success: true,
      data: {
        list: result.rows,
        total: result.total,
        currentPage: Number(currentPage),
        pageSize: Number(pageSize)
      }
    })
  } catch (err) {
    console.error('[OperationHistory] 查询失败:', err.message)
    res.status(500).json({
      success: false,
      message: '查询操作历史失败: ' + err.message
    })
  }
}

// GET /api/operation-history/configs — 获取指令配置下拉选项
const getConfigOptions = async (req, res) => {
  try {
    await ensureOperationHistoryTable()
    const [rows] = await promisePool.query(
      `SELECT id, t_name FROM t_direct_config ORDER BY id ASC`
    )
    const options = rows.map(r => ({
      value: r.id,
      label: r.t_name
    }))
    res.json({
      success: true,
      data: options
    })
  } catch (err) {
    console.error('[OperationHistory] 获取指令配置选项失败:', err.message)
    res.status(500).json({
      success: false,
      message: '获取指令配置选项失败: ' + err.message
    })
  }
}

module.exports = {
  getHistoryList,
  getConfigOptions
}
