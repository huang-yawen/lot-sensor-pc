/**
 * 【接口】GET /api/dataByType —— 分页表格数据（传感器/行为，实时或保存数据）
 *
 * 请求 query：
 *   type          必填  'sensor' | 'behavior'      查哪张表
 *   dataScope     可选  'realtime' | 'saved'       实时数据 / 保存数据；不传=全部
 *   metricScope   可选  'realtime' | 'history'     派生指标按 show_realtime / show_history 过滤；
 *                                                  realtime 时值不拼单位（纯数值），history 时拼（"25.5 ℃"）
 *   page          可选  默认 1
 *   pageSize      可选  默认 DEFAULT_PAGE_SIZE，最大 100
 *   d_no / startTime / endTime  可选  设备、时间范围过滤
 *
 * 响应 200：
 *   { success:true, data:{ list:[行...], fieldUnits:{列名:单位}, chartSettings:{...}, total, page, size } }
 * 出错 500：{ success:false, message }
 *
 * 业务/SQL 全在 service/tableData/getTableData.js（首页 getDashboardData 也复用它）。
 */
const getTableData = require('../../service/tableData/getTableData')

module.exports = async (req, res) => {
    try {
        res.json(await getTableData(req.query))
    } catch (err) {
        console.error('[TableData] 分页查询失败:', err)
        res.status(500).json({ success: false, message: err.message })
    }
}
