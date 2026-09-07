/**
 * 测试图表数据控制器
 * 
 * 返回适用于 LineBarCharts.vue 组件的模拟 ECharts 折线图数据。
 * LineBarCharts 组件期望的数据结构：
 * [
 *   {
 *     "创立时间": "2026-07-13T08:00:00.000Z",   // X 轴时间
 *     "温度(℃)": "25.3",                         // 数值字段1（折线1）
 *     "湿度(%)": "68.5",                         // 数值字段2（折线2）
 *     "气压(hPa)": "1013.2",                     // 数值字段3（折线3）
 *     ...
 *   },
 *   ...
 * ]
 */

module.exports = async (req, res) => {
    try {
        const count = parseInt(req.query.count) || 10; // 默认返回10条数据
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
