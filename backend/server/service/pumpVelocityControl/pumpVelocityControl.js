/**
 * 【文件职责】水泵恒流速控制——水泵只有开关量、没有变频调速，所以用两套互斥的算法
 * 把"开关"逼近"恒定流速"，赛场上哪套合适就开哪套：
 *
 *   ① 滞环通断（hysteresis）：流速低于"目标-回差"开泵，达到目标关泵，中间维持现状。
 *      跟加热的滞回带通断是同一种思路，实现简单、不需要整定参数。但流速几乎没有惯性
 *      （不像温度关掉加热还会缓慢下降），单纯比大小会让水泵在目标值附近高频启停，
 *      也就是工业上说的"短循环"（short cycling），是烧电机的典型原因。所以这里除了
 *      回差，还强制了最小开启时长/最小关闭时长：泵一旦动作，必须保持这么久才允许
 *      反向动作，把开关频率钉死在安全范围内。
 *
 *   ② 占空比控制（pid）：跟 service/pidHeating/pidHeating.js 同一套时间比例控制思路，
 *      固定一个周期 windowMs，PID 按流速误差算出占空比，决定这个周期内水泵开多久、
 *      关多久，调节的是"周期内的平均流速"。比滞环平滑，但需要整定 Kp/Ki/Kd。
 *      周期下限比加热 PID 更保守（加热 2 秒，这里 10 秒），因为水泵启停的水锤冲击和
 *      电机启动电流远大于加热器——正因为冲击更大，微分滤波（derivativeFilter）和
 *      占空比斜率限制（dutyRampLimit）这两个 pidHeating.js 有的增强手段，这里也是
 *      完整实现，不是简化版，见 decideByDuty。
 *
 * 被控量是管内平均流速 v = Q / A（m/s），由管路流量读数（field3，L/min）和配置中心
 * COMPUTED_METRICS.pipeAreaCm2 换算得到，换算实现见 controlShared/controlHelpers.js
 * 的 toVelocity()。管道横截面积没配置时算不出流速，本模块整轮不动作并打日志，
 * 不会拿错误的流速去开关水泵。
 *
 * 两套算法都只在"平均意义"上恒流速：水泵开着是额定流速、关着是 0，瞬时流速始终是
 * 脉冲式的，要让用水点真正感受到连续流速，依赖管路下游有缓冲容积（水箱/储液罐/
 * 弹性管路）把脉冲抹平。这是开关量执行器的物理限制，不是软件能绕开的。
 *
 * 【与其他控制模块的关系】
 * 本模块启用后接管水泵，service/linkageRules/linkageRules.js 里那些控制水泵的规则
 * （pumpAlwaysOn/flowSingle/pressureSingle 等）自动让位，避免两边抢同一个执行器——
 * 跟"PID 恒温启用后 linkageRules 不再下发加热"是完全对称的设计。故障状态
 * （faultStatus）和安全联锁（safetyInterlock）是更高优先级的独立保护层，触发后照样
 * 强制关泵，本模块在故障锁定时直接短路返回，不参与竞争。
 *
 * 【指令项删除安全】两个启用开关走 readSwitchOn，指令项被删掉时返回 null，
 * `=== true` 判定为 false，等同未启用；所有数值参数走 getNumberValue 三级兜底
 * （指令中心 → 配置中心 PUMP_VELOCITY_CONTROL → 硬常量），删掉任意一个指令项只是
 * 让它退回下一层，不会把 NaN 带进流速比较里让规则悄悄失效。
 *
 * 【配置中心关联】PUMP_VELOCITY_CONTROL 每次评估动态读取，保存后立即生效；
 * COMPUTED_METRICS.pipeAreaCm2 用于流速换算，同样实时读取。
 */
// 恒流速自己的兜底参数（两套算法的开关、目标流速、防短循环时长、PID 参数）在这里。
const CONFIG = require('./config')
const { SINGLE_DEVICE_MODE } = require('../../config/appSettings')
const { COMPUTED_METRICS } = require('../../config/metrics')
const { resolveDeviceNo } = require('../../utils/mappedData')
const { getCurrentMode } = require('../directData/getControlMode')
const { readSwitchOn } = require('../pidHeating/pidHeating')
const { isLockedByFault, isAnyLocked } = require('../faultStatus/faultStatus')
const {
  getNumberValue,
  readSensors,
  readSwitchStates,
  toVelocity,
  setSwitch,
} = require('../controlShared/controlHelpers')

/**
 * 每台设备一份运行时状态。占空比方案要跨消息记住 PWM 窗口进度和积分项，
 * 滞环方案要记住上一次动作时间来兑现最小开/关时长，都放这里。
 *  - windowStart / cycleIndex / onDurationMs / lastDuty: 占空比方案的 PWM 窗口
 *  - integral / lastError / hasLastError: PID 累积状态
 *  - lastSwitchTs / lastSwitchTo: 上一次真正下发的水泵动作时间和方向，滞环的最小
 *    开/关时长和"行为状态未知时的保守同步"都基于它
 */
const stateMap = new Map()

/** 最小 PWM 周期（ms）：水泵启停冲击大，周期下限比加热 PID（2000ms）保守得多。 */
const MIN_PUMP_WINDOW_MS = 10000

/** 两次下发之间的硬性最小间隔（ms），任何算法、任何情况都不突破。 */
const MIN_COMMAND_INTERVAL_MS = 1000

/** 管道横截面积没配置导致算不出流速时，日志限流用（避免每条消息刷屏）。 */
const lastAreaWarnTs = new Map()
const AREA_WARN_INTERVAL_MS = 60000

function getState(deviceNo) {
  const key = deviceNo || 'global'
  if (!stateMap.has(key)) {
    stateMap.set(key, {
      windowStart: 0,
      cycleIndex: -1,
      onDurationMs: 0,
      lastDuty: 0,
      integral: 0,
      lastError: 0,
      hasLastError: false,
      lastSwitchTs: 0,
      lastSwitchTo: null,   // 'on' / 'off' / null（还没下发过）
      lastEvalTs: 0,
      filteredDerivative: 0,  // 微分项一阶低通滤波值，跟 pidHeating.js 同一套实现
      lastDutyRaw: 0,         // 斜率限制前的原始 duty，用于计算变化量
    })
  }
  return stateMap.get(key)
}

/**
 * 恒流速控制是否启用，以及用哪套算法。
 * 跟 pidHeating.js/isPidEnabled 对称的写法：外层总开关 + 内层算法开关的两级结构，
 * 必须总开关（auto_control_enabled）也是开，算法开关才算数。
 * 两个算法开关都开时占空比优先（跟加热那边 PID 优先于滞回带的取舍一致：
 * 占空比是更精细的那个）。只有两个算法开关都没配置时才退回配置中心兜底；
 * 总开关明确是关时，兜底也不生效（现场明确关掉自动控制）。
 * @returns {Promise<'pid'|'hysteresis'|null>} null = 未启用
 */
async function resolvePumpVelocityMode(deviceNo) {
  const master = await readSwitchOn('auto_control_enabled', deviceNo)
  const pidOn = await readSwitchOn('pump_velocity_pid_enabled', deviceNo)
  const hysOn = await readSwitchOn('pump_velocity_hysteresis_enabled', deviceNo)

  // 只看算法开关：两个算法开关都没配才走配置中心兜底（对齐恒温 isPidEnabled）。
  // 任一算法开关配了就以指令页面为准；总开关明确是关时兜底也不生效。
  if (pidOn == null && hysOn == null) {
    const fallback = CONFIG
    if (fallback.enabled !== true) return null
    if (master === false) return null
    return fallback.mode === 'pid' ? 'pid' : 'hysteresis'
  }

  if (master !== true) return null
  if (pidOn === true) return 'pid'
  if (hysOn === true) return 'hysteresis'
  return null
}

/**
 * 供 linkageRules.js 判断"水泵是否已被恒流速控制接管"，接管了它就不下发水泵指令。
 * 这里只回答"启用了没有"，不关心用哪套算法。
 */
async function isPumpVelocityControlEnabled(deviceNo) {
  return (await resolvePumpVelocityMode(deviceNo)) != null
}

/** 目标流速（m/s）：两套算法共用的唯一设定值（对齐"整个项目只保留一个目标温度"的做法）。 */
async function getTargetVelocity(deviceNo, fallback) {
  return getNumberValue('target_velocity', deviceNo, fallback, 1)
}

/* ============================ 算法① 滞环通断 ============================ */

/**
 * 滞环判定：只看流速和目标值的相对位置，不看时间——最小开/关时长的约束在
 * 外面的下发环节统一把关，保持这个函数是纯函数、好测。
 *   v >= target            -> 关泵（已经够了）
 *   v <  target - 回差     -> 开泵（掉出滞环带下沿）
 *   两者之间               -> 维持现状（滞环带内不动作，这正是回差的意义）
 * @returns {'on'|'off'|null} null = 维持现状
 */
function decideByHysteresis(velocity, targetVelocity, hysteresis) {
  if (velocity == null) return null
  if (velocity >= targetVelocity) return 'off'
  if (velocity < targetVelocity - hysteresis) return 'on'
  return null
}

/* ============================ 算法② 占空比控制 ============================ */

/**
 * 推进 PWM 窗口并在窗口边界重算占空比，返回此刻水泵应该处于的状态。
 * 结构跟 pidHeating.js 的时间比例控制一致：窗口边界才跑 PID，窗口内部按
 * onDurationMs 切开/关。误差 = 目标流速 - 当前流速。
 * @returns {'on'|'off'}
 */
function decideByDuty(state, now, velocity, targetVelocity, params) {
  const { windowMs, kp, ki, kd, dutyMin, dutyMax, deadband, derivativeFilter, dutyRampLimit } = params

  // ====== 窗口边界检测 ======
  // 低频上报（两条数据间隔比 windowMs 还长）时要能一次跨过多个完整周期，
  // 并把 windowStart 对齐到最近的窗口边界，避免长期漂移。
  let needRecompute = false
  if (state.windowStart === 0) {
    needRecompute = true
    state.windowStart = now
    state.cycleIndex = 0
  } else {
    const elapsed = now - state.windowStart
    if (elapsed >= windowMs) {
      needRecompute = true
      const crossed = Math.floor(elapsed / windowMs)
      state.windowStart += crossed * windowMs
      state.cycleIndex += crossed
    }
  }

  if (needRecompute && velocity != null) {
    const dtSec = windowMs / 1000
    const error = targetVelocity - velocity

    // 死区：误差很小时保持上一次占空比，不让传感器噪声推着占空比来回跳。
    if (state.hasLastError && Math.abs(error) < deadband) {
      // 死区（deadband）：误差小到可以忽略时，什么都不算、直接沿用上一次的占空比。
      // 目的是防止传感器读数的正常抖动（比如流速在 0.99~1.01 之间跳）被 PID 当成
      // "真的偏离目标了"，从而没完没了地微调占空比、让水泵继电器一直在细微切换。
      state.lastError = error
      console.log(`[PumpVelocityControl] PWM窗口#${state.cycleIndex} 死区激活 | 流速=${velocity}m/s 误差=${error.toFixed(4)} < 死区${deadband} | 保持占空比=${state.lastDuty}%`)
    } else {
      // ============================================================
      // PID 三项各自负责什么（error = 目标流速 - 当前流速，正数=流速不够要加大占空比）：
      //   P（比例项，pTerm = kp * error）
      //     -"现在差多少就修正多少"，误差越大占空比调整越猛，反应最快但单独用会有
      //      "永远差一点点补不平"的稳态误差（比如占空比刚好稳定在能让水泵转起来但
      //      流速还差 0.05 的位置，P 项这时算出来的修正量很小，不足以推它到目标）。
      //   I（积分项，ki * state.integral，state.integral 是历史误差的累加和）
      //     -专门补 P 项留下的"差一点点"：只要误差还没消灭，积分项就一直在长大，
      //      直到把占空比顶到刚好能消除稳态误差为止。代价是反应比 P 项慢，如果
      //      调太大容易让系统在目标值附近来回冲过头（振荡）。
      //   D（微分项，dTerm = kd * 误差变化速度）
      //     -"看误差变化得有多快"，提前刹车：误差正在快速缩小时先减小修正力度，
      //      避免冲过头。跟温度控制不同，流速信号本身噪声更明显，所以这个项默认
      //      给 0（不用），确实需要更快响应再打开——打开后走的是跟 pidHeating.js
      //      同一套一阶低通滤波（derivativeFilter），不是拿原始误差变化率直接乘 kd，
      //      避免流速抖动被 D 项放大成占空比乱跳。
      const pTerm = kp * error
      const rawDerivative = state.hasLastError ? (error - state.lastError) / dtSec : 0
      state.filteredDerivative = state.hasLastError
        ? derivativeFilter * rawDerivative + (1 - derivativeFilter) * state.filteredDerivative
        : 0
      const dTerm = kd * state.filteredDerivative

      // 条件积分抗饱和（anti-windup）：先说清楚"积分饱和"是什么问题——如果水泵已经
      // 开到 100% 占空比、流速还是不够（比如水泵本身功率不够大），积分项会因为
      // "误差一直存在"而无限累加下去，越滚越大。等哪天流速终于够了甚至超了，
      // 误差变成负数，这个已经滚得很大的积分项要花很长时间才能"退烧"到合理范围，
      // 期间占空比会一直卡在高位下不来，导致水泵长时间超调。
      // 解决办法：先分别算出"不让积分累加"和"让积分累加"这两种情况下的占空比会是
      // 多少（dutyBefore / dutyAfter），如果发现占空比已经顶到了上限或下限、且继续
      // 累加积分只会让它更加顶死不动（误差方向跟顶住的方向一致），就暂停累加，把
      // 积分项"冻结"在当前值——只有当占空比不再顶边、或者误差反向了，才恢复累加。
      const rawIntegral = state.integral + error * dtSec
      const uBefore = pTerm + ki * state.integral + dTerm
      const uAfter = pTerm + ki * rawIntegral + dTerm
      const dutyBefore = Math.max(dutyMin, Math.min(dutyMax, uBefore))
      const dutyAfter = Math.max(dutyMin, Math.min(dutyMax, uAfter))
      const saturatedHigh = dutyBefore >= dutyMax && dutyAfter >= dutyMax && error > 0
      const saturatedLow = dutyBefore <= dutyMin && dutyAfter <= dutyMin && error < 0
      if (!saturatedHigh && !saturatedLow) state.integral = rawIntegral

      // 三项相加得到最终输出 u，再夹在 [占空比下限, 占空比上限] 之间——即使
      // PID 算出来是负数或者超过 100%，实际下发的占空比也不会越界。
      const u = pTerm + ki * state.integral + dTerm
      const dutyBeforeRamp = Math.max(dutyMin, Math.min(dutyMax, u))
      let duty = dutyBeforeRamp

      // 占空比斜率限制：单次最大变化幅度限制在 ±dutyRampLimit% 以内（0=不限制），
      // 防止占空比阶跃跳变——水泵启停的水锤冲击和电机启动电流比加热器更大，
      // 这层平滑保护尤其值得留着，跟 pidHeating.js 是同一套实现。
      if (dutyRampLimit > 0 && state.hasLastError) {
        const dutyChange = duty - state.lastDuty
        if (Math.abs(dutyChange) > dutyRampLimit) {
          duty = state.lastDuty + Math.sign(dutyChange) * dutyRampLimit
          duty = Math.max(dutyMin, Math.min(dutyMax, duty))
        }
      }
      const rampLimited = duty !== dutyBeforeRamp

      state.onDurationMs = Math.max(0, Math.min(windowMs, (duty / 100) * windowMs))
      state.lastDutyRaw = Number(dutyBeforeRamp.toFixed(1))
      state.lastDuty = Number(duty.toFixed(1))
      state.lastError = error
      state.hasLastError = true

      const diag = [
        `[PumpVelocityControl] PWM窗口#${state.cycleIndex}`,
        `流速=${velocity}m/s`,
        `目标=${targetVelocity}m/s`,
        `误差=${Number(error.toFixed(4))}`,
        `P=${Number(pTerm.toFixed(2))} I=${Number((ki * state.integral).toFixed(2))} D=${Number(dTerm.toFixed(2))}`,
        `占空比=${state.lastDuty}% (开${Math.round(state.onDurationMs)}ms/周期${windowMs}ms)`,
      ]
      if (saturatedHigh || saturatedLow) diag.push(`[抗饱和激活${saturatedHigh ? '上限' : '下限'}]`)
      if (rampLimited) diag.push(`[斜率限制${dutyRampLimit}%/周期，原始占空比=${state.lastDutyRaw}%]`)
      console.log(diag.join(' | '))
    }
  }

  const elapsedInWindow = now - state.windowStart
  return (state.onDurationMs >= windowMs || elapsedInWindow < state.onDurationMs) ? 'on' : 'off'
}

/* ============================ 主评估 ============================ */

/**
 * 每条传感器/合并实时消息都会走一次：判断恒流速控制是否启用、用哪套算法算出
 * 水泵此刻应有的状态，再决定要不要真的下发。
 * @param {Object} info - 规范化后的实时数据
 * @returns {Promise<Array>} 本次实际下发的动作（没动作就是空数组）
 */
async function evaluatePumpVelocityControl(info) {

  // ====== 故障锁短路 ======
  // 故障态下 faultStatus 已经强制关泵并锁定指令页面，这里不再参与控制。
  if (SINGLE_DEVICE_MODE === true) {
    if (isAnyLocked()) return []
  } else {
    const preDeviceNo = String((await resolveDeviceNo(info)) || '').trim() || null
    if (isLockedByFault(preDeviceNo)) return []
  }

  const deviceNo = String((await resolveDeviceNo(info)) || '').trim() || null

  // ====== 手动模式短路 ======
  if ((await getCurrentMode(deviceNo)) === 'manual') return []

  const mode = await resolvePumpVelocityMode(deviceNo)
  if (mode == null) return []

  const fallback = CONFIG
  const sensors = await readSensors(info)
  const states = await readSwitchStates(info)

  // 被控量：管内平均流速 v = Q / A。管道横截面积没配置就算不出来，
  // 这时整轮不动作——拿错误的流速去开关水泵比不动作危险得多。
  const velocity = toVelocity(sensors.flow)
  if (velocity == null) {
    const key = deviceNo || 'global'
    const now = Date.now()
    if (now - (lastAreaWarnTs.get(key) || 0) >= AREA_WARN_INTERVAL_MS) {
      lastAreaWarnTs.set(key, now)
      console.warn(`[PumpVelocityControl] 设备 ${key} 算不出流速（流量读数=${sensors.flow}，管道横截面积=${COMPUTED_METRICS?.pipeAreaCm2}），本轮不动作。请到配置中心"计算数据"页填写管道横截面积。`)
    }
    return []
  }

  const targetVelocity = await getTargetVelocity(deviceNo, fallback.defaultTargetVelocity)
  const state = getState(deviceNo)
  const now = Date.now()

  let desired = null
  if (mode === 'hysteresis') {
    const hysteresis = await getNumberValue('pump_velocity_hysteresis', deviceNo, fallback.hysteresis, 0.1)
    desired = decideByHysteresis(velocity, targetVelocity, hysteresis)
    if (desired == null) return []   // 滞环带内维持现状，本轮不动作
  } else {
    const [windowMsRaw, kp, ki, kd, deadband, derivativeFilterRaw, dutyRampLimit] = await Promise.all([
      getNumberValue('pump_velocity_window_ms', deviceNo, fallback.windowMs, 30000),
      getNumberValue('pump_velocity_kp', deviceNo, fallback.kp, 100),
      getNumberValue('pump_velocity_ki', deviceNo, fallback.ki, 5),
      getNumberValue('pump_velocity_kd', deviceNo, fallback.kd, 0),
      getNumberValue('pump_velocity_deadband', deviceNo, fallback.deadband, 0.02),
      getNumberValue('pump_velocity_derivative_filter', deviceNo, fallback.derivativeFilter, 0.3),
      getNumberValue('pump_velocity_duty_ramp_limit', deviceNo, fallback.dutyRampLimit, 15),
    ])
    // 配置里填得再小也不让周期低于 MIN_PUMP_WINDOW_MS，护住水泵。
    const windowMs = Math.max(MIN_PUMP_WINDOW_MS, windowMsRaw > 0 ? windowMsRaw : 30000)
    const dutyMinRaw = Number(fallback.dutyMin) || 0
    const dutyMaxRaw = Number.isFinite(Number(fallback.dutyMax)) ? Number(fallback.dutyMax) : 100
    const dutyMin = Math.max(0, Math.min(100, Math.min(dutyMinRaw, dutyMaxRaw)))
    const dutyMax = Math.max(0, Math.min(100, Math.max(dutyMinRaw, dutyMaxRaw)))
    const derivativeFilter = Math.max(0, Math.min(1, derivativeFilterRaw))
    desired = decideByDuty(state, now, velocity, targetVelocity, {
      windowMs, kp, ki, kd, dutyMin, dutyMax, deadband, derivativeFilter, dutyRampLimit: Math.max(0, dutyRampLimit),
    })
  }

  // ====== 最小开/关时长：两套算法共用的水泵保护 ======
  // 泵刚开起来就必须至少运行 minOnMs，刚停下就必须至少停满 minOffMs，期间不接受
  // 反向指令。这是继电器驱动水泵的标配保护，防短循环（频繁启停烧电机）。
  const [minOnMs, minOffMs] = await Promise.all([
    getNumberValue('pump_velocity_min_on_ms', deviceNo, fallback.minOnMs, 15000),
    getNumberValue('pump_velocity_min_off_ms', deviceNo, fallback.minOffMs, 15000),
  ])
  if (state.lastSwitchTo != null) {
    const held = now - state.lastSwitchTs
    const required = state.lastSwitchTo === 'on' ? minOnMs : minOffMs
    if (desired !== state.lastSwitchTo && held < required) {
      // 想反向但驻留时间不够，本轮压住不动作。
      return []
    }
  }

  // ====== 下发 ======
  // pumpOn 已知时只在不一致时下发；未知（行为数据没上报 field1）时跟上一次实际
  // 下发的方向比，避免因为读不到状态就永远不动作（静默失效）。
  if (now - state.lastEvalTs < MIN_COMMAND_INTERVAL_MS) return []
  const needSend = states.pumpOn != null
    ? states.pumpOn !== (desired === 'on')
    : state.lastSwitchTo !== desired
  if (!needSend) return []

  try {
    await setSwitch('pump', '水泵', desired, deviceNo, 'pump_velocity_control')
  } catch (err) {
    console.error(`[PumpVelocityControl] 下发水泵指令失败: ${err.message}`)
    return []
  }
  state.lastSwitchTs = now
  state.lastSwitchTo = desired
  state.lastEvalTs = now

  const action = {
    device: 'pump',
    action: desired,
    mode,
    velocity,
    targetVelocity,
    reason: states.pumpOn == null ? '(行为未知，保守同步)' : (mode === 'pid' ? '占空比阶段切换' : '滞环带越界'),
  }
  if (mode === 'pid') action.duty = state.lastDuty
  console.log(`[PumpVelocityControl] 设备 ${deviceNo || '全局'} 水泵 -> ${desired}（${mode}），流速=${velocity}m/s 目标=${targetVelocity}m/s`)
  return [action]
}

// decideByHysteresis/decideByDuty 额外导出供单元测试直接验证算法，不经过数据库。
module.exports = {
  evaluatePumpVelocityControl,
  isPumpVelocityControlEnabled,
  resolvePumpVelocityMode,
  getTargetVelocity,
  decideByHysteresis,
  decideByDuty,
}
