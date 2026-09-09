// 安全验证：拦截 MQTT publish（不真发设备），测试定时触发逻辑
const mqttClient = require('./mqtt')
const published = []
mqttClient.publish = async (topic, payload) => { published.push({ topic, payload }); return { status: 'published' } }

const { tick } = require('./service/schedule/scheduleService')
const { saveDirectData, getDirectValue } = require('./service/directData/saveDirectConfig')
const { getDefaultDeviceId } = require('./utils/mappedData')

const pad = n => String(n).padStart(2, '0')
const fmt = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

;(async () => {
  const deviceNo = await getDefaultDeviceId()
  const TIME_CFG = 52      // 水泵开启时间 pump:on
  const PUMP_CFG = 10      // 水泵开关
  // 备份原值
  const origTime = await getDirectValue({ config_id: TIME_CFG, d_no: deviceNo })
  const origPump = await getDirectValue({ config_id: PUMP_CFG, d_no: deviceNo })
  console.log('备份：时间值=', origTime, ' 水泵开关值=', origPump)

  const setTime = async (d) => { await saveDirectData({ config_id: TIME_CFG, value: fmt(d), d_no: deviceNo }) }

  // 场景 A：未来 90 秒（未到点）→ 不应触发
  published.length = 0
  await setTime(new Date(Date.now() + 90000))
  await tick()
  console.log('A 未来90秒: 触发次数 =', published.length, '(期望 0)')

  // 场景 B：过去 30 秒（在 120 秒宽限内）→ 应触发 1 次
  published.length = 0
  await setTime(new Date(Date.now() - 30000))
  await tick()
  console.log('B 过去30秒(宽限内): 触发次数 =', published.length, '(期望 1)', 'payload =', JSON.stringify(published.map(p => p.payload)))

  // 场景 C：再跑一次（当天去重）→ 不应重复触发
  published.length = 0
  await tick()
  console.log('C 重复tick去重: 触发次数 =', published.length, '(期望 0)')

  // 恢复
  await saveDirectData({ config_id: TIME_CFG, value: origTime || '', d_no: deviceNo })
  await saveDirectData({ config_id: PUMP_CFG, value: origPump || 'off', d_no: deviceNo })
  console.log('已恢复时间值和水泵开关值')
  process.exit(0)
})().catch(e => { console.error('ERR:', e.message, e.stack); process.exit(1) })
