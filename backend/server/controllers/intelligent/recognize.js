/**
 * 智能判定 - Mock 接口
 * 接收勾选的传感器/行为数据 ID，返回模拟识别结果
 * 后续等组委会通知后替换为真实接口
 */
module.exports = async (req, res) => {
    try {
        const { type, ids } = req.body

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: '请提供需要识别的数据 ID' })
        }

        console.log(`[Intelligent] 收到识别请求: type=${type}, ids=${JSON.stringify(ids)}`)

        // Mock 识别结果——模拟返回每条数据的识别结论
        const mockResults = ids.map((id, index) => {
            const possibilities = ['正常', '异常', '需检修', '故障', '注意观察']
            return {
                id,
                result: possibilities[index % possibilities.length],
                confidence: Number((0.75 + Math.random() * 0.24).toFixed(2)),
                detail: `传感器 #${id} 数据分析完成，当前状态判定为"${possibilities[index % possibilities.length]}"`
            }
        })

        // 统计汇总
        const summary = {
            total: ids.length,
            normal: mockResults.filter(r => r.result === '正常').length,
            abnormal: mockResults.filter(r => r.result !== '正常').length,
        }

        res.json({
            success: true,
            data: {
                results: mockResults,
                summary
            },
            message: '识别完成'
        })
    } catch (err) {
        console.error('[Intelligent] 识别失败:', err)
        res.status(500).json({ success: false, message: err.message })
    }
}