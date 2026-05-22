const { saveDirectData } = require('./saveDirectData')

module.exports = async (req, res) => {
    try {
        const { config_id, value, d_no } = req.body
        console.log(`[Backend Update] receive config_id: ${config_id}, value: ${value}, d_no: ${d_no}`)

        // 复用单条保存逻辑，保证普通保存和 MQTT 保存的数据库行为一致。
        const result = await saveDirectData({ config_id, value, d_no })

        if (result.action === 'insert') {
            console.log('[Backend Update] inserted device config')
        } else if (result.action === 'update') {
            console.log('[Backend Update] updated existing config')
        } else {
            console.warn('[Backend Update] no row changed')
        }

        res.json({ success: true, message: 'Configuration saved successfully.' })
    } catch (err) {
        console.error('Backend /multipleDirectData error:', err)
        res.status(500).json({ success: false, message: 'Server error' })
    }
}
