/** 【文件职责】控制配置树 API 控制器。
 * 【配置中心关联】无直接读取；preffix 元数据可由场景导入维护。 */
const getDirectConfigTree = require('../../service/directData/getDirectConfigTree')

// 控制器只负责接收请求、调用 service，然后返回 JSON。
module.exports = async (req, res) => {
    try {
        const payload = await getDirectConfigTree(req.query)
        res.json(payload)
    } catch (err) {
        console.log('directData 出错：' + err)
        res.status(500).json({
            success: false,
            message: '获取数据失败',
        })
    }
}
