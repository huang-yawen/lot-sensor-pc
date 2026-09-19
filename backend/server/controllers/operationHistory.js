/**
 * 【文件职责】"操作历史"页面的 2 个 HTTP 接口。业务/SQL 在 service/operationHistory.js（读 t_operation_history）。
 * 前端 OperationHistory.vue 直接调（没走 store）。
 *
 *  GET /api/operation-history          getHistoryList   分页列表
 *    query { currentPage?=1, pageSize?, config_id?（按指令项筛选）, startTime?, endTime? }
 *    → { success:true, data:{ list:[{ id, 设备编号, 操作名称, 旧值, 新值, 来源, 操作时间 }...],
 *                             total, currentPage, pageSize } }
 *    旧值/新值在 service 层已按 t_direct_config.f_value 转成「关/开」这类文案——
 *    设备上报路径存的是 0/1、软件下发路径存的是 on/off，这里返回时已经是统一的展示值。
 *  GET /api/operation-history/configs  getConfigOptions 指令项下拉选项（筛选用）
 *    → { success:true, data:[{ value:config_id, label:t_name }...] }
 *
 *  出错 500 { success:false, message }。
 * 【配置】读 DEFAULT_PAGE_SIZE（config/appSettings.js）。
 */
const promisePool = require('../config/dbPool')
const { getOperationHistory, ensureOperationHistoryTable } = require('../service/operationHistory')
const { DEFAULT_PAGE_SIZE } = require('../config/appSettings')

// GET /api/operation-history — 获取操作历史列表
const getHistoryList = async (req, res) => {
  try {
    const { currentPage = 1, config_id, startTime, endTime } = req.query
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || DEFAULT_PAGE_SIZE))
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

module.exports = { getHistoryList, getConfigOptions }
