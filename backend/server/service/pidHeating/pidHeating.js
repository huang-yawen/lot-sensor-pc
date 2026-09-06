/**
 * 【文件职责】PID 恒温控制服务：把水温连续调节在目标温度 Tset，但加热模块只有开关量、
 * 没有功率输出，所以用"时间比例控制"模拟 PWM——固定一个周期 windowMs，PID 输出的
 * 占空比 duty 决定这个周期内加热开多久、关多久，而不是简单的全开/全关。
 *
 * 公式：u(k) = Kp·e(k) + Ki·Σe(k) + Kd·[e(k)-e(k-1)]，e(k) = Tset - T_out（用 T2 出水温度）。
 * u(k) 限幅到 [占空比下限,占空比上限] 作为占空比；积分项用条件积分做简单抗饱和（占空比
 * 已经顶到上限/下限且误差还在同方向时，暂停累加积分，避免积分饱和）。
 *
 * 【给没学过 PID 的人：三个系数分别在干什么，赛场调参时怎么感觉】
 *   e(k) = 目标温度 - 当前温度，就是"现在还差多少度"。
 *   Kp（比例）：差得越多，占空比给得越大，反应最直接。Kp 调大 -> 升温更快、但容易冲过头
 *     再往回荡（震荡）；Kp 调小 -> 很稳但升温慢、可能永远差一点点到不了目标（稳态误差）。
 *   Ki（积分）：把"过去每一刻的差值"累加起来，专门消灭 Kp 消不掉的那点稳态误差（比如只
 *     靠 Kp 一直卡在目标下面 0.3℃ 不动，Ki 会让它慢慢把这点差距也填平）。Ki 调大 -> 消除
 *     稳态误差更快，但容易导致超调/震荡更明显；Ki 太大甚至会让温度晃个不停。
 *   Kd（微分）：看温度变化的"速度"，快接近目标时提前刹车，抑制冲过头。Kd 调大 -> 超调更小、
 *     更平稳，但对传感器噪声更敏感（数值抖一下 Kd 就会跟着抖，所以代码里加了微分滤波）。
 *   实操顺序建议：先只调 Kp（Ki=Kd=0）调到"能升温、有点小震荡"就行；再加 Ki 消除稳态
 *     误差；最后按需要加一点 Kd 压住超调。
 *
 * 都在"指令配置"页面按两层开关组织："控制模式"（t_direct_config，
 * preffix=auto_control_enabled）下面是目标温度和"PID恒温控制"（preffix=pid_enabled）
 * 子开关，选中时下面才是 Kp/Ki/Kd/控制周期/占空比上下限——控制模式是自动、且
 * PID恒温控制开关是开，PID 才真正启用（见 isPidEnabled）。这些跟流量/压力/温度
 * 阈值一样，都是可以在前端现场调整的指令项；systemConfig.js 的 PID_HEATING 只在
 * 两个指令项都还没配置时用作兜底默认值。
 *
 * 加热滞回带通断是另一个独立的指令项（preffix=heater_hysteresis_enabled，跟本
 * 开关同级、各自独立，不是同一个开关的两个选项），由 linkageRules.js 判断是否
 * 生效。两个开关都是独立指令项，删掉其中任意一个（比如赛场上确定只用某一种
 * 策略）不影响另一个正常运行——查不到就当作未启用，不会报错。两个都开时 PID
 * 优先，linkageRules.js 用 !isPidEnabled(deviceNo) 判断滞回带规则是否轮到自己，
 * 两条策略不会同时下发指令。
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
// 控制模式（手动/自动）统一走 getControlMode，跟 pumpVelocityControl.js 对称。
const { getCurrentMode } = require('../directData/getControlMode')
const { saveOperationHistory } = require('../operationHistory/saveOperationHistory')
// 目标温度是加热控制的公共设定值（SP），滞回带通断和 PID 都读同一个，
// 取值逻辑只在 controlShared/controlHelpers.js 维护一份，这里直接复用。
const { getTargetTemp } = require('../controlShared/controlHelpers')
const { isLockedByFault, isAnyLocked } = require('../faultStatus/faultStatus')
// 周期历史落库：供"历史图表"页面画 PID 加热开关阶梯图，仅展示用途，失败不影响控制。
const { saveCycleRecord } = require('./pidHeatingCycleHistory')
// 水泵未开却要打开加热被拦截时，向前端提示一次（跟手动模式下点开关被拒绝弹的
// ElMessage 是同一件事，只是这里是自动模式下被 PID 自己拦下来），事件由 app.js
// 订阅后转发成 WebSocket 广播，写法跟 faultStatus.js 的 onFault 一致。
const EventEmitter = require('events')
const events = new EventEmitter()

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

/** 按 preffix 精确查 t_direct_config 的 id，查不到返回 null。 */
async function resolveConfigIdByPrefix(prefix) {
  if (!prefix) return null
  const [rows] = await promisePool.query(
    "SELECT id FROM t_direct_config WHERE preffix IS NOT NULL AND preffix != '' AND LOWER(preffix) = LOWER(?) ORDER BY id ASC LIMIT 1",
    [prefix]
  )
  return rows[0]?.id ?? null
}

/**
 * PID 参数槽位定义：每个槽位的 preffix（唯一标识符，代码用这个定位指令项）和
 * t_name（前端显示名，仅作向后兼容兜底）。新增参数时在此加一行即可。
 * 数据库里有值的（如 kp/ki/kd/dutyMin 等）prefox 已在 init/fix_pid_prefix.js 补好；
 * 尚未建指令项的（deadband/derivativeFilter/dutyRampLimit/kff）prefox 已预留，
 * 前端创建后自动生效。
 */
const PID_PARAM_SLOTS = {
  windowMs:         { prefix: 'pid_window_ms',         name: 'PID控制周期(ms)' },
  kp:               { prefix: 'pid_kp',                name: 'Kp（比例系数）' },
  ki:               { prefix: 'pid_ki',                name: 'Ki（积分系数）' },
  kd:               { prefix: 'pid_kd',                name: 'Kd（微分系数）' },
  dutyMin:          { prefix: 'pid_duty_min',          name: '占空比下限(%)' },
  dutyMax:          { prefix: 'pid_duty_max',          name: '占空比上限(%)' },
  deadband:         { prefix: 'pid_deadband',         name: '死区(℃)' },
  derivativeFilter: { prefix: 'pid_derivative_filter', name: '微分滤波系数' },
  dutyRampLimit:    { prefix: 'pid_duty_ramp_limit',    name: '占空比斜率限制(%/周期)' },
  kff:              { prefix: 'pid_kff',               name: '前馈系数' },
}

/** 按槽位名查 PID 参数指令项的 config_id：prefox 优先，找不到再用 t_name 兜底。 */
async function resolveParamConfigId(slot) {
  const def = PID_PARAM_SLOTS[slot]
  if (!def) return null
  const byPrefix = await resolveConfigIdByPrefix(def.prefix)
  if (byPrefix != null) return byPrefix
  // t_name 兜底：历史数据库可能还没补 preffix，保证向后兼容
  const [rows] = await promisePool.query(
    'SELECT id FROM t_direct_config WHERE t_name = ? ORDER BY id ASC LIMIT 1',
    [def.name]
  )
  return rows[0]?.id ?? null
}

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
 * PID 是否真正启用：需要"控制模式"（preffix=auto_control_enabled）和
 * "PID恒温控制"（preffix=pid_enabled）两个指令项都是开，缺一不可（外层总开关 + 内层
 * PID 专属开关的两级结构）。只有 PID 子开关（pid_enabled）没配置时才退回
 * PID_HEATING.enabled 兜底；总开关明确是关时，兜底也不生效（现场明确关掉自动控制）。
 * pid_enabled 这条指令项被删除时 readSwitchOn 返回 null，走配置中心兜底，不会报错
 * ——赛场上删掉这个开关等于"对算法没意见"，由配置中心决定是否启用。
 */
async function isPidEnabled(deviceNo) {
  const master = await readSwitchOn('auto_control_enabled', deviceNo)
  const pid = await readSwitchOn('pid_enabled', deviceNo)
  // 只看算法开关：PID 子开关没配就走配置中心兜底
  if (pid == null) {
    // 总开关明确是关时，兜底也不该生效（现场明确关掉了自动控制）
    if (master === false) return false
    return systemConfig.getConfig().PID_HEATING?.enabled === true
  }
  // PID 子开关配了，以指令页面为准
  return master === true && pid === true
}

/**
 * 读一个 PID 参数槽位（按 PID_PARAM_SLOTS 定义）：先查指令中心，查不到回退到调用方传的兜底值。
 * config_id 定位走 preffix 优先 + t_name 兜底，确保指令项改名后仍能找到。
 */
async function getPidNumber(slot, deviceNo, fallback) {
  const configId = await resolveParamConfigId(slot)
  const value = configId != null
    ? await toNumber(await getDirectValue({ config_id: configId, d_no: deviceNo }))
    : null
  return value != null ? value : fallback
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
 * 返回 null 表示"未知"（没有行为上报数据），调用方会把这种情况当成需要同步下发处理。
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

async function setHeater(value, deviceNo, source) {
  const conf = await findSwitchConfig('heater')
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
      // 水泵未开时是否已经提醒过一次"加热被拦截"，避免每条消息都重复弹提示；
      // 一旦水泵重新开启就清零，下次再被拦截时会重新提醒一次。
      pumpBlockNotified: false,
    })
  }
  return stateMap.get(key)
}

/* ============================ 主评估 ============================ */

/**
 * 防抖阈值（ms）：两次 setHeater 下发之间至少要间隔这么久。
 * 传感器数据 1s 上报一次时，同一个开/关状态也只会下发一次，不会反复发指令。
 */
const MIN_COMMAND_INTERVAL_MS = 500

/**
 * 最小 PWM 周期（ms）：不管配置里 windowMs 填了多少，实际使用的周期都不会低于这个值。
 * 200W 固定功率加热器一般配置 10000ms 起步，这里把下限设在 2000ms。
 */
const MIN_PID_WINDOW_MS = 2000

async function evaluatePidHeating(info) {
  const deviceNo = String((await resolveDeviceNo(info)) || '').trim() || null

  // ====== 故障锁短路 ======
  // 故障态下 faultStatus 已经强制关闭水泵和加热、并锁定了指令页面，
  // 这里直接返回空数组，不再往下走 PID 计算和指令下发。
  const rootConfig = systemConfig.getConfig()
  if (rootConfig.SINGLE_DEVICE_MODE === true) {
    // 不看设备号，只要"系统里任意一台设备"故障锁定了就算数
    if (isAnyLocked()) return []
  } else {
    // 精确查"某一台设备"是否故障锁定
    if (isLockedByFault(deviceNo)) return []
  }


  // ====== 手动模式短路 ======
  // 跟 pumpVelocityControl.js 对称：手动模式下提前 return []，省掉 isPidEnabled
  // 内部对 pid_enabled 的查询（master=off 时 isPidEnabled 必然返回 false，
  // 这里提前拦下来，避免多查一次 pid_enabled 指令项）。
  if ((await getCurrentMode(deviceNo)) === 'manual') return []

  // 自动模式下再走完整的两级开关判定（master + pid）
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

  // PID 参数读取（全部按 preffix 定位，t_name 仅做兜底）
  const windowMsRaw = await getPidNumber('windowMs', deviceNo, fallback.windowMs ?? 10000)
  const windowMs = Math.max(MIN_PID_WINDOW_MS, Number.isFinite(windowMsRaw) && windowMsRaw > 0 ? windowMsRaw : 10000)
  const kp = Number(await getPidNumber('kp', deviceNo, fallback.kp ?? 0)) || 0
  const ki = Number(await getPidNumber('ki', deviceNo, fallback.ki ?? 0)) || 0
  const kd = Number(await getPidNumber('kd', deviceNo, fallback.kd ?? 0)) || 0
  const dutyMinRaw = Number(await getPidNumber('dutyMin', deviceNo, 0)) || 0
  const dutyMaxRaw = Number(await getPidNumber('dutyMax', deviceNo, 100)) || 100
  const dutyMin = Math.max(0, Math.min(100, Math.min(dutyMinRaw, dutyMaxRaw)))
  const dutyMax = Math.max(0, Math.min(100, Math.max(dutyMinRaw, dutyMaxRaw)))

  // 精准控制增强参数（有兜底默认值，未配置时自动启用合理值）
  // 死区：误差绝对值小于此值时保持上一次 duty，避免微小误差导致继电器抖动
  const deadband = Number(await getPidNumber('deadband', deviceNo, fallback.deadband ?? 0.2)) || 0
  // 微分滤波系数 0~1：越大越跟踪原始值，越小滤波越强（0.3 = 70% 滤波）
  const derivativeFilter = Math.max(0, Math.min(1, Number(await getPidNumber('derivativeFilter', deviceNo, fallback.derivativeFilter ?? 0.3)) || 0.3))
  // 输出斜率限制(%/周期)：duty 单次最大变化幅度，防止阶跃跳变
  const dutyRampLimit = Math.max(0, Number(await getPidNumber('dutyRampLimit', deviceNo, fallback.dutyRampLimit ?? 15)) || 0)
  // 前馈系数：进水温度变化时提前调整 duty，补偿热惯性
  const kff = Number(await getPidNumber('kff', deviceNo, fallback.kff ?? 0)) || 0

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

    // 本周期的开关计划已经确定（先开 onDurationMs、再关到周期结束），落库供历史图表复原
    // 阶梯波形；不 await，避免历史记录的数据库往返拖慢下面的加热指令下发判断。
    saveCycleRecord({
      d_no: deviceNo,
      cycleIndex: state.cycleIndex,
      windowStart: state.windowStart,
      windowMs,
      onDurationMs: state.onDurationMs,
      duty: state.lastDuty,
    })
  }

  // ============================================================
  // 确定本窗口此时此刻 heater 应该是 on 还是 off
  // ============================================================
  const elapsedInWindow = now - state.windowStart
  // 当 onDurationMs 等于窗口时长（100% 占空比）或 elapsedInWindow < onDurationMs 时开启
  const desired = (state.onDurationMs >= windowMs || elapsedInWindow < state.onDurationMs) ? 'on' : 'off'
  // 每个周期的"关"阶段清零提醒标记，保证下一次进入"开"阶段如果还是被拦截，
  // 会重新提醒一次，而不是从第一次拦截之后就再也不提醒。
  if (desired === 'off') state.pumpBlockNotified = false

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

  // 未开水泵却要打开加热：跟手动模式下"水泵未开启，不能打开加热，请先打开水泵"是
  // 同一条防线（SAFETY_INTERLOCK.requirePumpBeforeHeater，见 updateDirectConfigAndPublish.js），
  // 这里补上自动模式这一侧——PID 算出来要开，也得先看水泵是不是真的开着，不是就拦下
  // 这次下发，只在从"允许"变成"拦截"的那一刻提醒一次，避免每条消息都弹一次提示。
  const requirePumpBeforeHeater = rootConfig.SAFETY_INTERLOCK?.requirePumpBeforeHeater !== false
  const blockedByPump = shouldSend && desired === 'on' && requirePumpBeforeHeater && !(await readSwitchOn('pump', deviceNo))

  if (blockedByPump) {
    if (!state.pumpBlockNotified) {
      state.pumpBlockNotified = true
      console.warn(`[PidHeating] 拦截：水泵未开启时不打开加热，设备 ${deviceNo || '全局'}`)
      events.emit('heaterBlocked', { deviceNo, message: '水泵未开启，PID恒温控制暂不打开加热，请先打开水泵' })
    }
  } else if (shouldSend) {
    state.pumpBlockNotified = false
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

/**
 * 供实时上报使用：读取某设备当前 PID 周期内加热了多久，纯展示用途，不参与控制判断。
 * 依赖 evaluatePidHeating 已经在本轮消息里跑过一次（同一 tick 内先调它、state 才是最新的）。
 * 返回 null 表示 PID 未启用，或还没跑过第一个 PWM 周期。
 */
async function getPidHeatingStatus(info) {
  const deviceNo = String((await resolveDeviceNo(info)) || '').trim() || null
  if (!(await isPidEnabled(deviceNo))) return null
  const state = stateMap.get(deviceNo || 'global')
  if (!state || state.cycleIndex < 0) return null
  return { deviceNo, onDurationMs: Math.round(state.onDurationMs) }
}

module.exports = {
  evaluatePidHeating,
  isPidEnabled,
  readSwitchOn,
  readTempOut,
  getTargetTemp,
  setHeater,
  resolveParamConfigId,
  getPidHeatingStatus,
  onHeaterBlocked: (listener) => events.on('heaterBlocked', listener),
}