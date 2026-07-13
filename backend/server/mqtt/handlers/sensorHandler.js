/**
 * 传感器数据处理器
 * 
 * 收到传感器数据后，解析并存入数据库
 */

const promisePool = require('../../config/dbPool')

/** 传感器数据主题 */
const SENSOR_TOPIC = 'sensor_data'

/**
 * 处理传感器数据消息
 * @param {string} topic - 主题
 * @param {Buffer} payload - 消息内容
 * @returns {Promise<Object|null>} 处理后的数据
 */
async function handleSensorData(topic, payload) {
  try {
    const data = JSON.parse(payload.toString())
    console.log('[SensorHandler] 收到传感器数据:', JSON.stringify(data).slice(0, 200))

    // 存入数据库
    const { d_no, ...fields } = data
    if (d_no) {
      const columns = Object.keys(fields)
      const values = Object.values(fields)
      const placeholders = columns.map(() => '?').join(', ')
      const colNames = columns.join(', ')

      try {
        const [result] = await promisePool.query(
          `INSERT INTO t_sensor_realtime (d_no, ${colNames}) VALUES (?, ${placeholders})`,
          [d_no, ...values]
        )
        console.log('[SensorHandler] 数据存储成功:', {
          d_no,
          insertId: result.insertId,
          fields: JSON.stringify(fields)
        })
      } catch (dbErr) {
        console.error('[SensorHandler] 数据存储失败:', {
          d_no,
          fields: JSON.stringify(fields),
          error: dbErr.message,
          stack: dbErr.stack
        })
        return null
      }
    }

    return data
  } catch (err) {
    console.error('[SensorHandler] 处理失败:', {
      error: err.message,
      stack: err.stack,
      rawPayload: payload ? payload.toString().slice(0, 200) : 'empty'
    })
    return null
  }
}

module.exports = { handleSensorData, SENSOR_TOPIC }