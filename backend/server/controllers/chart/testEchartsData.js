/**
 * 【接口】GET /api/testChartData —— 造一批假的 xdata/ydata，用来单独调 ECharts 绑定（跟真实数据无关）
 *
 * 请求 query：count（可选，默认 10，最大 200）
 * 响应 200：{ success:true, total, data:{ xdata:["13:00","13:05",...], ydata:[25.3, 26.1, ...] } }
 * 出错 500：{ success:false, message }
 */

module.exports = async (req, res) => {
    try {
        const count = Math.min(parseInt(req.query.count) || 10, 200)
        const now = new Date()
        const baseValue = 25
        const xdata = []
        const ydata = []

        for (let i = 0; i < count; i++) {
            const time = new Date(now.getTime() - (count - i) * 300000)
            xdata.push(time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
            // 正弦波生成平滑曲线，范围 20~30
            const value = baseValue + Math.sin(i * 0.5) * 5 + (Math.random() - 0.5) * 1.5
            ydata.push(parseFloat(value.toFixed(1)))
        }

        res.json({
            success: true,
            data: { xdata, ydata },
            total: count,
        })
    } catch (err) {
        console.error('获取 ECharts 测试数据失败:', err)
        res.status(500).json({ success: false, message: err.message })
    }
}
