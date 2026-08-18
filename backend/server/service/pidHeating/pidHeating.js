/**
 * 【文件职责】PID 恒温控制服务：把水温连续调节在目标温度 Tset，但加热模块只有开关量、
 * 没有功率输出，所以用“时间比例控制”模拟 PWM——固定一个周期 windowMs，PID 输出的
 * 占空比 duty(0~100%) 决定这个周期内加热开多久、关多久，而不是简单的全开/全关。
 *
 * 公式：u(k) = Kp·e(k) + Ki·Σe(k) + Kd·[e(k)-e(k-1)]，e(k) = Tset - Tnow（用 T1 进水温度）。
 * u(k) 限幅到 [0,100] 作为占空比；积分项用条件积分做简单抗饱和（占空比已经顶到上限/下限
 * 且误差还在同方向时，暂停累加积分，避免积分饱和）。
 *
 * 仅在“自动模式”下运行，且与 CONTROL_MODE（simple/layered）正交——只接管加热这一个执行器，
 * 水泵仍由 CONTROL_MODE 对应的模块决定；PID_HEATING.enabled=true 时，autoControl.js /
 * layeredControl.js 会跳过各自的加热下发，避免两边同时抢着控制加热。
 *
 * 【配置中心关联】PID_HEATING 每次评估动态读取，保存配置后立即生效。
 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')
const { firstValue, getTopic, buildSwitchPayload } = require('../../utils/protocol')
const { resolveDeviceNo, resolveFieldAliases } = require('../../utils/mappedData')
const { getDirectValue, saveDirectData } = require('../directData/saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory/saveOperationHistory')

/** 每个设备的 PID 状态：本周期起点、本周期加热应开的时长、积分项、上一次误差。 */
const stateMap = new Map()

/* ============================ 工具函数 ============================ */

async function resolveConfigIdByPrefix(prefix) {
  if (!prefix) return null
  const [rows] = await promisePool.query(
    "SELECT id FROM t_direct_config WHERE preffix IS NOT NULL AND preffix != '' AND LOWER(preffix) = LOWER(?) ORDER BY id ASC LIMIT 1",
    [prefix]
  )
  return rows[0]?.id ?? null
}

async function toNumber(raw) {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

async function getMode(deviceNo) {
  const configId = await resolveConfigIdByPrefix('mode')
  if (configId == null) return null
  const value = await getDirectValue({ config_id: configId, d_no: deviceNo })
  if (value == null) return null
  const v = String(value).trim().toLowerCase()
  if (['on', 'auto', 'open', '1', 'true'].includes(v)) return 'auto'
  if (['off', 'manual', 'close', '0', 'false'].includes(v)) return 'manual'
  return null
}

async function getTargetTemp(deviceNo, fallback) {
  const configId = await resolveConfigIdByPrefix('target_temperature')
  const value = configId != null
    ? await toNumber(await getDirectValue({ config_id: configId, d_no: deviceNo }))
    : null
  return value != null ? value : Number(fallback) || 22
}

async function readTemp1(info) {
  const aliases = await resolveFieldAliases('t_sensor_data', 'field1')
  return toNumber(firstValue(info, aliases))
}

async function readHeatOn(info) {
  const aliases = await resolveFieldAliases('t_behavior_data', 'field3')
  const raw = firstValue(info, aliases)
  if (raw == null) return null
  const s = String(raw).trim().toLowerCase()
  return ['on', 'open', '1', 'true'].includes(s)
}

async function findSwitchConfig(prefix, name) {
  const byPrefix = await resolveConfigIdByPrefix(prefix)
  const [rows] = await promisePool.query(
    `SELECT id, t_name, preffix, wire_template, wire_on_payload, wire_off_payload, f_type FROM t_direct_config
     WHERE f_type = '1' AND (id = ? OR t_name LIKE ?) ORDER BY (id = ?) DESC, id ASC LIMIT 1`,
    [byPrefix ?? -1, `%${name}%`, byPrefix ?? -1]
  )
  return rows[0] || null
}

async function setHeater(value, deviceNo, source) {
  const conf = await findSwitchConfig('heater', '加热')
  if (!conf) return false
  const mqttClient = require('../../mqtt')
  const payload = buildSwitchPayload(conf, value)
  if (!systemConfig.getConfig().SINGLE_DEVICE_MODE && deviceNo) payload.d_no = deviceNo
  await mqttClient.publish(getTopic('control'), payload, { qos: systemConfig.getConfig().MQTT_QOS })
  const oldValue = await getDirectValue({ config_id: conf.id, d_no: deviceNo })
  await saveDirectData({ config_id: conf.id, value, d_no: deviceNo })
  await saveOperationHistory({ d_no: deviceNo, config_id: conf.id, old_value: oldValue, new_value: value, source })
  console.log(`[PidHeating] 加热 -> ${value}（pid_heating），设备 ${deviceNo || '全局'}`)
  return true
}

function getState(deviceNo) {
  const key = deviceNo || 'global'
  if (!stateMap.has(key)) {
    stateMap.set(key, { windowStart: 0, onDurationMs: 0, integral: 0, lastError: 0, hasLastError: false })
  }
  return stateMap.get(key)
}

/* ============================ 主评估 ============================ */

async function evaluatePidHeating(info) {
  const rootConfig = systemConfig.getConfig()
  const config = rootConfig.PID_HEATING || {}
  if (config.enabled !== true) return []

  const deviceNo = String((await resolveDeviceNo(info)) || '').trim() || null
  const mode = await getMode(deviceNo)
  if (mode !== 'auto') return []

  const temp1 = await readTemp1(info)
  if (temp1 == null) return []
  const heatOn = await readHeatOn(info)
  const targetTemp = await getTargetTemp(deviceNo, config.targetTemp ?? 22)

  const windowMs = Number(config.windowMs) > 0 ? Number(config.windowMs) : 10000
  const kp = Number(config.kp) || 0
  const ki = Number(config.ki) || 0
  const kd = Number(config.kd) || 0

  const state = getState(deviceNo)
  const now = Date.now()

  // 周期到了（或第一次评估）：用当前误差重新计算本周期的加热占空比。
  if (now - state.windowStart >= windowMs) {
    const dtSec = windowMs / 1000
    const error = targetTemp - temp1
    const pTerm = kp * error
    const derivative = state.hasLastError ? (error - state.lastError) / dtSec : 0
    const dTerm = kd * derivative

    // 条件积分抗饱和：先用当前积分试算一次输出，若已经顶满上限/下限且误差还在同方向，
    // 说明继续累加积分只会加重饱和，暂停这次累加。
    const rawIntegral = state.integral + error * dtSec
    const uWithNewIntegral = pTerm + ki * rawIntegral + dTerm
    const saturatedHigh = uWithNewIntegral > 100 && error > 0
    const saturatedLow = uWithNewIntegral < 0 && error < 0
    if (!saturatedHigh && !saturatedLow) state.integral = rawIntegral

    const u = pTerm + ki * state.integral + dTerm
    const duty = Math.max(0, Math.min(100, u))

    state.windowStart = now
    state.onDurationMs = (duty / 100) * windowMs
    state.lastError = error
    state.hasLastError = true
    state.lastDuty = Number(duty.toFixed(1))
  }

  const elapsed = now - state.windowStart
  const desired = elapsed < state.onDurationMs ? 'on' : 'off'

  const actions = []
  if (heatOn !== null && heatOn !== (desired === 'on')) {
    await setHeater(desired, deviceNo, 'pid_heating')
    actions.push({ device: 'heater', action: desired, duty: state.lastDuty })
  }
  return actions
}

module.exports = { evaluatePidHeating }
