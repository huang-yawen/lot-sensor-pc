/**
 * 设备配置更新与MQTT发布服务
 * 负责将配置变更持久化到数据库，并通过MQTT协议下发到设备端
 */

const promisePool = require('../../config/promisepool')
const mqttClient = require('../../mqtt')
const { saveDirectData } = require('./saveDirectData')

// MQTT发布主题常量
const DEFAULT_DIRECT_TOPIC = 'direct'

/**
 * 查询配置项元信息
 * @param {number} configId - 配置项ID
 * @returns {Object|null} 配置项信息
 */
const getDirectConfig = async (configId) => {
    try {
        const [[config]] = await promisePool.query(
            `SELECT id, t_name, f_type, topic, preffix FROM t_direct_config WHERE id = ? LIMIT 1`,
            [configId]
        )
        return config || null
    } catch (err) {
        console.warn('查询配置元信息失败，使用默认主题:', err.message)
        return null
    }
}

/**
 * 根据发布状态构建提示消息
 * @param {string} status - 发布状态
 * @returns {string} 提示消息
 */
const buildMessage = (status) => {
    if (status === 'queued') return '配置保存成功。设备离线，消息已排队。'
    if (status === 'failed') return '配置保存成功。MQTT发送失败。'
    return '配置保存成功！'
}

/**
 * 主处理函数：保存配置并发布MQTT消息
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
module.exports = async (req, res) => {
    try {
        const { config_id, value, d_no } = req.body

        // 参数校验
        if (config_id === undefined || config_id === null || config_id === '') {
            return res.status(400).json({ success: false, message: 'config_id必填' })
        }

        console.log('[Direct Update] 开始保存配置:', { config_id, value, d_no })

        // 1. 保存到数据库
        const saveResult = await saveDirectData({ config_id, value, d_no })
        console.log('[Direct Update] 数据库保存成功:', saveResult)

        try {
            // 2. 查询配置元信息
            const config = await getDirectConfig(config_id)
            
            // 3. 构建MQTT主题和消息体
            const topic = DEFAULT_DIRECT_TOPIC
            const isGlobalConfig = saveResult.d_no === null  // 判断是否为全局配置
            const mode = isGlobalConfig ? 1 : 0               // mode=1:全局配置, mode=0:设备专属配置

            // 构建发送给设备的消息体
            const payload = {
                type: 'directSettingUpdate',  // 消息类型标识
                d_no: saveResult.d_no,        // 设备编号（全局配置时为null）
                config_id: Number(config_id), // 配置项ID
                value,                        // 配置值
                name: config?.t_name || null, // 配置名称
                f_type: config?.f_type || null,// 配置类型
                action: saveResult.action,     // 操作类型(update/insert)
                mode: mode,                   // 配置模式
                time: new Date().toISOString()// 时间戳
            }

            console.log('[Direct Update] MQTT配置:')
            console.log('  主题:', topic)
            console.log('  设备ID:', saveResult.d_no)
            console.log('  Payload:', JSON.stringify(payload, null, 2))
            console.log('  MQTT连接状态:', mqttClient.isConnected)

            if (!mqttClient.isConnected) {
                console.warn('[Direct Update] MQTT客户端未连接')
            }

            // 4. 发布MQTT消息（无论设备在线与否都发送）
            const publishResult = await mqttClient.publishJsonToDevice(saveResult.d_no, topic, payload, { qos: 1, retain: false })
            console.log('[Direct Update] MQTT发布结果:', publishResult)

            // 5. 返回成功响应
            res.json({
                success: true,
                message: buildMessage(publishResult.status),
                data: {
                    db: saveResult,
                    mqtt: publishResult
                }
            })
        } catch (err) {
            // MQTT发布失败不影响数据库保存结果
            console.error('[Direct Update] MQTT发布失败:', err.message)
            res.json({
                success: true,
                message: buildMessage('failed'),
                data: {
                    db: saveResult,
                    mqtt: { status: 'failed', reason: err.message }
                }
            })
        }
    } catch (err) {
        console.error('[Direct Update] 后端错误:', err)
        res.status(500).json({
            success: false,
            message: err.message || '保存配置失败'
        })
    }
}