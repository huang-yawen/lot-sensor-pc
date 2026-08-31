/** 【文件职责】传感器/行为汇总数据 API 控制器（文件名沿用旧称，项目里已没有独立的
 * "历史数据"概念，只有"实时数据/保存数据"这一对标签）。
 * 【配置中心关联】无直接读取；入库解析使用 TIME_FIELDS。 */
const getHistoryDataByType = require('../../service/historyData/getHistoryDataByType')

// 控制器只负责接收请求、调用 service，然后返回 JSON。
module.exports = async (req, res) => {
    try {
        const payload = await getHistoryDataByType(req.query)
        res.json(payload)
    } catch (err) {
        console.error('分页查询失败:', err)
        res.status(500).json({ success: false, message: err.message })
    }
}
/** 【文件职责】传感器/行为汇总数据 HTTP 接口，校验筛选条件后查询数据表。
 * 【配置中心关联】TIME_FIELDS 影响入库解析；本接口只读取已规范化的数据。 */
