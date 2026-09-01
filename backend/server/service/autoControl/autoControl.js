/**
 * 【文件职责】正常状况联动（自动控制）服务，仅在 AUTO_CONTROL.enabled 开启时运行
 * （项目里已经没有独立的设备“自动/手动模式”概念）。
 *
 * 自动启停水泵和加热，与安全联锁（safetyInterlock）相互独立：
 *   - 安全联锁负责“异常时强制关闭”（保护）。
 *   - 自动控制负责“正常时按目标启停”（控制）。
 *
 * 规则（均可通过配置中心 AUTO_CONTROL 独立开关）：
 * 【水泵】常开逻辑：无故障、其他传感器（流量/压力）数值正常就保持运行，不跟温度
 *   目标挂钩——工业上水泵作为维持循环的基础设施应该常开，跟着温度频繁启停会让
 *   出水温度因为死水滞留而失真，反过来影响判断，容易抖动。触发堵管/漏水/干烧
 *   保护时关闭。
 * 【加热】按温度目标做滞回带通断控制：T2（出水温度）低于"目标-回差"才开，达到
 *   目标就关，中间死区维持现状不抖动；水泵关闭/流量=0、T1/T2 温差过大、触发
 *   堵管/漏水/干烧保护时强制关闭，优先级高于温度判断。
 *
 * 阈值与目标温度实时读取指令中心 t_direct，页面修改即时生效。
 * 【配置中心关联】AUTO_CONTROL 每次评估动态读取。
 */
const systemConfig = require('../../config/systemConfig')
const { resolveDeviceNo } = require('../../utils/mappedData')
const { getCurrentMode } = require('../directData/getControlMode')
const { isPidEnabled } = require('../pidHeating/pidHeating')
const { isLockedByFault, isAnyLocked } = require('../faultStatus/faultStatus')
// 读传感器/开关状态、查阈值、下发指令、防抖这些底层动作，跟分层联动
// （layeredControl.js）完全共用同一份实现，见 controlShared/controlHelpers.js。
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

/* ============================ 故障检测（自动控制独有，分层联动没有这一步） ============================ */

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

/* ============================ 决策 ============================ */

// 水泵是维持循环的基础设施，工业上的标准做法是"常开"——只要没有安全故障、流量/
// 压力等其他传感器读数正常，就应该保持运行，不跟温度目标挂钩。原因：水泵一旦
// 关闭，水不再流动，出水温度读数会因为死水滞留而失真（不能代表系统真实状态），
// 失真的读数又会影响下一轮判断，容易在温度临界值附近形成"水泵/加热反复抖动
// 启停"的恶性循环。真正该按温度目标做通断控制的是下面的加热器，不是水泵。
function decidePump(sensors, faults) {
  // allNormal：没有故障、且流量/压力都有有效读数、不为 0、也没有到 ABNORMAL_MAX
  // 这个异常哨兵值，三个条件同时满足才是 true，只有这样才允许自动开水泵。
  const allNormal = faults.length === 0
    && sensors.flow != null && sensors.flow !== 0 && sensors.flow < ABNORMAL_MAX
    && sensors.pressure != null && sensors.pressure !== 0 && sensors.pressure < ABNORMAL_MAX

  // 【关】任一保护故障。
  if (faults.length > 0) return 'off'

  // 【开】其他传感器读数都正常，水泵保持运行。
  if (allNormal) return 'on'

  return null
}

// 加热器才是真正按温度目标做通断控制的执行器，用滞回带（跟 layeredControl.js 的
// decideTempSingle 同一个思路）避免在目标温度附近因为传感器噪声反复抖动开关：
// 温度低于"目标-回差"才开，达到目标才关，中间这段死区维持当前状态不变。
function decideHeater(sensors, targetTemp, faults, states, diffOpenThreshold, hysteresis) {
  // 目标温度判断依据用温度2（出水温度），跟 pidHeating.js 的 readTempOut 保持
  // 同一个语义——"目标温度"指的是希望出水达到的温度，不是进水温度。
  const temp2 = sensors.temp2
  const diff = (sensors.temp1 != null && sensors.temp2 != null) ? Math.abs(sensors.temp1 - sensors.temp2) : null

  // 【关】保护故障。
  if (faults.length > 0) return 'off'
  // 【关】水泵关闭或瞬时流量=0：水泵没开/没水流时直接关加热，优先级比后面的
  // 温度判断都高，跟当前温度是否达标无关。
  if (states.pumpOn === false || (sensors.flow != null && sensors.flow === 0)) return 'off'
  // 【关】温差过大。
  if (diff != null && diff > diffOpenThreshold) return 'off'

  if (temp2 == null) return null

  // 【关】T2（出水温度）>= 目标：达标即关，不需要滞回（关闭没有抖动风险）。
  if (temp2 >= targetTemp) return 'off'
  // 【开】T2 低于"目标-回差"，明显没达标才开。
  if (temp2 < targetTemp - hysteresis) return 'on'
  // 目标-回差 <= T2 < 目标：死区，维持当前开关状态不变。
  return null
}

/* ============================ 主评估 ============================ */

async function evaluateAutoControl(info) {
  const rootConfig = systemConfig.getConfig()
  // CONTROL_MODE='layered' 时改由 service/layeredControl/layeredControl.js 接管，避免两套逻辑同时下发指令。
  if (rootConfig.CONTROL_MODE === 'layered') return []
  const config = rootConfig.AUTO_CONTROL || {}
  if (config.enabled !== true) return []

  // ====== 故障锁短路 ======
  // 故障态下 faultStatus 已强制关闭水泵和加热、并锁定指令页面，
  // 自动控制必须立即返回，避免下一条 MQTT 消息到达时把执行器又重新打开，
  // 否定故障保护。
  // 单设备模式直接查任意锁；多设备模式按 d_no 精确匹配。
  if (rootConfig.SINGLE_DEVICE_MODE === true) {
    if (isAnyLocked()) return []
  } else {
    const preDeviceNo = String((await resolveDeviceNo(info)) || '').trim() || null
    if (isLockedByFault(preDeviceNo)) return []
  }

  const deviceNo = String((await resolveDeviceNo(info)) || '').trim() || null

  // ====== 手动模式短路 ======
  // 指令中心切到手动模式时，正常调节的控制权交还给人工，自动联动不再继续下发指令。
  if ((await getCurrentMode(deviceNo)) === 'manual') return []

  const sensors = await readSensors(info)
  const states = await readSwitchStates(info)
  const targetTemp = await getTargetTemp(deviceNo, rootConfig.DEFAULT_TARGET_TEMP)
  const diffOpenThreshold = Number(config.tempDiffOpenThreshold ?? 3)
  const heaterHysteresis = Number(config.heaterHysteresis ?? 1)

  const faults = await detectFaults(sensors, deviceNo, states)

  const actions = []
  const result = { targetTemp, faults, sensors }

  // 水泵控制。
  if (config.pump !== false) {
    const desired = decidePump(sensors, faults)
    result.pumpDesired = desired
    if (desired && states.pumpOn !== undefined && states.pumpOn !== (desired === 'on') && canAct(deviceNo, 'pump')) {
      await setSwitch('pump', '水泵', desired, deviceNo, 'auto_control')
      actions.push({ device: 'pump', action: desired })
    }
  }

  // 加热控制。“控制模式”（指令配置页面）开启时改由 service/pidHeating/pidHeating.js
  // 接管加热，这里跳过，避免两边抢控制权。
  if (config.heater !== false && !(await isPidEnabled(deviceNo))) {
    const desired = decideHeater(sensors, targetTemp, faults, states, diffOpenThreshold, heaterHysteresis)
    result.heaterDesired = desired
    if (desired && states.heatOn !== undefined && states.heatOn !== (desired === 'on') && canAct(deviceNo, 'heater')) {
      await setSwitch('heater', '加热', desired, deviceNo, 'auto_control')
      actions.push({ device: 'heater', action: desired })
    }
  }

  result.actions = actions
  lastActions.set(deviceNo, result)

  if (actions.length) {
    console.log(`[AutoControl] 设备 ${deviceNo || '全局'} 自动联动:`, JSON.stringify(actions), '故障:', faults)
  }
  return actions
}

module.exports = { evaluateAutoControl }