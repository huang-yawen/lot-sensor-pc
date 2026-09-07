/** 【文件职责】传感器/行为表格数据 API 控制器，是分页表格页面（传感器汇总数据、
 * 行为汇总数据、传感器实时数据、行为实时数据）的统一 HTTP 入口。
 * 通过 type 参数切换数据表，dataScope 区分实时/保存数据范围，metricScope 区分
 * 实时/历史派生指标过滤维度。控制器只负责接收请求、调用 service，然后返回 JSON。
 * 【配置中心关联】无直接读取；入库解析使用 TIME_FIELDS。 */
const getTableData = require('../../service/tableData/getTableData')

// 控制器只负责接收请求、调用 service，然后返回 JSON。
module.exports = async (req, res) => {
    try {
        const payload = await getTableData(req.query)
        res.json(payload)
    } catch (err) {
        console.error('分页查询失败:', err)
        res.status(500).json({ success: false, message: err.message })
    }
}
