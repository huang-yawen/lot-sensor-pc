const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')

// 组装全局配置和设备配置的最终渲染结果。
module.exports = async (req, res) => {
    try {
        const d_no = req.query.d_no
        // 每次请求从系统配置中心读取，支持热更新
        const config = systemConfig.getConfig()
        const singleDeviceMode = config.SINGLE_DEVICE_MODE
        console.log(`[Backend Render] 接收到请求 d_no: ${d_no}, mode: ${singleDeviceMode ? '单设备' : '多设备'}`)

        const queryGlobal = `SELECT config_id, value FROM t_direct WHERE d_no IS NULL`
        const [globalResult] = await promisePool.query(queryGlobal)

        let deviceResult = []
        let targetDeviceId = null

        if (singleDeviceMode) {
            // ========== 单设备模式 ==========
            // 从 t_device 表获取第一个设备的编号
            const [deviceRows] = await promisePool.query(
                'SELECT `number` FROM `t_device` ORDER BY `id` ASC LIMIT 1'
            )
            if (deviceRows && deviceRows.length > 0) {
                targetDeviceId = String(deviceRows[0].number).trim()
            }
        } else {
            // ========== 多设备模式 ==========
            if (d_no && d_no !== 'null') {
                targetDeviceId = d_no
            }
        }

        if (targetDeviceId) {
            const queryDevice = `SELECT config_id, value FROM t_direct WHERE d_no = ?`
            ;[deviceResult] = await promisePool.query(queryDevice, [targetDeviceId])
        }

        const finalMap = new Map()

        // 先放全局默认值，再用设备专属值覆盖，得到最终渲染配置。
        globalResult.forEach((item) => {
            finalMap.set(String(item.config_id), item.value)
        })

        deviceResult.forEach((item) => {
            finalMap.set(String(item.config_id), item.value)
        })

        const finalResult = Array.from(finalMap, ([config_id, value]) => ({
            config_id: Number(config_id),
            value,
        }))

        console.log(
            `[Backend Render] 全局配置项数: ${globalResult.length}, 设备特定项数: ${deviceResult.length}, 合并后项数: ${finalResult.length}`
        )

        res.json({ success: true, data: finalResult, singleDeviceMode })
    } catch (err) {
        console.error('Backend /directRender 错误:', err)
        res.status(500).json({ success: false, message: 'Server error' })
    }
}
