/** 【文件职责】控制项渲染 API：合并全局和设备专属 t_direct_config 值。
 * 【配置中心关联】SINGLE_DEVICE_MODE 每次请求读取，决定设备选择方式。 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')
const { getDefaultDeviceId } = require('../../utils/mappedData')

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
            // 跟指令保存路径（updateDirectConfigAndPublish.js）统一用 getDefaultDeviceId()
            // 取默认设备号：以前这里自己查 t_device.number，保存路径查的是 t_device.d_no，
            // 两个字段值不一致时保存和回显各自认的设备号对不上，指令保存成功但页面上
            // 一直显示不出来（回退成默认值）。
            targetDeviceId = await getDefaultDeviceId()
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
