/**
 * 【文件职责】安全联锁（安全锁联）服务。
 *
 * 触发任一启用条件时，自动关闭水泵和加热，并把告警写入 t_error_msg。
 * 条件均可通过配置中心 SAFETY_INTERLOCK 独立开关：
 *   1. 流量低于下限阈值或流量为 0
 *   2. 压力高于上限阈值或压力为 0
 *   3. 任一温度高于上限阈值
 *   4. 温差过大（> tempDiffThreshold）
 *   5. 进入手动模式（自动 -> 手动切换时安全关闭一次）
 *   6. 任一传感器数值掉线（长期无数据上报 / 长期为 0 / 异常最大值）
 *   7. 没打开水泵却打开了加热（水泵、加热开关状态均明确上报时才判断，避免消息里
 *      缺行为字段时误触发）
 *
 * 阈值不是写死的，而是从指令中心 t_direct 实时读取（按 preffix 或名称匹配
 * t_direct_config），用户在页面上改阈值后立即生效。
 *
 * 模式语义：安全联锁在自动和手动模式下全程生效——触发任一启用条件都会强制关闭
 * 水泵和加热，并写入告警。区别在于：
 *   - 自动模式：自动控制（正常状况联动）按目标温度启停水泵/加热，安全联锁全程保护。
 *   - 手动模式：人工下发指令单独开关水泵/加热，但安全联锁不失效（如手动强制开加热、
 *     检测到无水流时仍会强制关闭加热），仅“进入手动模式”这一刻会额外安全关闭一次。
 *
 * 【配置中心关联】SAFETY_INTERLOCK 每次评估动态读取，保存配置后立即生效。
 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')
const { firstValue, getTopic, buildSwitchPayload } = require('../../utils/protocol')
const { resolveDeviceNo, resolveFieldAliases } = require('../../utils/mappedData')
const { saveDirectData, getDirectValue } = require('../directData/saveDirectConfig')
const { getCurrentMode } = require('../directData/getControlMode')
const { saveOperationHistory } = require('../operationHistory/saveOperationHistory')
const { nowLocalDateTime } = require('../../utils/helper')
// 流量波动阈值支持现场在指令中心调（preffix=flow_volatility），删掉就退回配置中心。
const { getNumberValue, getAbnormalMax } = require('../controlShared/controlHelpers')

// 传感器掉线或短路时，很多硬件驱动不会直接不上报数据，而是把读数钳位成一个固定的
// 极端大值（比如 9999）。这里用这个哨兵值单独识别"掉线/短路"这种情况，跟"读数超过
// 正常阈值"区分开。哨兵值本身在 controlHelpers.js/getAbnormalMax() 统一维护
// （可在配置中心 SAFETY_INTERLOCK.abnormalMax 调），linkageRules.js 也用同一处。

/** 各阈值对应的 t_direct_config 标识（优先 preffix，其次中文名）。 */
const THRESHOLD_SLOTS = {
  tempHigh: { prefix: 'temp_high', name: '温度上限阈值' },
  tempLow: { prefix: 'temp_low', name: '温度下限阈值' },
  flowLow: { prefix: 'flow_low', name: '流量下限阈值' },
  flowHigh: { prefix: 'flow_high', name: '流量上限阈值' },
  pressureLow: { prefix: 'pressure_low', name: '压力下限阈值' },
  pressureHigh: { prefix: 'pressure_high', name: '压力上限阈值' },
}

/** 对每个设备记录上一次的控制模式，用于识别“自动 -> 手动”切换。 */
const lastMode = new Map()
/** 告警/联锁冷却时间戳，避免同一故障高频重复触发。 */
const lastFired = new Map()

/** 每个设备最近若干个流量读数的滑动窗口，用于判断流量波动幅度（疑似水锤/湍流）。 */
const flowWindowMap = new Map()

/** 窗口大小（点数）：默认 10，可在配置中心 SAFETY_INTERLOCK.flowVolatilityWindow 调整；
 * 没配置或不是 >=2 的整数时退回默认值 10。跟"累计与滑动统计"页里 flow_volatility
 * 这个历史图表指标各自独立维护，不是同一份状态（那边查数据库算历史曲线，这里是
 * 实时联锁用内存滑动窗口判断），窗口大小不要求两边一致。 */
function getFlowVolatilityWindow() {
  const v = Number(systemConfig.getConfig().SAFETY_INTERLOCK?.flowVolatilityWindow)
  return Number.isInteger(v) && v >= 2 ? v : 10
}

/** 追加一个新读数到滑动窗口，超出窗口大小就丢弃最早的一个；窗口还没填满设定的点数时
 * 返回 null（数据不够，不判断，避免设备刚上线就误报），填满后返回窗口内最大值-
 * 最小值，即这段时间流量的波动幅度。 */
function trackFlowVolatility(deviceNo, flow) {
  const key = deviceNo || 'global'
  if (!flowWindowMap.has(key)) flowWindowMap.set(key, [])
  const window = flowWindowMap.get(key)
  const windowSize = getFlowVolatilityWindow()
  window.push(flow)
  if (window.length > windowSize) window.shift()
  if (window.length < windowSize) return null
  return Math.max(...window) - Math.min(...window)
}

/** 掉线监测定时器（条件 6）。 */
let monitorTimer = null

/* ============================ 工具函数 ============================ */

async function resolveConfigIdByPrefix(prefix) {
  if (!prefix) return null
  const [rows] = await promisePool.query(
    "SELECT id FROM t_direct_config WHERE preffix IS NOT NULL AND preffix != '' AND LOWER(preffix) = LOWER(?) ORDER BY id ASC LIMIT 1",
    [prefix]
  )
  return rows[0]?.id ?? null
}

/** 按 preffix 查阈值指令项的 config_id。所有指令项都有 preffix，不再需要 t_name 兜底。 */
async function resolveThresholdConfigId(slot) {
  const def = THRESHOLD_SLOTS[slot]
  if (!def) return null
  return resolveConfigIdByPrefix(def.prefix)
}

async function toNumber(raw) {
  if (raw == null || raw === '') return null
  const num = Number(raw)
  return Number.isFinite(num) ? num : null
}

/** 读取指令中心某一阈值槽位的当前值（设备专属优先，其次全局）。 */
async function getThresholdValue(slot, deviceNo) {
  const configId = await resolveThresholdConfigId(slot)
  if (configId == null) return null
  return toNumber(await getDirectValue({ config_id: configId, d_no: deviceNo }))
}

/** 从一条上报消息中读取传感器数值（按字段映射表解析物理名）。 */
async function readSensors(info) {
  const result = {}
  // SENSOR_FIELD_MAP 来自配置中心，不能在模块顶层缓存（要求实时取值，热更新才能生效）。
  for (const [key, field] of Object.entries(systemConfig.getConfig().SENSOR_FIELD_MAP)) {
    const aliases = await resolveFieldAliases('t_sensor_data', field)
    result[key] = await toNumber(firstValue(info, aliases))
  }
  return result
}

/** 读取水泵/加热开关的设备上报状态（跟 linkageRules.js 保持一致）。 */
async function readSwitchStates(info) {
  const pumpAliases = await resolveFieldAliases('t_behavior_data', 'field1')
  const heatAliases = await resolveFieldAliases('t_behavior_data', 'field2')
  const toOn = v => {
    if (v == null) return null
    const s = String(v).trim().toLowerCase()
    return ['on', 'open', '1', 'true'].includes(s)
  }
  return { pumpOn: toOn(firstValue(info, pumpAliases)), heatOn: toOn(firstValue(info, heatAliases)) }
}

/** 按 preffix 找开关类（f_type=1）配置。所有开关都有 preffix，不再需要 t_name LIKE 兜底。 */
async function findSwitchConfig(prefix) {
  const configId = await resolveConfigIdByPrefix(prefix)
  if (configId == null) return null
  const [rows] = await promisePool.query(
    `SELECT id, t_name, preffix, wire_template, wire_on_payload, wire_off_payload, f_type FROM t_direct_config
     WHERE id = ? AND f_type = '1' LIMIT 1`,
    [configId]
  )
  return rows[0] || null
}

/* ============================ 告警与联锁 ============================ */

async function recordAlarm(deviceNo, trigger, interlocked) {
  // 使用本地时区时间，避免 toISOString() 的 UTC 时差（8小时偏差）
  const time = nowLocalDateTime()
  const suffix = interlocked
    ? '，已执行安全联锁（关闭水泵和加热）'
    : '，安全联锁已记录（未执行关闭）'
  const message = `${trigger.name}${suffix}，${trigger.detail || ''}`
  const type = interlocked ? '安全联锁' : '安全告警'
  await promisePool.execute(
    'INSERT INTO t_error_msg (d_no, c_time, e_msg, e_no, type) VALUES (?, ?, ?, ?, ?)',
    [deviceNo || null, time, message, trigger.id, type]
  )
}

/** 关闭水泵和加热：发布 MQTT、保存当前值并记录操作历史（interlock）。 */
async function closePumpHeater(deviceNo, triggerId) {
  const mqttClient = require('../../mqtt')
  const targets = await Promise.all([
    findSwitchConfig('pump'),
    findSwitchConfig('heater'),
  ])
  let published = 0
  for (const conf of targets.filter(Boolean)) {
    try {
      const payload = buildSwitchPayload(conf, 'off')
      if (!systemConfig.getConfig().SINGLE_DEVICE_MODE && deviceNo) payload.d_no = deviceNo
      await mqttClient.publish(getTopic('control'), payload, { qos: systemConfig.getConfig().MQTT_QOS })
      const oldValue = await getDirectValue({ config_id: conf.id, d_no: deviceNo })
      await saveDirectData({ config_id: conf.id, value: 'off', d_no: deviceNo })
      await saveOperationHistory({
        d_no: deviceNo,
        config_id: conf.id,
        old_value: oldValue,
        new_value: 'off',
        source: 'interlock',
      })
      published++
      console.log(`[SafetyInterlock] 联锁关闭 ${conf.t_name}（${triggerId}），设备 ${deviceNo || '全局'}`)
    } catch (err) {
      console.error(`[SafetyInterlock] 关闭 ${conf.t_name} 失败:`, err.message)
    }
  }
  return published > 0
}

function withinCooldown(key, cooldownMs) {
  const last = lastFired.get(key) || 0
  return Date.now() - last < cooldownMs
}

function markFired(key) {
  lastFired.set(key, Date.now())
}

/**
 * 对单个触发条件执行：冷却判断 -> 告警记录 -> 可选联锁。
 *
 * cooldownMs 时间内，同一个"设备+故障类型"只处理一次：处理过一次后就记下时间戳，
 * 在冷却期内即使条件仍然满足也直接跳过，不会重复关水泵、重复写告警，等冷却期
 * 过了才会重新判断处理。
 * @returns {object|null} 执行结果，冷却期内返回 null。
 */
async function fire(trigger, deviceNo, safetyConfig, { interlock }) {
  const cooldownKey = `${deviceNo || 'global'}:${trigger.id}`
  const cooldownMs = Number(safetyConfig.alarmCooldownMs) >= 0 ? Number(safetyConfig.alarmCooldownMs) : 30000
  if (withinCooldown(cooldownKey, cooldownMs)) return null
  markFired(cooldownKey)

  const outcome = { ...trigger, interlocked: false }
  if (interlock) {
    outcome.interlocked = await closePumpHeater(deviceNo, trigger.id)
  }
  await recordAlarm(deviceNo, trigger, interlock)
  return outcome
}

/* ============================ 条件评估 ============================ */

async function evaluateValueConditions(info, deviceNo, safetyConfig) {
  const sensors = await readSensors(info)
  const states = await readSwitchStates(info)
  const triggers = []

  // 1. 流量低于下限阈值或流量为 0（含异常最大值）。
  if (safetyConfig.flowLow && sensors.flow != null) {
    const flowLow = await getThresholdValue('flowLow', deviceNo)
    if (sensors.flow === 0 || sensors.flow >= getAbnormalMax() || (flowLow != null && sensors.flow < flowLow)) {
      triggers.push({
        id: 'flow_low',
        name: '流量异常（低于下限/为0/掉线）',
        detail: `流量=${sensors.flow}${flowLow != null ? `，下限=${flowLow}` : ''}`,
      })
    }
  }

  // 2. 压力高于上限阈值或压力为 0（含异常最大值）。
  if (safetyConfig.pressureHigh && sensors.pressure != null) {
    const pressureHigh = await getThresholdValue('pressureHigh', deviceNo)
    if (sensors.pressure === 0 || sensors.pressure >= getAbnormalMax() || (pressureHigh != null && sensors.pressure > pressureHigh)) {
      triggers.push({
        id: 'pressure_high',
        name: '压力异常（高于上限/为0/掉线）',
        detail: `压力=${sensors.pressure}${pressureHigh != null ? `，上限=${pressureHigh}` : ''}`,
      })
    }
  }

  // 3. 任一温度高于上限阈值（含异常最大值）。
  if (safetyConfig.tempHigh) {
    const tempHigh = await getThresholdValue('tempHigh', deviceNo)
    for (const [key, label] of [['temp1', '温度1（进水）'], ['temp2', '温度2（出水）']]) {
      const v = sensors[key]
      if (v != null && (v >= getAbnormalMax() || (tempHigh != null && v > tempHigh))) {
        triggers.push({
          id: 'temp_high',
          name: '任一温度高于上限',
          detail: `${label}=${v}${tempHigh != null ? `，上限=${tempHigh}` : ''}`,
        })
      }
    }
  }

  // 4. 温差过大。
  if (safetyConfig.tempDiff && sensors.temp1 != null && sensors.temp2 != null) {
    const diff = Math.abs(sensors.temp1 - sensors.temp2)
    if (diff > Number(safetyConfig.tempDiffThreshold)) {
      triggers.push({ id: 'temp_diff', name: '温差过大', detail: `温差=${diff.toFixed(2)} > ${safetyConfig.tempDiffThreshold}℃` })
    }
  }

  // 5. 流量剧烈波动（疑似水锤/湍流）：最近 10 个读数里最大值-最小值超过阈值。
  // 跟前面几条比阈值不同——那几条是拿单次读数直接跟阈值比，这条要先攒够一段
  // 时间的读数才能算出"波动幅度"这个统计量，所以哪怕这次读数本身正常，只要
  // 跟前面几次差得太大，同样会触发。
  if (safetyConfig.flowVolatility && sensors.flow != null) {
    const volatility = trackFlowVolatility(deviceNo, sensors.flow)
    const threshold = await getNumberValue('flow_volatility', deviceNo, safetyConfig.flowVolatilityThreshold, 20)
    if (volatility != null && volatility > threshold) {
      triggers.push({
        id: 'flow_volatility',
        name: '流量剧烈波动（疑似水锤/湍流）',
        detail: `最近${getFlowVolatilityWindow()}个读数波动幅度=${volatility.toFixed(2)} > ${threshold}`,
      })
    }
  }

  // 7. 没打开水泵不能打开加热：水泵确认关闭时，加热却确认开启。只在两个开关状态都明确
  // 上报（不是 null/未知）时判断，避免消息里缺行为字段（如纯传感器消息）时误触发。
  if (safetyConfig.heaterWithoutPump && states.heatOn === true && states.pumpOn === false) {
    triggers.push({ id: 'heater_without_pump', name: '未开水泵却开启加热', detail: `水泵=关，加热=开` })
  }

  return triggers
}

/**
 * 消息驱动评估：在每条 MQTT 数据入库后调用（条件 1~5）。这是整个安全联锁模块唯一的
 * 外部入口，调用方（mqtt 消息处理流程）每收到一条设备上报就调一次本函数。
 * @param {Object} info - 已解析的设备上报数据
 * @returns {Array} 本次触发的安全联锁结果
 */
async function evaluateSafety(info) {
  const safetyConfig = systemConfig.getConfig().SAFETY_INTERLOCK || {}
  if (safetyConfig.enabled !== true) return []

  const deviceNo = String((await resolveDeviceNo(info)) || '').trim() || null
  // 控制模式是指令中心里的一个持续状态值，不是靠某条 MQTT 消息触发的事件，所以这里
  // 用 lastMode 保存上一次读到的模式，跟这一次的模式对比，才能判断出"这一刻恰好
  // 发生了切换"，而不只是看到"当前是手动"。
  const mode = await getCurrentMode(deviceNo)
  const prevMode = lastMode.get(deviceNo)
  lastMode.set(deviceNo, mode)

  const results = []

  // 5. 进入手动模式：自动 -> 手动切换时安全关闭一次，供人工修复。
  if (safetyConfig.manualMode !== false && mode === 'manual' && prevMode === 'auto') {
    const r = await fire(
      { id: 'manual_mode', name: '进入手动模式（人工修复）', detail: '控制模式 自动->手动' },
      deviceNo, safetyConfig, { interlock: true }
    )
    if (r) results.push(r)
  }

  // 1~4：值条件。安全联锁在自动和手动模式下都强制关闭，不会因手动强制开启而失效。
  const valueTriggers = await evaluateValueConditions(info, deviceNo, safetyConfig)
  for (const trigger of valueTriggers) {
    const r = await fire(trigger, deviceNo, safetyConfig, { interlock: true })
    if (r) results.push(r)
  }

  if (results.length) {
    console.log(`[SafetyInterlock] 触发 ${results.length} 项安全联锁，设备 ${deviceNo || '全局'}，模式 ${mode}`)
  }
  return results
}

/* ============================ 掉线监测（条件 6） ============================ */

// 前面 1~5 条都是靠"收到一条 MQTT 消息"触发 evaluateSafety 来判断的，但设备掉线是
// "完全没有消息进来了"，没消息就不会调用 evaluateSafety。这里用一个独立的定时器，
// 主动去查"每个设备上次收到心跳是多久之前"，而不是等消息来了才检查。
async function monitorOffline() {
  const safetyConfig = systemConfig.getConfig().SAFETY_INTERLOCK || {}
  if (safetyConfig.enabled !== true || safetyConfig.sensorOffline === false) return

  let mqttClient
  try {
    mqttClient = require('../../mqtt')
  } catch (err) {
    return
  }
  const statuses = mqttClient.getAllDeviceStatus() || []
  for (const st of statuses) {
    if (!st.configured || st.online) continue
    const deviceNo = st.deviceNumber || st.deviceId
    await fire(
      { id: 'sensor_offline', name: '传感器掉线（无数据上报）', detail: `设备 ${deviceNo} 心跳超时` },
      deviceNo, safetyConfig, { interlock: true }
    )
  }
}

/** 启动掉线监测定时器（在服务启动时调用一次）。检测周期在启动时读取一次配置中心
 * SAFETY_INTERLOCK.monitorIntervalMs（默认 5000ms，没配置/小于 1000 时退回默认值），
 * 属于"保存后需要重启后端才生效"的一类配置，不是热更新。 */
function startMonitor() {
  if (monitorTimer) return
  const configured = Number(systemConfig.getConfig().SAFETY_INTERLOCK?.monitorIntervalMs)
  const intervalMs = Number.isFinite(configured) && configured >= 1000 ? configured : 5000
  monitorTimer = setInterval(async () => {
    try {
      await monitorOffline()
    } catch (err) {
      console.error('[SafetyInterlock] 掉线监测失败:', err.message)
    }
  }, intervalMs)
  monitorTimer.unref?.()
}

module.exports = { evaluateSafety, startMonitor }