/** 【文件职责】设备协议转换工具：解析字段、映射控制值和组装 MQTT 载荷。
 * 【配置中心关联】DEVICE_ID_FIELDS、TIME_FIELDS、CONTROL_VALUE_MAP、MQTT_TOPICS 动态读取。 */
const systemConfig = require('../config/systemConfig')

/**
 * 从一个对象里按候选字段名列表依次找第一个"有效值"（不是 undefined/null/
 * 空字符串），大小写不敏感。设备上报的字段名可能是各种写法（d_no、D_NO、
 * deviceNo...），candidates 通常来自配置中心的别名列表（比如
 * DEVICE_ID_FIELDS、字段映射表里的多别名字符串），不用为每种大小写写法
 * 各判断一次。
 * @param {Object} source - 要从里面找值的对象（比如一条 MQTT 消息）
 * @param {Array<string>} candidates - 候选字段名，按顺序找，第一个命中的就用
 * @returns {*} 找到的值；都没找到，或者对象本身不合法，返回 null
 */
function firstValue(source, candidates = []) {
  if (!source || typeof source !== 'object') return null
  const lookup = new Map(Object.entries(source).map(([key, value]) => [String(key).toLowerCase(), value]))
  for (const candidate of candidates) {
    const value = lookup.get(String(candidate).toLowerCase())
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return null
}

/** 从上报消息里解析出设备编号，候选字段名来自配置中心 DEVICE_ID_FIELDS。 */
function getDeviceNo(info) {
  return firstValue(info, systemConfig.getConfig().DEVICE_ID_FIELDS)
}

/** 从上报消息里解析出设备上报时间，候选字段名来自配置中心 TIME_FIELDS。 */
function getReportedTime(info) {
  return firstValue(info, systemConfig.getConfig().TIME_FIELDS)
}

/** 按角色（sensor/behavior/control/heartbeat）查对应的 MQTT 主题名，主题名
 * 本身在配置中心 MQTT_TOPICS 里维护，改了主题不用改代码。 */
function getTopic(role) {
  return systemConfig.getConfig().MQTT_TOPICS[role]
}

/**
 * 把"页面/代码里用的值"转换成"设备线上实际认的值"。多数情况下两者是同一个
 * 东西（页面上点"开"、线上传的也是 'on'），但有些设备协议线上传的是别的
 * 值（比如数字 1/0），这种映射关系配置在 CONTROL_VALUE_MAP 里，没配置映射
 * 的值原样透传，不强制要求所有值都配一遍映射。
 */
function toWireValue(value) {
  const mapping = systemConfig.getConfig().CONTROL_VALUE_MAP || {}
  const key = String(value)
  return Object.prototype.hasOwnProperty.call(mapping, key) ? mapping[key] : value
}

/** toWireValue 的反向操作：把设备上报的线上值转换回页面/代码里用的值，
 * 在映射表里反查不到时原样返回（说明设备上报的就是可以直接使用的值）。 */
function fromWireValue(value) {
  const mapping = systemConfig.getConfig().CONTROL_VALUE_MAP || {}
  const hit = Object.entries(mapping).find(([, wire]) => String(wire) === String(value))
  return hit ? hit[0] : value
}

/** 把字段映射表里用 "|" 或 "," 分隔的多别名字符串（比如
 * "d_no|device_id,deviceNo"）拆成数组，去掉多余空白和空字符串项，
 * 供 firstValue 的 candidates 参数使用。 */
function aliases(value) {
  return String(value || '').split(/[|,]/).map(item => item.trim()).filter(Boolean)
}

/** 把指令配置里存的 wire_template/wire_on_payload/wire_off_payload 这类 JSON
 * 字符串解析成对象，格式不对时抛出带具体指令名称的错误，方便一眼看出是
 * 哪条指令的哪个字段在配置中心填错了。 */
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
