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

module.exports = { firstValue, getDeviceNo, getReportedTime, getTopic, toWireValue, fromWireValue, aliases }
/**
 * 【文件职责】设备协议适配层。
 * 统一解析设备编号/时间字段，按 t_direct_config.preffix 组装控制载荷，并把页面值
 * 转为设备线上的值，业务代码不应再写死 mode、pump 等字段名。
 * 【配置中心关联】DEVICE_ID_FIELDS、TIME_FIELDS、CONTROL_VALUE_MAP、MQTT_TOPICS
 * 每次调用动态读取；t_direct_config.preffix 是每条指令的实际字段映射。
 */
