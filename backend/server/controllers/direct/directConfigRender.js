/**
 * 【接口】GET /api/directRender —— 指令项的"当前值"（"设备设置"页右侧控件的初始值）
 *
 * 请求 query：d_no（多设备模式指定设备；单设备模式忽略，自动取默认设备）
 * 响应 200：{ success:true, singleDeviceMode:bool,
 *             data:[ { config_id:number, value:string }... ] }   // 全局值 + 设备专属值覆盖后的结果
 * 出错 500：{ success:false, message:'Server error' }
 *
 * 读 t_direct（当前值表）：先取 d_no IS NULL 的全局默认，再用该设备的专属值覆盖。
 * 【配置】SINGLE_DEVICE_MODE（config/appSettings.js）决定取默认设备还是按 d_no。
 */
const promisePool = require('../../config/dbPool')
const { SINGLE_DEVICE_MODE } = require('../../config/appSettings')
const { getDefaultDeviceId } = require('../../utils/mappedData')

module.exports = async (req, res) => {
    try {
        const d_no = req.query.d_no
        const singleDeviceMode = SINGLE_DEVICE_MODE
        console.log(`[DirectRender] 请求 d_no: ${d_no}, mode: ${singleDeviceMode ? '单设备' : '多设备'}`)

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
            `[DirectRender] 全局配置项数: ${globalResult.length}, 设备特定项数: ${deviceResult.length}, 合并后项数: ${finalResult.length}`
        )

        res.json({ success: true, data: finalResult, singleDeviceMode })
    } catch (err) {
        console.error('[DirectRender] 渲染失败:', err)
        res.status(500).json({ success: false, message: 'Server error' })
    }
}
