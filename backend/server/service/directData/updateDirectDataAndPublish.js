const promisePool = require('../../config/promisepool')
const mqttClient = require('../../mqtt')
const { saveDirectData } = require('./saveDirectData')

const DEFAULT_DIRECT_TOPIC = 'direct'

const buildTopic = (config) => {
    const topic = config?.topic || DEFAULT_DIRECT_TOPIC
    const preffix = config?.preffix

    // 数据库可配置前缀和主题；缺省时统一发布到 direct。
    if (!preffix) return topic
    return `${String(preffix).replace(/\/$/, '')}/${String(topic).replace(/^\//, '')}`
}

module.exports = async (req, res) => {
    try {
        const { config_id, value, d_no } = req.body

        if (config_id === undefined || config_id === null || config_id === '') {
            return res.status(400).json({ success: false, message: 'config_id is required' })
        }

        const saveResult = await saveDirectData({ config_id, value, d_no })

        // 保存成功后读取指令配置，用配置里的 topic/preffix 组装 MQTT 主题。
        const [[config]] = await promisePool.query(
            `SELECT id, t_name, f_type, topic, preffix FROM t_direct_config WHERE id = ? LIMIT 1`,
            [config_id]
        )

        const topic = buildTopic(config)
        const payload = {
            type: 'directSettingUpdate',
            d_no: saveResult.d_no,
            config_id: Number(config_id),
            value,
            name: config?.t_name || null,
            f_type: config?.f_type || null,
            action: saveResult.action,
            time: new Date().toISOString()
        }

        // 让设备端能及时收到页面修改后的指令值。
        await mqttClient.publishJson(topic, payload, { qos: 1, retain: false })

        res.json({
            success: true,
            message: 'Configuration saved and MQTT message published successfully.',
            data: {
                db: saveResult,
                mqtt: { topic, payload }
            }
        })
    } catch (err) {
        console.error('Backend /directData/update error:', err)
        res.status(500).json({
            success: false,
            message: err.message || 'Server error'
        })
    }
}
