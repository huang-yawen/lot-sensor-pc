/**
 * 【文件职责】PID 恒温控制服务：把水温连续调节在目标温度 Tset，但加热模块只有开关量、
 * 没有功率输出，所以用"时间比例控制"模拟 PWM——固定一个周期 windowMs，PID 输出的
 * 占空比 duty 决定这个周期内加热开多久、关多久，而不是简单的全开/全关。
 *
 * 公式：u(k) = Kp·e(k) + Ki·Σe(k) + Kd·[e(k)-e(k-1)]，e(k) = Tset - T_out（用 T2 出水温度）。
 * u(k) 限幅到 [占空比下限,占空比上限] 作为占空比；积分项用条件积分做简单抗饱和（占空比
 * 已经顶到上限/下限且误差还在同方向时，暂停累加积分，避免积分饱和）。
 *
 * 都在"指令配置"页面按两层开关组织："自动控制开关"（t_direct_config，
 * preffix=auto_control_enabled）下面是目标温度和"PID恒温控制"（preffix=pid_enabled）
 * 子开关，PID恒温控制下面才是 Kp/Ki/Kd/控制周期/占空比上下限——两个开关都是开，PID
 * 才真正启用（见 isPidEnabled）。这些都跟流量/压力/温度阈值一样，属于可现场调整的
 * 指令项，不是写死在配置中心；systemConfig.js 的 PID_HEATING 仅在两个开关都还没配置
 * （指令项不存在）时作为兜底默认值。
 *
 * 与 CONTROL_MODE（simple/layered）正交——只接管加热这一个执行器，水泵仍由
 * CONTROL_MODE 对应的模块决定；PID 启用时，autoControl.js / layeredControl.js 会跳过
 * 各自的加热下发，避免两边同时抢着控制加热。
 *
 * 【控制对象说明】
 *   T1 (field1) = 进水温度（temp_in），用于参考
 *   T2 (field2) = 出水温度（temp_out），PID 的控制目标
 *   固定功率加热器加热后从出水口流出，PID 通过 PWM 调节出水温度稳定到目标值
 *
 * 【配置中心关联】PID_HEATING 仅作兜底默认值，保存配置后立即生效。
 */
const promisePool = require('../../config/dbPool')
const systemConfig = require('../../config/systemConfig')
const { firstValue, getTopic, buildSwitchPayload } = require('../../utils/protocol')
const { resolveDeviceNo, resolveFieldAliases } = require('../../utils/mappedData')
const { getDirectValue, saveDirectData } = require('../directData/saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory/saveOperationHistory')
const { isLockedByFault, isAnyLocked } = require('../faultStatus/faultStatus')

/** 每个设备的 PID 状态。
 *  - windowStart: 本 PWM 周期起始时间戳（ms，相对服务器时钟）
 *  - onDurationMs: 本周期内加热器应该开启的累计时长（ms）
 *  - integral: 积分项累计值（Σe·Δt）
 *  - lastError: 上一次评估时的误差（用于微分项）
 *  - hasLastError: 是否已经积累过一次 error（第一次没有微分）
 *  - lastDuty: 上一次算出的占空比（%），用于调试日志
 *  - cycleIndex: 已经完成的 PWM 周期计数，判断是否需要重新计算
 *  - lastEvalTs: 上次评估时间戳，避免过于频繁的重复指令下发（防抖）
 */
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

/** 没有 preffix 的本地参数（Kp/Ki/Kd/控制周期/占空比上下限）按 t_name 精确匹配查 id。 */
async function resolveConfigIdByName(name) {
  const [rows] = await promisePool.query(
    'SELECT id FROM t_direct_config WHERE t_name = ? ORDER BY id ASC LIMIT 1',
    [name]
  )
  return rows[0]?.id ?? null
}

function toNumber(raw) {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** 读取一个开关类指令项（preffix）的当前值，返回 true/false/null（null=未配置/未取到值）。 */
async function readSwitchOn(prefix, deviceNo) {
  const configId = await resolveConfigIdByPrefix(prefix)
  if (configId == null) return null
  const value = await getDirectValue({ config_id: configId, d_no: deviceNo })
  if (value == null) return null
  const v = String(value).trim().toLowerCase()
  return ['on', 'open', '1', 'true'].includes(v)
}

/**
 * PID 是否真正启用：需要"自动控制开关"（preffix=auto_control_enabled）和
 * "PID恒温控制"（preffix=pid_enabled）两个指令项都是开，缺一不可（外层总开关 + 内层
 * PID 专属开关的两级结构）。两个指令项都还没配置时才退回 PID_HEATING.enabled 兜底。
 */
async function isPidEnabled(deviceNo) {
  // 自整定运行期间也要接管加热，autoControl.js/layeredControl.js 都是靠这个函数
  // 判断是否让位给 PID，顺带让它们在自整定时也让位，不需要额外改这两个文件。
  if (systemConfig.getConfig().PID_AUTOTUNE?.enabled === true) return true
  const master = await readSwitchOn('auto_control_enabled', deviceNo)
  const pid = await readSwitchOn('pid_enabled', deviceNo)
  if (master == null && pid == null) {
    return systemConfig.getConfig().PID_HEATING?.enabled === true
  }
  return master === true && pid === true
}

/** 读取一个按 t_name 匹配的本地数值参数（Kp/Ki/Kd/控制周期/占空比上下限），没配置就用兜底默认值。 */
async function getPidNumber(name, deviceNo, fallback) {
  const configId = await resolveConfigIdByName(name)
  const value = configId != null
    ? await toNumber(await getDirectValue({ config_id: configId, d_no: deviceNo }))
    : null
  return value != null ? value : fallback
}

async function getTargetTemp(deviceNo, fallback) {
  const configId = await resolveConfigIdByPrefix('target_temperature')
  const value = configId != null
    ? await toNumber(await getDirectValue({ config_id: configId, d_no: deviceNo }))
    : null
  return value != null ? value : Number(fallback) || 22
}

/**
 * 读取 T1 进水温度（temp_in / field1）。
 * 仅供参考和诊断使用，不作为 PID 控制目标。
 */
async function readTempIn(info) {
  const aliases = await resolveFieldAliases('t_sensor_data', 'field1')
  return toNumber(firstValue(info, aliases))
}

/**
 * 读取 T2 出水温度（temp_out / field2）。
 * ⭐ 这是 PID 的核心控制目标，PID 让它稳定到 targetTemperature。
 * 对于固定功率加热器 + 流动水系统，出水口温度才是真正的被控对象。
 */
async function readTempOut(info) {
  const aliases = await resolveFieldAliases('t_sensor_data', 'field2')
  return toNumber(firstValue(info, aliases))
}

/**
 * 读取当前加热开关状态，返回 true/false/null。
 * 兼容多种上报格式：on/open/1/true -> on，其余 -> off，没数据 -> null
 * 注意：返回 null 代表"未知"，调用方应保守处理（视为需要同步下发，避免永远不开/永远不关）。
 */
async function readHeatOn(info) {
  const aliases = await resolveFieldAliases('t_behavior_data', 'field2')
  const raw = firstValue(info, aliases)
  if (raw == null || raw === '') return null
  const s = String(raw).trim().toLowerCase()
  if (['on', 'open', '1', 'true'].includes(s)) return true
  if (['off', 'close', 'closed', '0', 'false'].includes(s)) return false
  // 其余未知值保守返回 null
  return null
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
    stateMap.set(key, {
      windowStart: 0,
      onDurationMs: 0,
      integral: 0,
      lastError: 0,
      hasLastError: false,
      lastDuty: 0,
      cycleIndex: -1,
      lastEvalTs: 0,
      // 记住上一次下发的加热状态，避免因 heatOn=null（无行为上报）导致每次都重复下发
      lastSentHeater: null,  // 'on' / 'off' / null
      // 精准控制增强字段
      filteredDerivative: 0,   // 微分项一阶低通滤波值
      lastDutyRaw: 0,          // 斜率限制前的原始 duty，用于计算变化量
      lastTempIn: null,         // 上一次进水温度，用于前馈计算
    })
  }
  return stateMap.get(key)
}

/* ============================ 主评估 ============================ */

/**
 * 防抖阈值（ms）：两次 setHeater 下发之间的最小时长。
 * 固定功率 PWM 控制中，继电器开关寿命关键：一个 PWM 周期最多开/关各一次。
 * 这里设为 500ms：即使传感器 1s 上报一次，也不会反复抖动下发。
 */
const MIN_COMMAND_INTERVAL_MS = 500

/**
 * 最小 PWM 周期（ms）：防止配置误填导致继电器疯狂切换。
 * 200W 固定功率加热器建议 10000ms 起步，低于 2000ms 强制抬升。
 */
const MIN_PID_WINDOW_MS = 2000

async function evaluatePidHeating(info) {
  const deviceNo = String((await resolveDeviceNo(info)) || '').trim() || null

  // ====== 故障锁短路 ======
  // 故障态下 faultStatus 已强制关闭水泵和加热、并锁定指令页面，
  // PID 必须立即返回，避免下一条 MQTT 消息到达时把加热又重新打开。
  const rootConfig = systemConfig.getConfig()
  if (rootConfig.SINGLE_DEVICE_MODE === true) {
    if (isAnyLocked()) return []
  } else {
    if (isLockedByFault(deviceNo)) return []
  }

  // ====== 自整定接管 ======
  // 自整定开启时，这条消息交给继电反馈测试处理，不跑正常 PID，避免两边抢控加热。
  if (rootConfig.PID_AUTOTUNE?.enabled === true) {
    const { evaluateAutoTune } = require('./pidAutoTune')
    return evaluateAutoTune(info)
  }

  if (!(await isPidEnabled(deviceNo))) return []

  const fallback = rootConfig.PID_HEATING || {}

  // ⭐ PID 的被控量：T2 出水温度（temp_out / field2）
  const tempOut = await readTempOut(info)
  if (tempOut == null) return []

  // T1 进水温度：用于诊断显示，不参与控制
  const tempIn = await readTempIn(info)

  // 当前加热开关状态（行为上报）。允许为 null（未知），null 时做保守同步。
  const heatOn = await readHeatOn(info)

  const targetTemp = await getTargetTemp(deviceNo, rootConfig.DEFAULT_TARGET_TEMP)

  // PID 参数读取
  const windowMsRaw = await getPidNumber('PID控制周期(ms)', deviceNo, fallback.windowMs ?? 10000)
  const windowMs = Math.max(MIN_PID_WINDOW_MS, Number.isFinite(windowMsRaw) && windowMsRaw > 0 ? windowMsRaw : 10000)
  const kp = Number(await getPidNumber('Kp（比例系数）', deviceNo, fallback.kp ?? 0)) || 0
  const ki = Number(await getPidNumber('Ki（积分系数）', deviceNo, fallback.ki ?? 0)) || 0
  const kd = Number(await getPidNumber('Kd（微分系数）', deviceNo, fallback.kd ?? 0)) || 0
  const dutyMinRaw = Number(await getPidNumber('占空比下限(%)', deviceNo, 0)) || 0
  const dutyMaxRaw = Number(await getPidNumber('占空比上限(%)', deviceNo, 100)) || 100
  const dutyMin = Math.max(0, Math.min(100, Math.min(dutyMinRaw, dutyMaxRaw)))
  const dutyMax = Math.max(0, Math.min(100, Math.max(dutyMinRaw, dutyMaxRaw)))

  // 精准控制增强参数（有兜底默认值，未配置时自动启用合理值）
  // 死区：误差绝对值小于此值时保持上一次 duty，避免微小误差导致继电器抖动
  const deadband = Number(await getPidNumber('死区(℃)', deviceNo, fallback.deadband ?? 0.2)) || 0
  // 微分滤波系数 0~1：越大越跟踪原始值，越小滤波越强（0.3 = 70% 滤波）
  const derivativeFilter = Math.max(0, Math.min(1, Number(await getPidNumber('微分滤波系数', deviceNo, fallback.derivativeFilter ?? 0.3)) || 0.3))
  // 输出斜率限制(%/周期)：duty 单次最大变化幅度，防止阶跃跳变
  const dutyRampLimit = Math.max(0, Number(await getPidNumber('占空比斜率限制(%/周期)', deviceNo, fallback.dutyRampLimit ?? 15)) || 0)
  // 前馈系数：进水温度变化时提前调整 duty，补偿热惯性
  const kff = Number(await getPidNumber('前馈系数', deviceNo, fallback.kff ?? 0)) || 0

  const state = getState(deviceNo)
  const now = Date.now()

  // ============================================================
  // ⭐ PWM 周期边界检测：基于 now 与 windowStart 计算跨过了多少个完整周期
  // 低频上报（数据间隔 > windowMs）也能正确"跳过"整个周期并重新计算占空比
  // ============================================================
  let needRecompute = false
  if (state.windowStart === 0) {
    // 第一次运行：立即进入周期并计算占空比
    needRecompute = true
  } else {
    const elapsedSinceStart = now - state.windowStart
    if (elapsedSinceStart >= windowMs) {
      needRecompute = true
      // 将 windowStart 对齐到最接近的上一个窗口边界（避免漂移）
      const crossedFullCycles = Math.floor(elapsedSinceStart / windowMs)
      state.windowStart += crossedFullCycles * windowMs
      state.cycleIndex += crossedFullCycles
    }
  }

  if (needRecompute) {
    if (state.windowStart === 0) {
      state.windowStart = now
      state.cycleIndex = 0
    }
    const dtSec = windowMs / 1000
    // 核心误差 = 目标出水温度 - 当前出水温度
    const error = targetTemp - tempOut

    // ① 死区：误差绝对值小于 deadband 时保持上一次 duty 不变
    // 避免温度已在目标附近微小波动时继电器频繁切换
    if (state.hasLastError && Math.abs(error) < deadband) {
      // 保持上一次 duty，仅更新窗口时间戳，跳过 PID 计算
      state.lastError = error
      console.log(`[PidHeating] PWM窗口#${state.cycleIndex} 死区激活 | T_out=${tempOut.toFixed(1)}℃ 误差=${error.toFixed(2)}℃ < 死区${deadband}℃ | 保持占空比=${state.lastDuty}%`)
    } else {
      // 正常 PID 计算
      const pTerm = kp * error

      // ② 微分项一阶低通滤波：减小传感器噪声对 D 项的放大
      // 公式：dFiltered = α·dRaw + (1-α)·dFiltered
      const rawDerivative = state.hasLastError ? (error - state.lastError) / dtSec : 0
      const alpha = derivativeFilter
      state.filteredDerivative = state.hasLastError
        ? alpha * rawDerivative + (1 - alpha) * state.filteredDerivative
        : 0
      const dTerm = kd * state.filteredDerivative

      // ④ 前馈控制：进水温度变化时提前调整 duty，补偿热惯性
      // ff = Kff × (T_target - T_in)，进水越冷前馈越大
      let ffTerm = 0
      if (kff > 0 && tempIn != null) {
        ffTerm = kff * (targetTemp - tempIn)
        state.lastTempIn = tempIn
      }

      // 条件积分抗饱和：只有当占空比真正顶到上/下限，且积分继续累加会让它更出界时，
      // 才暂停积分累加。
      const rawIntegral = state.integral + error * dtSec
      const uBefore = pTerm + ki * state.integral + dTerm + ffTerm
      const dutyBefore = Math.max(dutyMin, Math.min(dutyMax, uBefore))
      const uAfter  = pTerm + ki * rawIntegral + dTerm + ffTerm
      const dutyAfter  = Math.max(dutyMin, Math.min(dutyMax, uAfter))
      const kiBefore = ki * state.integral
      const kiAfter  = ki * rawIntegral
      const saturatedHigh =
        dutyBefore >= dutyMax && dutyAfter >= dutyMax && error > 0 && kiAfter >= kiBefore
      const saturatedLow =
        dutyBefore <= dutyMin && dutyAfter <= dutyMin && error < 0 && kiAfter <= kiBefore
      if (!saturatedHigh && !saturatedLow) state.integral = rawIntegral

      const u = pTerm + ki * state.integral + dTerm + ffTerm
      let duty = Math.max(dutyMin, Math.min(dutyMax, u))

      // ③ 输出斜率限制：duty 单次最大变化幅度，防止阶跃跳变
      // 限制变化量在 ±dutyRampLimit% 以内（0 = 不限制）
      if (dutyRampLimit > 0 && state.hasLastError) {
        const dutyChange = duty - state.lastDuty
        if (Math.abs(dutyChange) > dutyRampLimit) {
          duty = state.lastDuty + Math.sign(dutyChange) * dutyRampLimit
          duty = Math.max(dutyMin, Math.min(dutyMax, duty))
        }
      }

      // 本窗口内加热器应该开启的时长（秒级 PWM，固定 200W 功率）
      state.onDurationMs = Math.max(0, Math.min(windowMs, (duty / 100) * windowMs))
      state.lastError = error
      state.hasLastError = true
      state.lastDutyRaw = Number(duty.toFixed(1))
      state.lastDuty = Number(duty.toFixed(1))

      // 诊断日志
      const diag = [
        `[PidHeating] PWM窗口#${state.cycleIndex}`,
        `设备=${deviceNo || '全局'}`,
      ]
      if (tempIn != null) diag.push(`T_in=${tempIn.toFixed(1)}℃`)
      diag.push(`T_out=${tempOut.toFixed(1)}℃`)
      diag.push(`目标=${targetTemp}℃`)
      diag.push(`误差=${Number(error.toFixed(2))}℃`)
      diag.push(`P=${Number(pTerm.toFixed(2))} I=${Number((ki * state.integral).toFixed(2))} D=${Number(dTerm.toFixed(2))}`)
      if (kff > 0 && ffTerm !== 0) diag.push(`FF=${Number(ffTerm.toFixed(2))}`)
      diag.push(`占空比=${state.lastDuty}% (开${Math.round(state.onDurationMs)}ms/周期${windowMs}ms)`)
      if (saturatedHigh || saturatedLow) {
        diag.push(`[抗饱和激活${saturatedHigh ? '上限' : '下限'}，积分暂停累加]`)
      }
      if (dutyRampLimit > 0 && Math.abs(duty - state.lastDutyRaw) >= dutyRampLimit) {
        diag.push(`[斜率限制${dutyRampLimit}%/周期]`)
      }
      console.log(diag.join(' | '))
    }
  }

  // ============================================================
  // 确定本窗口此时此刻 heater 应该是 on 还是 off
  // ============================================================
  const elapsedInWindow = now - state.windowStart
  // 当 onDurationMs 等于窗口时长（100% 占空比）或 elapsedInWindow < onDurationMs 时开启
  const desired = (state.onDurationMs >= windowMs || elapsedInWindow < state.onDurationMs) ? 'on' : 'off'

  // ============================================================
  // 指令下发（带防抖 + 状态未知时的保守同步）
  // 条件：
  //  1. 两次下发间隔 >= MIN_COMMAND_INTERVAL_MS
  //  2. heatOn 已知且与 desired 不一致 → 需要切换
  //     或 heatOn 未知（null）且 desired != lastSentHeater → 做同步，避免静默
  // ============================================================
  const actions = []
  const timeSinceLastCmd = now - state.lastEvalTs

  let shouldSend = false
  if (timeSinceLastCmd >= MIN_COMMAND_INTERVAL_MS) {
    if (heatOn !== null) {
      // 行为上报存在，只在不一致时下发
      shouldSend = heatOn !== (desired === 'on')
    } else {
      // 行为上报未知（无 field2），与上一次实际下发不一致时同步
      shouldSend = state.lastSentHeater !== desired
    }
  }

  if (shouldSend) {
    try {
      await setHeater(desired, deviceNo, 'pid_heating')
      state.lastEvalTs = now
      state.lastSentHeater = desired
      actions.push({
        device: 'heater',
        action: desired,
        duty: state.lastDuty,
        tempOut,
        tempIn,
        targetTemp,
        reason: heatOn === null ? '(行为未知，保守同步)' : (desired === 'on' ? '占空比阶段开启' : '占空比阶段关闭'),
      })
    } catch (err) {
      console.error(`[PidHeating] 下发加热指令失败: ${err.message}`)
    }
  }

  return actions
}

// readTempOut/getTargetTemp/setHeater/resolveConfigIdByName 额外导出给 pidAutoTune.js 复用，
// 避免自整定服务重复实现同一套字段读取/指令下发逻辑。
module.exports = { evaluatePidHeating, isPidEnabled, readTempOut, getTargetTemp, setHeater, resolveConfigIdByName }