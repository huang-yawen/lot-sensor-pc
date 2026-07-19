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
