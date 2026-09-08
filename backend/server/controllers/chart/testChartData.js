/**
 * 【接口】GET /api/chart/test-data —— 造一批假数据，用来单独调 LineBarCharts.vue（跟真实数据无关）
 *
 * 请求 query：count（可选，默认 10）
 * 响应 200：{ success:true, total, data:[ { "创立时间":ISO字符串, "温度(℃)":..., "湿度(%)":..., ... }... ] }
 *           每行一个对象，"创立时间" 是 X 轴，其余数值字段各画一条折线。
 * 出错 500：{ success:false, message }
 */

module.exports = async (req, res) => {
    try {
        const count = parseInt(req.query.count) || 10
        const now = new Date();

        // 生成模拟数据
        const mockData = [];
        for (let i = 0; i < count; i++) {
            const time = new Date(now.getTime() - (count - i) * 3600000); // 每隔1小时一条数据
            mockData.push({
                "创立时间": time.toISOString(),
                "温度(℃)": (20 + Math.sin(i * 0.5) * 5 + Math.random() * 2).toFixed(1),
                "湿度(%)": (60 + Math.cos(i * 0.3) * 10 + Math.random() * 3).toFixed(1),
                "气压(hPa)": (1013 + Math.sin(i * 0.2) * 2 + Math.random() * 1).toFixed(1),
                "风速(m/s)": (3 + Math.sin(i * 0.7) * 2 + Math.random() * 1).toFixed(1),
                "光照(lux)": (800 + Math.sin(i * 0.4) * 200 + Math.random() * 100).toFixed(0),
            });
        }

        res.json({
            success: true,
            data: mockData,
            total: mockData.length,
        });
    } catch (err) {
        console.error('获取测试图表数据失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};
