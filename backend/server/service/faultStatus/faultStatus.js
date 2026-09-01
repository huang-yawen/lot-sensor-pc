/**
 * 【文件职责】故障状态服务：检测五种硬故障，触发后保存故障前快照、强制关闭水泵和加热、
 *   把系统状态切到 FAULT、复位按钮自动拨到"开"（仅 UI 显示，不修改硬件），并锁定指令页面
 *   的所有其他开关和参数（只读），用户人工修复设备后手动把复位按钮拨回"关"，系统按快照
 *   恢复所有参数和开关显示、按快照重启执行器，回到 NORMAL。
 *
 * === 五种故障检测逻辑（编号对应需求文档）===
 *   ① pipe_blockage      进水口/管道堵塞：压力 < 压力下限 OR 压力 > 压力上限
 *   ② outlet_blockage    出水口堵塞：水泵预热完成后流量 < 流量下限
 *   ③ dry_burn           干烧：加热器开启后连续 dryBurnDurationMs (默认 5000ms)
 *                          出水温度变化 < dryBurnMinRiseC (默认 0.1℃)
 *   ④ pump_idle          水泵空转：水泵预热完成，流量传感器读数 == 0
 *   ⑤ pump_fault         水泵故障：水泵预热完成，进出水温差 > tempDiffThreshold
 * ②④⑤ 共用同一个"预热"前置条件：水泵必须已经连续开启满 pumpWarmupMs（默认
 * 5000ms，配置中心设置）才开始判断，水泵刚启动的瞬间流量/温差还没稳定，直接拿
 * "水泵开着"当条件容易在启动瞬间误判。
 *
 * === 故障优先级（同时触发时按此排序取最高优先级处理和显示）===
 *   干烧(③) > 管道堵塞(①) > 水泵故障(⑤) > 水泵空转(④) > 出水口堵塞(②)
 *
 * === 复位按钮状态机 ===
 *   | 当前状态 | 触发条件 | 动作 | 下一状态 |
 *   |:---:|:---|:---|:---:|
 *   | off | 故障触发 | 自动拨到 on，保存快照，全关执行器 | on |
 *   | on  | 用户手动拨到 off | 从快照恢复参数和开关显示，按快照重启执行器，清故障标志 | off |
 *   | off | 正常运行 | 无动作 | off |
 *
 *   修复后又复发的情形：故障态下用户把复位拨到 off，但故障条件仍存在 ->
 *   立即重新触发故障，再次保存快照、全关执行器、复位自动变 on。
 *
 * === 配置中心关联 ===
 *   FAULT_STATUS 每次评估动态读取（enabled / alarmCooldownMs / 五种故障独立开关 /
 *   dryBurnDurationMs / dryBurnMinRiseC）。flowLow/pressureLow/pressureHigh 只从指令中心
 *   t_direct 实时读取；温差阈值（tempDiff）指令中心配置了就优先用指令中心的，没配置时
 *   退回 FAULT_STATUS.tempDiffThreshold 兜底（跟 PID 的 Kp/Ki/Kd 同一套"指令中心优先、
 *   配置中心兜底"模式）。
 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')
const { firstValue, getTopic, buildSwitchPayload } = require('../../utils/protocol')
const { resolveDeviceNo, resolveFieldAliases, getDefaultDeviceId, getAllDeviceIds } = require('../../utils/mappedData')
// 干烧判定时长/最小升温、水泵预热宽限期支持现场在指令中心调，删掉指令项就退回配置中心。
const { getNumberValue } = require('../controlShared/controlHelpers')
const { saveDirectData, getDirectValue } = require('../directData/saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory/saveOperationHistory')
const { nowLocalDateTime } = require('../../utils/helper')
const EventEmitter = require('events')

// 新故障触发时对外广播（app.js 监听后通过 WebSocket 推给前端弹窗提示），
// 跟 systemConfig.js 的 onChange 是同一套"内部 emit + 对外订阅函数"模式。
const events = new EventEmitter()
const {
  saveSnapshot,
  restoreFromSnapshot,
  getSwitchValueByPrefix,
} = require('./faultSnapshot')

/* ============================================================
 * 1. 故障类型定义（含优先级，从高到低）
 * ============================================================ */
const FAULT_TYPES = [
  { id: 'dry_burn',        code: '③', priority: 1, name: '干烧',         detail: '加热开启后温度长时间未变化' },
  { id: 'pipe_blockage',   code: '①', priority: 2, name: '进水口/管道堵塞', detail: '压力超出上下限范围' },
  { id: 'pump_fault',      code: '⑤', priority: 3, name: '水泵故障',      detail: '水泵开启时进出水温差超过阈值' },
  { id: 'pump_idle',       code: '④', priority: 4, name: '水泵空转',      detail: '水泵开启但流量为 0' },
  { id: 'outlet_blockage', code: '②', priority: 5, name: '出水口堵塞',    detail: '流量低于下限阈值' },
]

/** 阈值槽位（优先 preffix，其次中文名）。 */
const THRESHOLD_SLOTS = {
  flowLow:       { prefix: 'flow_low',       name: '流量下限阈值' },
  pressureHigh:  { prefix: 'pressure_high',  name: '压力上限阈值' },
  pressureLow:   { prefix: 'pressure_low',   name: '压力下限阈值' },
  tempDiff:      { prefix: 'temp_diff',      name: '温差阈值' },
}

/* ============================================================
 * 2. 全局状态：每个设备的故障态 + 复位按钮状态
 * ============================================================ */
const deviceStateMap = new Map()
// 默认状态：NORMAL + 复位按钮 OFF
function getDeviceState(deviceNo) {
  const key = deviceNo || 'global'
  if (!deviceStateMap.has(key)) {
    deviceStateMap.set(key, {
      systemState: 'NORMAL',     // 'NORMAL' | 'FAULT'
      activeFaultId: null,       // 当前故障 id（最高优先级那个）
      resetButton: 'off',       // 'on' | 'off'  (页面复位按钮的显示状态)
      faultTriggeredAt: 0,      // 故障触发时间戳（诊断用）
    })
  }
  return deviceStateMap.get(key)
}

/** 干烧检测：记录"加热开启后温度基线 + 起始时间"，加热关闭则清空。 */
const dryBurnStateMap = new Map()
/** 水泵启动预热计时：记录水泵"从关到开"的起始时间，水泵关闭则清空。 */
const pumpStartStateMap = new Map()
/** 故障告警冷却时间戳，避免同一故障高频重复入库（30s）。 */
const lastFired = new Map()

/**
 * 返回水泵已连续开启的时长（毫秒）；水泵未开启时返回 null。
 * 水泵每次从关变开时记一个起始时间戳，之后每次调用返回"现在 - 起始时间"；
 * 水泵一关就把起始时间清掉，下次再开会重新计时。宽限期长度（pumpWarmupMs）
 * 在配置中心 FAULT_STATUS.pumpWarmupMs 设置。
 */
function trackPumpOnDuration(deviceNo, pumpOn) {
  const key = deviceNo || 'global'
  if (!pumpOn) {
    pumpStartStateMap.delete(key)
    return null
  }
  const now = Date.now()
  let since = pumpStartStateMap.get(key)
  if (since == null) {
    since = now
    pumpStartStateMap.set(key, since)
  }
  return now - since
}

/* ============================================================
 * 3. 工具函数
 * ============================================================ */

async function resolveConfigIdByPrefix(prefix) {
  if (!prefix) return null
  const [rows] = await promisePool.query(
    "SELECT id FROM t_direct_config WHERE preffix IS NOT NULL AND preffix != '' AND LOWER(preffix) = LOWER(?) ORDER BY id ASC LIMIT 1",
    [prefix]
  )
  return rows[0]?.id ?? null
}

// 先按 preffix 查一次，查不到再按中文名（t_name）查一次，两种方式任一种查到
// 就返回对应的 config_id。
async function resolveThresholdConfigId(slot) {
  const def = THRESHOLD_SLOTS[slot]
  if (!def) return null
  const byPrefix = await resolveConfigIdByPrefix(def.prefix)
  if (byPrefix != null) return byPrefix
  const [rows] = await promisePool.query(
    'SELECT id FROM t_direct_config WHERE t_name = ? ORDER BY id ASC LIMIT 1',
    [def.name]
  )
  return rows[0]?.id ?? null
}

function toNumber(raw) {
  if (raw == null || raw === '') return null
  const num = Number(raw)
  return Number.isFinite(num) ? num : null
}

async function getThresholdValue(slot, deviceNo) {
  const configId = await resolveThresholdConfigId(slot)
  if (configId == null) return null
  return toNumber(await getDirectValue({ config_id: configId, d_no: deviceNo }))
}

async function readSensors(info) {
  const result = {}
  // SENSOR_FIELD_MAP 来自配置中心，不能在模块顶层缓存（要求实时取值，热更新才能生效）。
  for (const [key, field] of Object.entries(systemConfig.getConfig().SENSOR_FIELD_MAP)) {
    const aliases = await resolveFieldAliases('t_sensor_data', field)
    result[key] = toNumber(firstValue(info, aliases))
  }
  return result
}

async function readSwitchStates(info) {
  // 行为数据：field1=水泵，field2=加热器（与 safetyInterlock / linkageRules 保持一致）
  const pumpAliases = await resolveFieldAliases('t_behavior_data', 'field1')
  const heatAliases = await resolveFieldAliases('t_behavior_data', 'field2')
  const toOn = v => {
    if (v == null) return null
    const s = String(v).trim().toLowerCase()
    if (['on', 'open', '1', 'true'].includes(s)) return true
    if (['off', 'close', 'closed', '0', 'false'].includes(s)) return false
    return null
  }
  return {
    pumpOn: toOn(firstValue(info, pumpAliases)),
    heatOn: toOn(firstValue(info, heatAliases)),
  }
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

/**
 * 下发开关指令：发布 MQTT + 写 t_direct + 写操作历史。
 * skipPersist=true 时只发布 MQTT 断电/通电，不改 t_direct 中的开关显示值，
 * 用于故障触发时"硬件断电但页面保持故障前开关状态"。
 */
async function setSwitch(prefix, name, value, deviceNo, source, skipPersist = false) {
  const conf = await findSwitchConfig(prefix, name)
  if (!conf) return false
  const mqttClient = require('../../mqtt')
  const payload = buildSwitchPayload(conf, value)
  if (!systemConfig.getConfig().SINGLE_DEVICE_MODE && deviceNo) payload.d_no = deviceNo
  await mqttClient.publish(getTopic('control'), payload, { qos: systemConfig.getConfig().MQTT_QOS })
  if (!skipPersist) {
    const oldValue = await getDirectValue({ config_id: conf.id, d_no: deviceNo })
    await saveDirectData({ config_id: conf.id, value, d_no: deviceNo })
    await saveOperationHistory({ d_no: deviceNo, config_id: conf.id, old_value: oldValue, new_value: value, source })
  }
  return true
}

async function recordAlarm(deviceNo, trigger) {
  const time = nowLocalDateTime()
  const message = `${trigger.name}（${trigger.code}），已执行故障保护（保存快照、强制关闭水泵和加热、系统进入 FAULT、复位按钮自动置 ON、指令页面锁定），${trigger.detail || ''}`
  await promisePool.execute(
    'INSERT INTO t_error_msg (d_no, c_time, e_msg, e_no, type) VALUES (?, ?, ?, ?, ?)',
    [deviceNo || null, time, message, trigger.id, '故障保护']
  )
}

function withinCooldown(key, cooldownMs) {
  const last = lastFired.get(key) || 0
  return Date.now() - last < cooldownMs
}

function markFired(key) {
  lastFired.set(key, Date.now())
}

/**
 * 清除某设备的所有故障 cooldown 记录。
 * 用于用户手动复位时：用户拨回 OFF 后，若故障条件仍存在，下一轮 evaluateFaultStatus
 * 检测到故障需要能立即重新触发（不能被冷却期拦住）。
 *
 * lastFired 的 key 形如 `${deviceNo || 'global'}:${trigger.id}`，按设备前缀清理。
 */
function clearCooldownForDevice(deviceNo) {
  const prefix = `${deviceNo || 'global'}:`
  for (const key of lastFired.keys()) {
    if (key.startsWith(prefix)) lastFired.delete(key)
  }
}

/* ============================================================
 * 4. 五种故障检测（按需求文档编号）
 * ============================================================ */

/** ③ 干烧：加热开启后，连续 dryBurnDurationMs 出水温度变化 < dryBurnMinRiseC。 */
function checkDryBurn(deviceNo, heatOn, tempOut, faultConfig) {
  const key = deviceNo || 'global'
  // 加热关闭 / 出水温度无效时清空状态，下次重新开始计时
  if (!heatOn || tempOut == null) {
    dryBurnStateMap.delete(key)
    return false
  }
  const durationMs = Number(faultConfig.dryBurnDurationMs) > 0 ? Number(faultConfig.dryBurnDurationMs) : 5000
  const minRise = Number(faultConfig.dryBurnMinRiseC) >= 0 ? Number(faultConfig.dryBurnMinRiseC) : 0.1
  const state = dryBurnStateMap.get(key)
  const now = Date.now()
  if (!state) {
    dryBurnStateMap.set(key, { baselineTemp: tempOut, since: now })
    return false
  }
  // 温度比基线明显上升，更新基线、重新计时
  if (tempOut >= state.baselineTemp + minRise) {
    dryBurnStateMap.set(key, { baselineTemp: tempOut, since: now })
    return false
  }
  // 持续时间够长才判定为干烧
  return now - state.since >= durationMs
}

/**
 * 主评估：检测五种故障，按优先级取最高的一个返回。
 * 多故障同时命中时，只触发优先级最高的那个（避免一份报警里塞五种故障）。
 *
 * @returns {Object|null} { id, code, priority, name, detail } 或 null
 */
async function detectFault(info, deviceNo, faultConfig) {
  const sensors = await readSensors(info)
  const states = await readSwitchStates(info)

  const pumpOnDurationMs = trackPumpOnDuration(deviceNo, states.pumpOn === true)

  const [flowLow, pressureLow, pressureHigh, tempDiffFromDirect, warmupMs, dryBurnDurationMs, dryBurnMinRiseC] = await Promise.all([
    getThresholdValue('flowLow', deviceNo),
    getThresholdValue('pressureLow', deviceNo),
    getThresholdValue('pressureHigh', deviceNo),
    getThresholdValue('tempDiff', deviceNo),
    // 三个故障判定参数：指令中心优先 → 配置中心兜底 → 常量兜底，指令项删掉不影响运行。
    getNumberValue('pump_warmup_ms', deviceNo, faultConfig.pumpWarmupMs, 5000),
    getNumberValue('dry_burn_duration_ms', deviceNo, faultConfig.dryBurnDurationMs, 5000),
    getNumberValue('dry_burn_min_rise', deviceNo, faultConfig.dryBurnMinRiseC, 0.1),
  ])

  // 水泵开启满 warmupMs 才算"预热完成"，②④⑤三条故障都要求预热完成才判断，
  // 避免水泵刚启动、流量/温差还没稳定的瞬间被误判。
  const pumpWarmedUp = pumpOnDurationMs != null && pumpOnDurationMs >= warmupMs

  // 把本轮实际生效的判定参数合进一份配置，交给下面的同步判定函数用，
  // 这样那些函数不用改签名、也不用各自再去读一次指令中心。
  const effectiveConfig = { ...faultConfig, pumpWarmupMs: warmupMs, dryBurnDurationMs, dryBurnMinRiseC }
  // 温差阈值：指令中心配置了"温差阈值"指令项就优先用指令中心的（跟其余阈值一样，
  // 保存后立即生效）；指令中心没配置时才退回配置中心 FAULT_STATUS.tempDiffThreshold
  // 兜底，不影响 flowLow/pressureLow/pressureHigh 这几个仍然只认指令中心的阈值。
  const tempDiffThreshold = tempDiffFromDirect != null
    ? tempDiffFromDirect
    : (Number.isFinite(faultConfig.tempDiffThreshold) ? faultConfig.tempDiffThreshold : 3)

  const triggers = []

  // ① 进水口/管道堵塞：压力 < 下限 或 > 上限
  if (faultConfig.pipeBlockage !== false && sensors.pressure != null) {
    if ((pressureLow != null && sensors.pressure < pressureLow)
      || (pressureHigh != null && sensors.pressure > pressureHigh)) {
      triggers.push({
        id: 'pipe_blockage', code: '①', priority: 2,
        name: '进水口/管道堵塞',
        detail: `压力=${sensors.pressure}${pressureLow != null ? `，下限=${pressureLow}` : ''}${pressureHigh != null ? `，上限=${pressureHigh}` : ''}`,
      })
    }
  }

  // ② 出水口堵塞：水泵预热完成后流量 < 下限（水泵刚启动、没开，流量本来就该是 0，不算故障）
  if (faultConfig.outletBlockage !== false && pumpWarmedUp && sensors.flow != null && flowLow != null && sensors.flow < flowLow) {
    triggers.push({
      id: 'outlet_blockage', code: '②', priority: 5,
      name: '出水口堵塞',
      detail: `流量=${sensors.flow}，下限=${flowLow}`,
    })
  }

  // ③ 干烧：加热开启后温度长时间不变化
  if (faultConfig.dryBurn !== false && checkDryBurn(deviceNo, states.heatOn, sensors.temp2, effectiveConfig)) {
    const durationMs = dryBurnDurationMs
    triggers.push({
      id: 'dry_burn', code: '③', priority: 1,
      name: '干烧',
      detail: `加热已开启超过 ${Math.round(durationMs / 1000)} 秒，出水温度=${sensors.temp2} 无明显上升`,
    })
  }

  // ④ 水泵空转：水泵预热完成，流量 = 0
  if (faultConfig.pumpIdle !== false && pumpWarmedUp && sensors.flow === 0) {
    triggers.push({
      id: 'pump_idle', code: '④', priority: 4,
      name: '水泵空转',
      detail: '水泵开启但流量=0',
    })
  }

  // ⑤ 水泵故障：水泵预热完成，进出水温差 > 阈值
  if (faultConfig.pumpFault !== false
    && pumpWarmedUp
    && sensors.temp1 != null && sensors.temp2 != null
    && tempDiffThreshold != null) {
    const diff = Math.abs(sensors.temp1 - sensors.temp2)
    if (diff > tempDiffThreshold) {
      triggers.push({
        id: 'pump_fault', code: '⑤', priority: 3,
        name: '水泵故障',
        detail: `进出水温差=${diff.toFixed(2)} > 阈值=${tempDiffThreshold}`,
      })
    }
  }

  if (triggers.length === 0) return null

  // 按优先级排序，取最高的那个
  triggers.sort((a, b) => a.priority - b.priority)
  return triggers[0]
}

/* ============================================================
 * 5. 故障触发流程：保存快照 -> 全关执行器 -> 进故障态 -> 复位自动 ON
 * ============================================================ */

/**
 * 故障触发统一流程。
 * 步骤（按需求文档要求顺序）：
 *   1. 保存故障前快照（含水泵/加热开关状态、目标温度、所有阈值、自动/手动模式、其他参数）
 *   2. 通过 MQTT 强制断电水泵和加热（不改 t_direct 中的开关显示值，页面保持故障前状态）
 *   3. 系统状态置为 FAULT
 *   4. 复位按钮自动拨到"开"（写 t_direct reset_button=on，UI 显示为 on）
 *   5. 记录告警入库
 *
 * 页面显示规则：故障触发后，水泵/加热的开关显示保持故障前的状态（如泵原来是开就还显示开），
 * 只有复位按钮自动变 ON、状态指示灯变红。实际硬件已断电，但页面不体现。
 * 用户修复设备后拨复位到 OFF，系统从快照恢复参数和开关显示、按快照重启执行器。
 */
async function triggerFault(deviceNo, trigger, faultConfig) {
  const state = getDeviceState(deviceNo)
  const cooldownKey = `${deviceNo || 'global'}:${trigger.id}`
  const cooldownMs = Number(faultConfig.alarmCooldownMs) >= 0 ? Number(faultConfig.alarmCooldownMs) : 30000

  // 已经处于 FAULT 状态、且这次检测到的故障类型和当前记录的一样，就直接跳过，
  // 不重复触发。故障类型不一样时（比如当前显示②出水口堵塞，这时又满足了优先级
  // 更高的③干烧）会继续往下走，把 activeFaultId 更新成新的这个，让页面始终显示
  // 优先级最高的故障。
  if (state.systemState === 'FAULT' && state.activeFaultId === trigger.id) {
    return null
  }
  if (withinCooldown(cooldownKey, cooldownMs)) return null
  markFired(cooldownKey)

  console.log(`[FaultStatus] 触发故障 ${trigger.code} ${trigger.name} | 设备=${deviceNo || '全局'} | ${trigger.detail}`)

  // 步骤 1：保存故障前快照
  await saveSnapshot(deviceNo, trigger.id)

  // 步骤 2：强制关闭水泵和加热（通过 MQTT 断电，但不改 t_direct 中的开关显示值，
  //         页面保持故障前的开关状态。只有 reset_button 自动变 ON。）
  for (const [prefix, name] of [['pump', '水泵'], ['heater', '加热']]) {
    try {
      await setSwitch(prefix, name, 'off', deviceNo, 'fault_status', true)
      console.log(`[FaultStatus] 已强制断电 ${name}（${trigger.id}），设备 ${deviceNo || '全局'}（页面开关保持故障前状态）`)
    } catch (err) {
      console.error(`[FaultStatus] 关闭 ${name} 失败:`, err.message)
    }
  }

  // 步骤 3 + 4：进入 FAULT 态 + 复位按钮自动置 ON
  state.systemState = 'FAULT'
  state.activeFaultId = trigger.id
  state.resetButton = 'on'
  state.faultTriggeredAt = Date.now()

  // 把复位按钮开关值也写到 t_direct（让前端拉数据时也能看到复位按钮是 on）
  try {
    const resetConfId = await resolveConfigIdByPrefix('reset_button')
    if (resetConfId != null) {
      await saveDirectData({ config_id: resetConfId, value: 'on', d_no: deviceNo })
    }
  } catch (err) {
    console.error('[FaultStatus] 写复位按钮 ON 状态失败:', err.message)
  }

  // 步骤 5：告警入库
  await recordAlarm(deviceNo, trigger)

  // 广播新故障，供 app.js 转成 WebSocket 消息推给前端弹窗提示。
  events.emit('fault', { ...trigger, deviceNo })

  return trigger
}

/* ============================================================
 * 6. 复位按钮手动切换：从 ON 拨到 OFF 时，按快照恢复
 * ============================================================ */

/**
 * 复位按钮手动拨到 off 时的处理。
 * 流程：
 *   1. 从快照恢复所有参数和开关显示值（水泵、加热等回到故障前的开/关状态）
 *   2. 按快照里记录的开关状态重新启动对应执行器（快照里水泵是开就重新开水泵，加热同理）
 *   3. 清除所有故障标志位，系统状态回到 NORMAL
 *   4. 解除页面操作锁定
 *
 * 用户调用入口：路由 /api/faultStatus/reset（POST，body: { action: 'off', d_no }）
 *
 * @returns {Object} 恢复结果
 */
async function handleResetButtonOff(deviceNo) {
  // 'global' 只是 deviceStateMap/snapshotMap 内部用来代表"d_no 为空"的 key 名，
  // 不是真实设备号，这里把它转成 null，后面统一传 null 给 setSwitch / saveDirectData
  // 等函数。getDeviceState / restoreFromSnapshot / getSwitchValueByPrefix /
  // clearCooldownForDevice 内部都会把传入的 null 再转成 `deviceNo || 'global'` 去
  // 查同一个 key，所以传 null 依然能命中正确的状态。
  if (deviceNo === 'global') deviceNo = null

  const state = getDeviceState(deviceNo)
  // 只有故障态 + 复位按钮 ON 时才能拨到 OFF（正常运行时复位按钮就是 OFF，无意义）
  if (state.systemState !== 'FAULT' || state.resetButton !== 'on') {
    return { success: false, message: '当前复位按钮不是 ON 状态或系统未处于故障态，无需复位' }
  }

  console.log(`[FaultStatus] 用户手动复位按钮 OFF | 设备=${deviceNo || '全局'} | 开始从快照恢复`)

  // 1) 从快照恢复参数和开关显示值
  const restoreResult = await restoreFromSnapshot(deviceNo)

  // 2) 按快照里记录的开关状态重新启动执行器
  //    如果快照里水泵是开的就重新开水泵，加热同理；如果都是关的就不动作
  const pumpSnap = getSwitchValueByPrefix(deviceNo, 'pump')
  const heaterSnap = getSwitchValueByPrefix(deviceNo, 'heater')
  if (pumpSnap === 'on') {
    try {
      await setSwitch('pump', '水泵', 'on', deviceNo, 'fault_reset')
      console.log(`[FaultStatus] 复位后按快照重启水泵（ON），设备 ${deviceNo || '全局'}`)
    } catch (err) {
      console.error('[FaultStatus] 复位后重启水泵失败:', err.message)
    }
  }
  if (heaterSnap === 'on') {
    try {
      await setSwitch('heater', '加热', 'on', deviceNo, 'fault_reset')
      console.log(`[FaultStatus] 复位后按快照重启加热（ON），设备 ${deviceNo || '全局'}`)
    } catch (err) {
      console.error('[FaultStatus] 复位后重启加热失败:', err.message)
    }
  }

  // 3) 把复位按钮开关值写到 t_direct 为 OFF（前端拉数据时显示复位已恢复）
  try {
    const resetConfId = await resolveConfigIdByPrefix('reset_button')
    if (resetConfId != null) {
      await saveDirectData({ config_id: resetConfId, value: 'off', d_no: deviceNo })
    }
  } catch (err) {
    console.error('[FaultStatus] 写复位按钮 OFF 状态失败:', err.message)
  }

  // 4) 清除故障标志，回到 NORMAL
  state.systemState = 'NORMAL'
  state.activeFaultId = null
  state.resetButton = 'off'

  // 5) 清除该设备的所有 cooldown 记录，确保下次同种故障复发时能立即重新触发
  //    （需求："故障未修复时，即使用户把复位拨回'关'，如果故障条件仍然存在，
  //      系统应立即重新触发故障"）
  clearCooldownForDevice(deviceNo)
  // 同时清空干烧检测状态，避免基线温度被沿用导致误判
  dryBurnStateMap.delete(deviceNo || 'global')
  // 水泵按快照重启是一次新的开启，预热计时也要重新开始，避免沿用故障前的累计时长
  pumpStartStateMap.delete(deviceNo || 'global')

  console.log(`[FaultStatus] 系统已恢复 NORMAL | 设备=${deviceNo || '全局'} | 恢复项数=${restoreResult.restored}`)

  return {
    success: true,
    message: '已从故障前快照恢复，执行器按故障前状态重启',
    data: {
      restored: restoreResult.restored,
      snapshotTriggerId: restoreResult.snapshotTriggerId,
      pumpRestarted: pumpSnap === 'on',
      heaterRestarted: heaterSnap === 'on',
    },
  }
}

/* ============================================================
 * 7. 主评估入口（每条 MQTT 数据上报时调用）
 * ============================================================ */

/**
 * 每条 MQTT 消息到达后调用。
 * 流程：
 *   - FAULT_STATUS.enabled 关闭则跳过
 *   - 系统处于 NORMAL 态：检测五种故障，命中则进入故障态（首次触发）
 *   - 系统处于 FAULT 态且当前故障类型一致：不重复触发（cooldown 兜底）
 *   - 系统处于 FAULT 态但出现了更高优先级的故障：用新故障覆盖当前故障
 *   - 系统处于 FAULT 态且当前数据已不构成故障：保持 FAULT 态等用户手动复位
 *
 * 关于"故障复发"路径：
 *   用户拨回 OFF 后，handleResetButtonOff 会把 state 切到 NORMAL 并清除 cooldown，
 *   所以下一条 MQTT 消息到达时走 NORMAL 态首次触发路径，自然满足需求
 *   "故障未修复时立即重新触发"。
 */
async function evaluateFaultStatus(info) {
  const faultConfig = systemConfig.getConfig().FAULT_STATUS || {}
  if (faultConfig.enabled !== true) return []

  const deviceNo = String((await resolveDeviceNo(info)) || '').trim() || null
  const state = getDeviceState(deviceNo)

  // 检测当前是否存在故障
  const trigger = await detectFault(info, deviceNo, faultConfig)

  // ===== 情况 A：检测到故障 =====
  if (trigger) {
    // 正在 FAULT 态且故障类型一致 → 已经处理过，不重复触发
    if (state.systemState === 'FAULT' && state.activeFaultId === trigger.id) {
      return []
    }
    // 否则触发故障（NORMAL 态首次触发 / FAULT 态新故障类型覆盖）
    const r = await triggerFault(deviceNo, trigger, faultConfig)
    return r ? [r] : []
  }

  // ===== 情况 B：没有故障 =====
  // 处于 NORMAL 态 + 复位按钮 OFF → 一切正常，无动作
  if (state.systemState === 'NORMAL') return []

  // 处于 FAULT 态但当前数据已不构成故障 → 用户可能已修复
  // 此时复位按钮仍是 ON（系统自动拨的），等用户手动拨到 OFF 才会正式恢复
  // 这里不主动恢复，由用户通过 /api/faultStatus/reset 接口手动复位
  return []
}

/* ============================================================
 * 8. 导出：主评估 + 复位处理 + 状态查询
 * ============================================================ */

/**
 * 获取某设备当前故障态和复位按钮状态，供前端轮询显示。
 */
function getDeviceFaultState(deviceNo) {
  const state = getDeviceState(deviceNo)
  return {
    systemState: state.systemState,
    activeFaultId: state.activeFaultId,
    resetButton: state.resetButton,
    faultTriggeredAt: state.faultTriggeredAt || null,
  }
}

/**
 * 判断是否处于故障锁定状态（指令页面其他开关和参数只读）。
 * updateDirectConfigAndPublish 在保存指令前会调用此函数，故障态下拒绝所有非复位按钮的修改。
 */
function isLockedByFault(deviceNo) {
  const state = getDeviceState(deviceNo)
  return state.systemState === 'FAULT' && state.resetButton === 'on'
}

/**
 * 判断系统中是否有任意一个设备处于故障锁定状态。
 * 单设备模式下用：因为只有一个设备，直接查所有 deviceStateMap 条目，避免设备号映射不一致。
 */
function isAnyLocked() {
  for (const state of deviceStateMap.values()) {
    if (state.systemState === 'FAULT' && state.resetButton === 'on') return true
  }
  return false
}

/**
 * 单设备模式下，取当前故障态的设备状态（取第一个命中的）。
 * 用于复位按钮接口在单设备模式下找到正确的设备上下文。
 */
function getAnyLockedDeviceNo() {
  for (const [key, state] of deviceStateMap.entries()) {
    if (state.systemState === 'FAULT' && state.resetButton === 'on') return key
  }
  return null
}

/**
 * 服务启动时调用一次：从数据库 t_direct 读取复位按钮的持久化值，把内存里
 * deviceStateMap 的故障态同步过来。
 *
 * deviceStateMap 只存在内存里，服务一重启就会清空、重新变回默认的 NORMAL/off；
 * 但数据库里的 reset_button 值不会跟着重启变化，还停留在重启前最后一次写入的值。
 * 这里逐个设备查数据库里 reset_button 是不是 on，是的话就把该设备内存状态改成
 * systemState='FAULT'、resetButton='on'，让指令页面锁定、复位按钮也能正常操作、
 * 触发快照恢复。具体的故障原因（activeFaultId）在重启前没有持久化，这里恢复不出来，
 * 留空。
 */
async function initFaultStateFromDb() {
  try {
    const resetConfId = await resolveConfigIdByPrefix('reset_button')
    if (resetConfId == null) return

    const singleDeviceMode = systemConfig.getConfig().SINGLE_DEVICE_MODE === true
    // 跟指令保存/渲染路径统一用 mappedData.js 的 getDefaultDeviceId/getAllDeviceIds，
    // 不再自己查 t_device.number——以前这里只查 number，跟别处优先取 d_no 不一致，
    // 两个字段值不同时这里会用错设备号，恢复不到正确设备的故障态。
    const deviceNos = singleDeviceMode
      ? [await getDefaultDeviceId()].filter(Boolean)
      : await getAllDeviceIds()

    for (const deviceNo of deviceNos) {
      const value = await getDirectValue({ config_id: resetConfId, d_no: deviceNo })
      if (String(value).trim().toLowerCase() === 'on') {
        const state = getDeviceState(deviceNo)
        state.systemState = 'FAULT'
        state.resetButton = 'on'
        console.warn(`[FaultStatus] 启动时检测到数据库里复位按钮仍是 ON（设备=${deviceNo}），已同步内存故障态，避免状态不一致`)
      }
    }
  } catch (err) {
    console.error('[FaultStatus] 启动时同步复位状态失败:', err.message)
  }
}

module.exports = {
  evaluateFaultStatus,
  handleResetButtonOff,
  getDeviceFaultState,
  isLockedByFault,
  isAnyLocked,
  onFault: (listener) => events.on('fault', listener),
  getAnyLockedDeviceNo,
  initFaultStateFromDb,
  FAULT_TYPES,        // 暴露故障类型表，供前端展示和文档使用
}
