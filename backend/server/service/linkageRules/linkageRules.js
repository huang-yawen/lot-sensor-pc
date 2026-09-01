/**
 * 【文件职责】正常状况联动统一规则引擎——取代原来互斥的"自动控制（简化版）"和
 * "分层联动"两套独立逻辑。9 条规则各自独立开关，可以任意勾选组合，不再被迫
 * 二选一：赛场上评委要什么组合，直接在配置中心逐条勾选，不用改代码、不用重启。
 *
 * 规则清单（每条都可通过 LINKAGE_RULES 独立开关，规则函数在文件下方）：
 *   pumpAlwaysOn   水泵常开：无故障、其他传感器读数正常就保持运行，不跟温度挂钩。
 *   heaterHysteresis 加热滞回带通断：出水温度低于"目标-回差"才开，达到目标就关。
 *   flowSingle     水泵-流量单层：流量在区间内/低于下限->开；高于上限->关（保护）。
 *   pressureSingle 水泵/加热-压力单层：压力低于下限->开泵；高于上限->关泵关热。
 *   tempSingle     加热-温度单层（带滞回）：温度低于目标/下限->开；高于目标/上限->关。
 *   dualTemp       水泵-双温度融合：温差超过阈值->开泵。
 *   tempFlow       水泵/加热-温度+流量融合：温度高且流量正常->关热；温度不高但流量低->开热开泵。
 *   pressureFlow   水泵-压力+流量融合：压力高流量低->关泵；压力低流量正常->开泵；压力高流量高->关泵。
 *   tempPressure   水泵/加热-温度+压力融合：压力高且加热温度持续上升->关热；压力低且温度低->先开泵再开热。
 *
 * 多条规则同时命中且结论矛盾时，"关闭"优先于"打开"（fail-safe）——跟原分层联动
 * 的合并策略一致，这条不因为规则可以自由组合而改变，是安全设计的底线。
 * 堵管/漏水/干烧这三个故障检测（detectFaults）是所有规则共用的前置条件，不算一条
 * 独立规则，只要总开关打开就一直生效，触发后强制两个执行器都关闭。
 *
 * 阈值、目标温度实时读取指令中心 t_direct，页面修改即时生效。
 * 【配置中心关联】LINKAGE_RULES 每次评估动态读取。
 */
const systemConfig = require('../../config/systemConfig')
const { resolveDeviceNo } = require('../../utils/mappedData')
const { getCurrentMode } = require('../directData/getControlMode')
const { isPidEnabled } = require('../pidHeating/pidHeating')
const { isLockedByFault, isAnyLocked } = require('../faultStatus/faultStatus')
const {
  ABNORMAL_MAX,
  getThresholdValue,
  readSensors,
  readSwitchStates,
  getTargetTemp,
  setSwitch,
  canAct,
} = require('../controlShared/controlHelpers')

/** 上次该条件动作，用于日志与最小化重复下发。 */
const lastActions = new Map()
/** 记录每个设备上一次的 temp1 读数，供"加热温度持续上升"判断趋势（tempPressure 规则用）。 */
const lastTemp = new Map()

/* ============================ 故障检测（所有规则共用的前置条件） ============================ */

/** 故障检测：堵管 / 漏水 / 干烧。返回命中的故障名称数组。 */
async function detectFaults(sensors, deviceNo, states) {
  const faults = []
  const flowLow = await getThresholdValue('flowLow', deviceNo)
  const pressureHigh = await getThresholdValue('pressureHigh', deviceNo)

  // 干烧：水泵和加热均开启时，流量低于下限。
  if (states.pumpOn && states.heatOn && flowLow != null && sensors.flow != null && sensors.flow < flowLow) {
    faults.push('干烧')
  }
  // 堵管：压力高于上限且流量低于下限。
  if (pressureHigh != null && sensors.pressure != null && sensors.pressure > pressureHigh
    && flowLow != null && sensors.flow != null && sensors.flow < flowLow) {
    faults.push('堵管')
  }
  // 漏水：压力为 0 且流量为 0 或低于下限。
  if (sensors.pressure === 0 && (sensors.flow === 0 || (flowLow != null && sensors.flow != null && sensors.flow < flowLow))) {
    faults.push('漏水')
  }
  return faults
}

/** 流量是否处于"正常"区间：非空、非 0、未到异常最大值哨兵、在下上限之间。 */
function isFlowNormal(flow, flowLow, flowHigh) {
  if (flow == null || flow === 0 || flow >= ABNORMAL_MAX) return false
  if (flowLow != null && flow < flowLow) return false
  if (flowHigh != null && flow > flowHigh) return false
  return true
}

/** 多个候选结论合并："关闭"优先于"打开"（fail-safe）。 */
function mergeDecision(...values) {
  const list = values.filter(v => v === 'on' || v === 'off')
  if (list.includes('off')) return 'off'
  if (list.includes('on')) return 'on'
  return null
}

/* ============================ 规则函数（每条都返回 { pump, heater }） ============================ */

function rulePumpAlwaysOn(sensors, faults) {
  const allNormal = faults.length === 0
    && sensors.flow != null && sensors.flow !== 0 && sensors.flow < ABNORMAL_MAX
    && sensors.pressure != null && sensors.pressure !== 0 && sensors.pressure < ABNORMAL_MAX
  if (faults.length > 0) return { pump: 'off', heater: null }
  if (allNormal) return { pump: 'on', heater: null }
  return { pump: null, heater: null }
}

function ruleHeaterHysteresis(sensors, states, faults, targetTemp, diffOpenThreshold, hysteresis) {
  const temp2 = sensors.temp2
  const diff = (sensors.temp1 != null && sensors.temp2 != null) ? Math.abs(sensors.temp1 - sensors.temp2) : null
  if (faults.length > 0) return { pump: null, heater: 'off' }
  if (states.pumpOn === false || (sensors.flow != null && sensors.flow === 0)) return { pump: null, heater: 'off' }
  if (diff != null && diff > diffOpenThreshold) return { pump: null, heater: 'off' }
  if (temp2 == null) return { pump: null, heater: null }
  if (temp2 >= targetTemp) return { pump: null, heater: 'off' }
  if (temp2 < targetTemp - hysteresis) return { pump: null, heater: 'on' }
  return { pump: null, heater: null }
}

function ruleFlowSingle(sensors, flowLow, flowHigh) {
  const flow = sensors.flow
  if (flow == null) return { pump: null, heater: null }
  if (flowHigh != null && flow > flowHigh) return { pump: 'off', heater: null }
  return { pump: 'on', heater: null }
}

function rulePressureSingle(sensors, pressureLow, pressureHigh) {
  const pressure = sensors.pressure
  const result = { pump: null, heater: null }
  if (pressure == null) return result
  if (pressureLow != null && pressure < pressureLow) result.pump = 'on'
  if (pressureHigh != null && pressure > pressureHigh) {
    result.pump = 'off'
    result.heater = 'off'
  }
  return result
}

function ruleTempSingle(sensors, targetTemp, tempLow, tempHigh, hysteresis) {
  const openThreshold = Math.max(targetTemp, tempLow ?? targetTemp) - hysteresis
  const closeThreshold = Math.min(targetTemp, tempHigh ?? targetTemp) + hysteresis
  const temps = [sensors.temp1, sensors.temp2].filter(v => v != null)
  const result = { pump: null, heater: null }
  if (temps.some(t => t > closeThreshold)) result.heater = 'off'
  else if (temps.some(t => t < openThreshold)) result.heater = 'on'
  return result
}

function ruleDualTemp(sensors, threshold) {
  if (sensors.temp1 == null || sensors.temp2 == null) return { pump: null, heater: null }
  return { pump: Math.abs(sensors.temp1 - sensors.temp2) > threshold ? 'on' : null, heater: null }
}

function ruleTempFlow(sensors, flowNormal, tempHigh, flowLow) {
  const result = { pump: null, heater: null }
  const temps = [sensors.temp1, sensors.temp2].filter(v => v != null)
  if (temps.length === 0 || tempHigh == null) return result
  if (temps.some(t => t > tempHigh) && flowNormal) result.heater = 'off'
  if (temps.some(t => t < tempHigh) && flowLow != null && sensors.flow != null && sensors.flow < flowLow) {
    result.heater = 'on'
    result.pump = 'on'
  }
  return result
}

function rulePressureFlow(sensors, pressureLow, pressureHigh, flowLow, flowHigh, flowNormal) {
  const { pressure, flow } = sensors
  if (pressure == null) return { pump: null, heater: null }
  let pump = null
  if (pressureHigh != null && pressure > pressureHigh && flowLow != null && flow != null && flow < flowLow) pump = 'off'
  else if (pressureLow != null && pressure < pressureLow && flowNormal) pump = 'on'
  else if (pressureHigh != null && pressure > pressureHigh && flowHigh != null && flow != null && flow > flowHigh) pump = 'off'
  return { pump, heater: null }
}

function ruleTempPressure(sensors, states, pressureLow, pressureHigh, tempLow, deviceNo) {
  const result = { pump: null, heater: null }
  const pressure = sensors.pressure
  if (pressure == null) return result

  if (pressureHigh != null && pressure > pressureHigh && sensors.temp1 != null) {
    const prev = lastTemp.get(deviceNo)
    if (prev != null && sensors.temp1 > prev) result.heater = 'off'
  }
  if (pressureLow != null && pressure < pressureLow && tempLow != null) {
    const temps = [sensors.temp1, sensors.temp2].filter(v => v != null)
    if (temps.some(t => t < tempLow)) {
      if (!states.pumpOn) result.pump = 'on'
      else result.heater = 'on'
    }
  }
  return result
}

/* ============================ 主评估 ============================ */

async function evaluateLinkageRules(info) {
  const rootConfig = systemConfig.getConfig()
  const config = rootConfig.LINKAGE_RULES || {}
  if (config.enabled !== true) return []

  // ====== 故障锁短路 ======
  if (rootConfig.SINGLE_DEVICE_MODE === true) {
    if (isAnyLocked()) return []
  } else {
    const preDeviceNo = String((await resolveDeviceNo(info)) || '').trim() || null
    if (isLockedByFault(preDeviceNo)) return []
  }

  const deviceNo = String((await resolveDeviceNo(info)) || '').trim() || null

  // ====== 手动模式短路 ======
  if ((await getCurrentMode(deviceNo)) === 'manual') return []

  const sensors = await readSensors(info)
  const states = await readSwitchStates(info)
  const targetTemp = await getTargetTemp(deviceNo, rootConfig.DEFAULT_TARGET_TEMP)
  const [tempLow, tempHigh, flowLow, flowHigh, pressureLow, pressureHigh] = await Promise.all([
    getThresholdValue('tempLow', deviceNo),
    getThresholdValue('tempHigh', deviceNo),
    getThresholdValue('flowLow', deviceNo),
    getThresholdValue('flowHigh', deviceNo),
    getThresholdValue('pressureLow', deviceNo),
    getThresholdValue('pressureHigh', deviceNo),
  ])
  const flowNormal = isFlowNormal(sensors.flow, flowLow, flowHigh)
  const faults = await detectFaults(sensors, deviceNo, states)

  const pumpCandidates = []
  const heaterCandidates = []
  const collect = (r) => { pumpCandidates.push(r.pump); heaterCandidates.push(r.heater) }

  if (config.pumpAlwaysOn !== false) collect(rulePumpAlwaysOn(sensors, faults))
  if (config.heaterHysteresis !== false) {
    collect(ruleHeaterHysteresis(sensors, states, faults, targetTemp,
      Number(config.tempDiffOpenThreshold ?? 3), Number(config.heaterHysteresisValue ?? 1)))
  }
  if (config.flowSingle === true) collect(ruleFlowSingle(sensors, flowLow, flowHigh))
  if (config.pressureSingle === true) collect(rulePressureSingle(sensors, pressureLow, pressureHigh))
  if (config.tempSingle === true) {
    collect(ruleTempSingle(sensors, targetTemp, tempLow, tempHigh, Number(config.tempSingleHysteresis ?? 1)))
  }
  if (config.dualTemp === true) collect(ruleDualTemp(sensors, Number(config.dualTempDiffThreshold ?? 2)))
  if (config.tempFlow === true) collect(ruleTempFlow(sensors, flowNormal, tempHigh, flowLow))
  if (config.pressureFlow === true) {
    collect(rulePressureFlow(sensors, pressureLow, pressureHigh, flowLow, flowHigh, flowNormal))
  }
  if (config.tempPressure === true) {
    collect(ruleTempPressure(sensors, states, pressureLow, pressureHigh, tempLow, deviceNo))
  }

  const pumpDesired = mergeDecision(...pumpCandidates)
  const heaterDesired = mergeDecision(...heaterCandidates)

  const actions = []
  const result = { targetTemp, faults, sensors }

  if (pumpDesired && states.pumpOn !== undefined && states.pumpOn !== (pumpDesired === 'on') && canAct(deviceNo, 'pump')) {
    await setSwitch('pump', '水泵', pumpDesired, deviceNo, 'linkage_rules')
    actions.push({ device: 'pump', action: pumpDesired })
  }

  // “控制模式”（指令配置页面）开启 PID 恒温时改由 service/pidHeating/pidHeating.js
  // 接管加热，这里跳过，避免两边抢控制权。
  if (heaterDesired && !(await isPidEnabled(deviceNo))
    && states.heatOn !== undefined && states.heatOn !== (heaterDesired === 'on') && canAct(deviceNo, 'heater')) {
    await setSwitch('heater', '加热', heaterDesired, deviceNo, 'linkage_rules')
    actions.push({ device: 'heater', action: heaterDesired })
  }

  if (sensors.temp1 != null) lastTemp.set(deviceNo, sensors.temp1)

  result.actions = actions
  lastActions.set(deviceNo, result)

  if (actions.length) {
    console.log(`[LinkageRules] 设备 ${deviceNo || '全局'} 联动:`, JSON.stringify(actions), '故障:', faults)
  }
  return actions
}

module.exports = { evaluateLinkageRules }
