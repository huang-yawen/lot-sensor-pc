/**
 * 【接口】GET /api/directData —— 指令配置树（"设备设置"页左侧的指令项层级结构）
 *
 * 请求：无参数
 * 响应 200：{ success:true, data:[ 指令项节点... ] }
 *           节点含 id / t_name / preffix / f_type / 子节点，按父子关系组织成树。
 * 出错 500：{ success:false, message:'获取数据失败' }
 *
 * 只读 t_direct_config（指令项的"定义"，不含当前值；当前值走 /api/directRender）。
 * 组装在 service/directData/getDirectConfigTree.js。
 */
const getDirectConfigTree = require('../../service/directData/getDirectConfigTree')

module.exports = async (req, res) => {
    try {
        res.json(await getDirectConfigTree(req.query))
    } catch (err) {
        console.error('[DirectConfig] 获取指令配置树失败:', err)
        res.status(500).json({ success: false, message: '获取数据失败' })
    }
}
