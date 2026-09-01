/**
 * 【文件职责】分层联动服务：严格按“二、单一传感器独立控制层”+“三、多传感器融合联动层”的
 * 分层规则控制水泵和加热。仅在 CONTROL_MODE='layered' 时运行，与 AUTO_CONTROL（简化版目标温
 * 控制，CONTROL_MODE='simple'）互斥，二者不会同时下发指令。
 *
 * 优先级：安全联锁（safetyInterlock，独立运行、全程生效）> 三、多传感器融合联动层 > 二、单一
 * 传感器独立控制层。同一执行器本轮如有多条规则同时命中且结论矛盾，“关闭”优先于“打开”
 * （fail-safe）；融合层对某执行器有结论就用融合层的，融合层没结论的执行器再看单一传感器层。
 *
 * 规则明细见每个 decide* 函数上方注释，逐条对应用户给的“二/三”两层需求。
 * 阈值、目标温度实时读取指令中心 t_direct，页面修改即时生效。
 * 【配置中心关联】LAYERED_CONTROL 每次评估动态读取，CONTROL_MODE 决定是否启用本模块。
 */
const systemConfig = require('../../config/systemConfig')
const { resolveDeviceNo } = require('../../utils/mappedData')
const { getCurrentMode } = require('../directData/getControlMode')
const { isPidEnabled } = require('../pidHeating/pidHeating')
const { isLockedByFault, isAnyLocked } = require('../faultStatus/faultStatus')
// 读传感器/开关状态、查阈值、下发指令、防抖这些底层动作，跟自动控制
// （autoControl.js）完全共用同一份实现，见 controlShared/controlHelpers.js。
const {
  ABNORMAL_MAX,
  getThresholdValue,
  readSensors,
  readSwitchStates,
  getTargetTemp,
  setSwitch,
  canAct,
} = require('../controlShared/controlHelpers')

/** 记录每个设备上一次的 temp1 读数，供“加热温度持续上升”判断趋势（分层联动独有状态）。 */
const lastTemp = new Map()

/** 流量是否处于“正常”区间：非空、非 0、未到异常最大值哨兵、在下上限之间。 */
function isFlowNormal(flow, flowLow, flowHigh) {
  if (flow == null || flow === 0 || flow >= ABNORMAL_MAX) return false
  if (flowLow != null && flow < flowLow) return false
  if (flowHigh != null && flow > flowHigh) return false
  return true
}

// 把传进来的多个候选结论（'on'/'off'/null）过滤后合并成一个：只要其中有一个是
// 'off' 就返回 'off'，否则只要有一个 'on' 就返回 'on'，都没有就返回 null。
/** 多个候选结论合并：“关闭”优先于“打开”（fail-safe）。 */
function mergeDecision(...values) {
  const list = values.filter(v => v === 'on' || v === 'off')
  if (list.includes('off')) return 'off'
  if (list.includes('on')) return 'on'
  return null
}

/* ======================== 二、单一传感器独立控制层 ======================== */

/**
 * 温度：(1)任一温度低于目标温度或温度下限->打开加热 (2)任一温度高于目标温度或温度
 * 上限->关闭加热 (3)滞回防抖动：开阈值=max(目标,下限)-回差，关阈值=min(目标,上限)+回差。
 */
function decideTempSingle(sensors, targetTemp, tempLow, tempHigh, hysteresis) {
  const openThreshold = Math.max(targetTemp, tempLow ?? targetTemp) - hysteresis
  const closeThreshold = Math.min(targetTemp, tempHigh ?? targetTemp) + hysteresis
  const temps = [sensors.temp1, sensors.temp2].filter(v => v != null)
  if (temps.some(t => t > closeThreshold)) return 'off'
  if (temps.some(t => t < openThreshold)) return 'on'
  return null
}

/**
 * 流量：(1)区间内->打开水泵 (2)低于下限->打开水泵
 * (3)高于上限->关闭水泵（保护）。
 */
function decideFlowSingle(flow, flowLow, flowHigh) {
  if (flow == null) return null
  if (flowHigh != null && flow > flowHigh) return 'off'
  return 'on'
}

/** 压力：(1)低于下限->打开水泵 (2)高于上限->关闭水泵、关闭加热。 */
function decidePressureSingle(pressure, pressureLow, pressureHigh) {
  const result = { pump: null, heater: null }
  if (pressure == null) return result
  if (pressureLow != null && pressure < pressureLow) result.pump = 'on'
  if (pressureHigh != null && pressure > pressureHigh) {
    result.pump = 'off'
    result.heater = 'off'
  }
  return result
}

/* ======================== 三、多传感器融合联动层 ======================== */

/** 双温度：温差超过融合层阈值->打开水泵。 */
function decideDualTemp(sensors, threshold) {
  if (sensors.temp1 == null || sensors.temp2 == null) return null
  return Math.abs(sensors.temp1 - sensors.temp2) > threshold ? 'on' : null
}

/**
 * 温度+流量：(1)任一温度高于上限阈值且流量正常->关闭加热
 * (2)任一温度低于上限阈值且流量低于下限阈值->打开加热、打开水泵。
 */
function decideTempFlow(sensors, flowNormal, tempHigh, flowLow) {
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

/**
 * 压力+流量：(1)压力高于上限且流量低于下限->关闭水泵 (2)压力低于下限且流量正常->打开水泵
 * (3)压力高于上限且流量高于上限->关闭水泵。
 */
function decidePressureFlow(pressure, flow, pressureLow, pressureHigh, flowLow, flowHigh, flowNormal) {
  if (pressure == null) return null
  if (pressureHigh != null && pressure > pressureHigh && flowLow != null && flow != null && flow < flowLow) return 'off'
  if (pressureLow != null && pressure < pressureLow && flowNormal) return 'on'
  if (pressureHigh != null && pressure > pressureHigh && flowHigh != null && flow != null && flow > flowHigh) return 'off'
  return null
}

/**
 * 温度+压力：(1)压力高于上限且加热温度持续上升->关闭加热（跟上一轮 temp1 读数比较判断趋势）
 * (2)压力低于下限且温度低于下限->先打开水泵、再打开加热（水泵当前状态未开时本轮只开水泵，
 * 水泵已开时才轮到打开加热，靠评估周期自然实现先后顺序，不额外加定时器）。
 */
function decideTempPressure(sensors, states, pressureLow, pressureHigh, tempLow, deviceNo) {
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

async function evaluateLayeredControl(info) {
  const rootConfig = systemConfig.getConfig()
  if (rootConfig.CONTROL_MODE !== 'layered') return []
  const config = rootConfig.LAYERED_CONTROL || {}
  if (config.enabled !== true) return []

  // ====== 故障锁短路 ======
  // 故障态下 faultStatus 已强制关闭水泵和加热、并锁定指令页面，
  // 分层联动必须立即返回，避免下一条 MQTT 消息到达时把执行器又重新打开。
  if (rootConfig.SINGLE_DEVICE_MODE === true) {
    if (isAnyLocked()) return []
  } else {
    const preDeviceNo = String((await resolveDeviceNo(info)) || '').trim() || null
    if (isLockedByFault(preDeviceNo)) return []
  }

  const deviceNo = String((await resolveDeviceNo(info)) || '').trim() || null

  // ====== 手动模式短路 ======
  // 指令中心切到手动模式时，正常调节的控制权交还给人工，分层联动不再继续下发指令。
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

  // ---- 二、单一传感器独立控制层 ----
  let pumpSingle = null
  let heaterSingle = null
  if (config.tempSingle !== false) {
    heaterSingle = mergeDecision(heaterSingle, decideTempSingle(sensors, targetTemp, tempLow, tempHigh, Number(config.tempHysteresis) || 0))
  }
  if (config.flowSingle !== false) {
    pumpSingle = mergeDecision(pumpSingle, decideFlowSingle(sensors.flow, flowLow, flowHigh))
  }
  if (config.pressureSingle !== false) {
    const r = decidePressureSingle(sensors.pressure, pressureLow, pressureHigh)
    pumpSingle = mergeDecision(pumpSingle, r.pump)
    heaterSingle = mergeDecision(heaterSingle, r.heater)
  }

  // ---- 三、多传感器融合联动层（结论优先于单一传感器层） ----
  let pumpFusion = null
  let heaterFusion = null
  if (config.dualTemp !== false) {
    pumpFusion = mergeDecision(pumpFusion, decideDualTemp(sensors, Number(config.dualTempDiffThreshold) || 0))
  }
  if (config.tempFlow !== false) {
    const r = decideTempFlow(sensors, flowNormal, tempHigh, flowLow)
    pumpFusion = mergeDecision(pumpFusion, r.pump)
    heaterFusion = mergeDecision(heaterFusion, r.heater)
  }
  if (config.pressureFlow !== false) {
    pumpFusion = mergeDecision(pumpFusion, decidePressureFlow(sensors.pressure, sensors.flow, pressureLow, pressureHigh, flowLow, flowHigh, flowNormal))
  }
  if (config.tempPressure !== false) {
    const r = decideTempPressure(sensors, states, pressureLow, pressureHigh, tempLow, deviceNo)
    pumpFusion = mergeDecision(pumpFusion, r.pump)
    heaterFusion = mergeDecision(heaterFusion, r.heater)
  }

  const pumpDesired = pumpFusion ?? pumpSingle
  const heaterDesired = heaterFusion ?? heaterSingle

  const actions = []
  if (pumpDesired && states.pumpOn !== (pumpDesired === 'on') && canAct(deviceNo, 'pump')) {
    await setSwitch('pump', '水泵', pumpDesired, deviceNo, 'layered_control')
    actions.push({ device: 'pump', action: pumpDesired })
  }
  // “控制模式”（指令配置页面）开启时改由 service/pidHeating/pidHeating.js 接管加热，这里跳过。
  if (heaterDesired && !(await isPidEnabled(deviceNo))
    && states.heatOn !== (heaterDesired === 'on') && canAct(deviceNo, 'heater')) {
    await setSwitch('heater', '加热', heaterDesired, deviceNo, 'layered_control')
    actions.push({ device: 'heater', action: heaterDesired })
  }

  if (sensors.temp1 != null) lastTemp.set(deviceNo, sensors.temp1)

  if (actions.length) {
    console.log(`[LayeredControl] 设备 ${deviceNo || '全局'} 分层联动:`, JSON.stringify(actions))
  }
  return actions
}

module.exports = { evaluateLayeredControl }
