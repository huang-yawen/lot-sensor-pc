/** 【文件职责】设备协议转换工具：解析字段、映射控制值和组装 MQTT 载荷。
 * 【配置中心关联】DEVICE_ID_FIELDS、TIME_FIELDS、CONTROL_VALUE_MAP、MQTT_TOPICS 动态读取。 */
const systemConfig = require('../config/systemConfig')

function firstValue(source, candidates = []) {
  if (!source || typeof source !== 'object') return null
  const lookup = new Map(Object.entries(source).map(([key, value]) => [String(key).toLowerCase(), value]))
  for (const candidate of candidates) {
    const value = lookup.get(String(candidate).toLowerCase())
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return null
}

function getDeviceNo(info) {
  return firstValue(info, systemConfig.getConfig().DEVICE_ID_FIELDS)
}

function getReportedTime(info) {
  return firstValue(info, systemConfig.getConfig().TIME_FIELDS)
}

function getTopic(role) {
  return systemConfig.getConfig().MQTT_TOPICS[role]
}

function toWireValue(value) {
  const mapping = systemConfig.getConfig().CONTROL_VALUE_MAP || {}
  const key = String(value)
  return Object.prototype.hasOwnProperty.call(mapping, key) ? mapping[key] : value
}

function fromWireValue(value) {
  const mapping = systemConfig.getConfig().CONTROL_VALUE_MAP || {}
  const hit = Object.entries(mapping).find(([, wire]) => String(wire) === String(value))
  return hit ? hit[0] : value
}

function aliases(value) {
  return String(value || '').split(/[|,]/).map(item => item.trim()).filter(Boolean)
}

function parseWirePayload(config, raw, label) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`指令“${config.t_name || config.id}”的 ${label} 不是有效 JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`指令“${config.t_name || config.id}”的 ${label} 必须是 JSON 对象`)
  }
  return parsed
}

/**
 * 组装开关类指令（f_type=1）的下发 payload。
 * 优先用 t_direct_config.wire_on_payload / wire_off_payload：开、关各自存一份完整报文，
 * 原样下发，不做任何字段推断，方便直接在配置中心改指令（如 Modbus 透传协议里具体哪个
 * 字段代表开关，各设备可能不一样）。
 * 没配置新字段、但配置了旧的 wire_template 时，兼容旧逻辑：整份模板只把 crc 字段替换成
 * 1（开）或 0（关）。都没配置的开关走最初的 { [preffix]: 线上值 } 格式。
 * @param {{ id: number|string, t_name?: string, preffix?: string, wire_template?: string, wire_on_payload?: string, wire_off_payload?: string }} config
 * @param {*} value - 页面值，如 'on'/'off'
 */
function buildSwitchPayload(config, value) {
  const isOn = String(value).trim().toLowerCase() === 'on'
  const onRaw = String(config.wire_on_payload || '').trim()
  const offRaw = String(config.wire_off_payload || '').trim()
  if (onRaw || offRaw) {
    const raw = isOn ? onRaw : offRaw
    const label = isOn ? 'wire_on_payload' : 'wire_off_payload'
    if (!raw) throw new Error(`指令“${config.t_name || config.id}”未配置${isOn ? '开' : '关'}状态的 ${label}`)
    return parseWirePayload(config, raw, label)
  }

  const template = String(config.wire_template || '').trim()
  if (template) {
    const parsed = parseWirePayload(config, template, 'wire_template')
    return { ...parsed, crc: isOn ? 1 : 0 }
  }

  const key = String(config.preffix || '').trim()
  if (!key) throw new Error(`指令“${config.t_name || config.id}”未配置 MQTT 字段 preffix`)
  return { [key]: toWireValue(value) }
}

module.exports = { firstValue, getDeviceNo, getReportedTime, getTopic, toWireValue, fromWireValue, aliases, buildSwitchPayload }
/**
 * 【文件职责】设备协议适配层。
 * 统一解析设备编号/时间字段，按 t_direct_config.preffix 组装控制载荷，并把页面值
 * 转为设备线上的值，业务代码不应再写死 mode、pump 等字段名。
 * 【配置中心关联】DEVICE_ID_FIELDS、TIME_FIELDS、CONTROL_VALUE_MAP、MQTT_TOPICS
 * 每次调用动态读取；t_direct_config.preffix 是每条指令的实际字段映射。
 */
