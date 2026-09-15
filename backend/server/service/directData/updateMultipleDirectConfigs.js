/** 【文件职责】批量更新控制配置服务。
 * 【配置】单条下发时读取 MQTT_TOPICS、CONTROL_VALUE_MAP 等最新配置。 */
const promisePool = require('../../config/dbPool')
const { saveDirectData } = require('./saveDirectConfig')
const { SINGLE_DEVICE_MODE } = require('../../config/appSettings')
const { isAnyLocked, isLockedByFault } = require('../faultStatus/faultStatus')

// 批量更新复用单条保存逻辑，确保权限校验、离线暂存和发布规则完全一致。
module.exports = async (req, res) => {
    try {
        const { config_id, value, d_no } = req.body
        console.log(`[Backend Update] receive config_id: ${config_id}, value: ${value}, d_no: ${d_no}`)

        // 故障锁定期间开关类指令项（f_type=1）一律不许改，跟 updateDirectConfigAndPublish.js
        // 单条下发的锁定拦截同一个口径；数值类指令项故障期间照常允许改。
        const [[conf]] = await promisePool.query('SELECT f_type FROM t_direct_config WHERE id = ? LIMIT 1', [config_id])
        if (conf && String(conf.f_type) === '1') {
            const lockDNo = (d_no && d_no !== 'null' && d_no !== 'undefined') ? String(d_no).trim() : null
            if (SINGLE_DEVICE_MODE ? isAnyLocked() : isLockedByFault(lockDNo)) {
                console.warn(`[Backend Update] 指令 ${config_id} 被故障锁定拒绝`)
                return res.status(403).json({
                    success: false,
                    message: '系统处于故障态，指令页面已锁定，请先把复位按钮拨到"关"以恢复',
                    data: { status: 'locked' }
                })
            }
        }

        // 复用单条保存逻辑，保证普通保存和 MQTT 保存的数据库行为一致。
        const result = await saveDirectData({ config_id, value, d_no })

        if (result.action === 'insert') {
            console.log('[Backend Update] inserted device config')
        } else if (result.action === 'update') {
            console.log('[Backend Update] updated existing config')
        } else {
            console.warn('[Backend Update] no row changed')
        }

        // direct_data_updated 由 saveDirectData 写库后统一广播（见 app.js onDirectDataChanged），这里不再单独发。
        res.json({ success: true, message: 'Configuration saved successfully.' })
    } catch (err) {
        console.error('Backend /multipleDirectData error:', err)
        res.status(500).json({ success: false, message: 'Server error' })
    }
}
