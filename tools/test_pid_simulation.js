/**
 * ============================================================
 *  PID 恒温控制离线自测脚本
 * ============================================================
 * 场景：200W 固定功率加热器加热流动水
 *   - 进水温度 T_in = 18℃（固定或随环境微变）
 *   - 目标出水温度 T_out = 35℃
 *   - 水流量恒定（水箱式简化模型）
 *   - 加热器只有开/关两种状态（无调功率）
 *   - PID 通过 PWM 时间比例控制占空比，稳定出水口温度
 *
 * 热模型（一阶近似 + 时间常数）：
 *   dT_out/dt = (P_heater - P_loss) / C
 *   P_loss = K_loss * (T_out - T_in)        （散热/流动带走热量）
 *
 * 运行方法：
 *   cd backend/server
 *   node scripts/test_pid_simulation.js
 * ============================================================
 */

// ---------- 热模型参数（200W、5L 静置水箱 + 3L/min 流动散热量级）----------
// 理论校验：稳态要求 P_heater = LOSS_COEFF × (T_target - T_inlet)
// 200W 目标温差 17K → LOSS_COEFF ≈ 200 / 17 ≈ 11.8 W/K，下面设为 10（保守偏慢升温）
const HEATER_POWER_W = 200          // 加热功率 200W（用户给定的固定功率）
const T_INLET_C = 18                // 进水温度 18℃
const TARGET_C = 35                 // 目标出水温度 35℃
const WATER_MASS_KG = 5             // 加热腔有效水量 5kg
const WATER_SPECIFIC_HEAT = 4186    // 水的比热容 J/(kg·K)
const THERMAL_CAPACITY = WATER_MASS_KG * WATER_SPECIFIC_HEAT  // 热容
const LOSS_COEFF = 10               // 散热系数（W/K）；保持 17K 温差需要 LOSS_COEFF ≤ 200/17≈11.8
const SAMPLING_INTERVAL_MS = 1000   // 假设传感器 1s 上报一次

// ---------- PID 参数（200W 固定功率 / 17K 温差场景实测推荐）----------
// 稳态理论占空比 = (LOSS_COEFF * 17K / 200W) × 100% ≈ (10×17/200)×100 ≈ 85%
const PID_PARAMS = {
  Kp: 8,      // 比例适中，避免一上来就顶满导致过冲
  Ki: 0.08,   // 积分偏小，消除稳态残差但不导致积分饱和振荡
  Kd: 20,     // 微分偏大，强烈抑制上升阶段惯性超调
  windowMs: 25000,  // 25秒 PWM 周期，继电器每小时约 144 次开关（寿命友好）
  dutyMin: 0,
  dutyMax: 100,
  integral: 0,
  hasLastError: false,
  lastError: 0,
}

// ---------- 仿真状态 ----------
let simTime = 0                   // 仿真时钟（ms）
let simTOut = T_INLET_C           // 当前出水温度
let simTIn = T_INLET_C            // 当前进水温度
let simHeatOn = false             // 当前加热器开关状态
let simCmdBuffer = []             // 记录下发指令（on/off）的时间戳

// PID 状态
let windowStart = 0
let onDurationMs = 0
let lastEvalTs = 0
let lastSent = null
let cycleIdx = 0
let integral = 0
let lastError = 0
let hasLastError = false

// 统计指标
let stats = {
  commands: 0,
  onTimeMs: 0,
  offTimeMs: 0,
  maxTemp: -Infinity,
  minTemp: Infinity,
  overshoot: 0,
  settlingTimeMs: null,   // 进入目标±0.5℃ 持续稳定时间点
  withinBandMs: 0,        // 累计在±0.5℃ 带内时间
}

// ---------------------------------------------------------------
//  1. 热模型：给定当前 heater 状态 + Δt(ms)，推进 T_out
// ---------------------------------------------------------------
function stepThermal(dtMs) {
  const dtSec = dtMs / 1000
  // 加热功率（开=200W，关=0W，固定功率模型）
  const P_heat = simHeatOn ? HEATER_POWER_W : 0
  // 散热：温差越大散得越快
  const P_loss = LOSS_COEFF * (simTOut - simTIn)
  // 净功率
  const P_net = P_heat - P_loss
  // 水温变化
  const dT = (P_net * dtSec) / THERMAL_CAPACITY
  simTOut = Math.max(0, simTOut + dT)

  // 统计
  if (simTOut > stats.maxTemp) stats.maxTemp = simTOut
  if (simTOut < stats.minTemp) stats.minTemp = simTOut
  if (simHeatOn) stats.onTimeMs += dtMs; else stats.offTimeMs += dtMs

  const absErr = Math.abs(simTOut - TARGET_C)
  if (absErr <= 0.5) {
    stats.withinBandMs += dtMs
    if (stats.settlingTimeMs == null && stats.withinBandMs >= 30000) {
      // 连续 30s 稳定在 ±0.5℃ 内记为"稳定时间"
      stats.settlingTimeMs = simTime
    }
  } else {
    stats.withinBandMs = 0
  }
  if (simTOut > TARGET_C) {
    stats.overshoot = Math.max(stats.overshoot, simTOut - TARGET_C)
  }
}

// ---------------------------------------------------------------
//  2. PID 算法（与 pidHeating.js 最终版逻辑保持一致）
// ---------------------------------------------------------------
function evaluatePID() {
  const { Kp, Ki, Kd, windowMs, dutyMin, dutyMax } = PID_PARAMS

  // PWM 边界
  let needRecompute = false
  if (windowStart === 0) {
    needRecompute = true
    windowStart = simTime
  } else {
    const elapsed = simTime - windowStart
    if (elapsed >= windowMs) {
      needRecompute = true
      const crossed = Math.floor(elapsed / windowMs)
      windowStart += crossed * windowMs
      cycleIdx += crossed
    }
  }

  if (needRecompute) {
    const dtSec = windowMs / 1000
    const error = TARGET_C - simTOut
    const pTerm = Kp * error
    const derivative = hasLastError ? (error - lastError) / dtSec : 0
    const dTerm = Kd * derivative

    // 条件积分抗饱和（与 pidHeating.js 最终版保持一致）
    // 只有当占空比已经顶到边界，且继续累加积分还出不去时才暂停积分
    const rawIntegral = integral + error * dtSec
    const uBefore = pTerm + Ki * integral + dTerm
    const dutyBefore = Math.max(dutyMin, Math.min(dutyMax, uBefore))
    const uAfter  = pTerm + Ki * rawIntegral + dTerm
    const dutyAfter  = Math.max(dutyMin, Math.min(dutyMax, uAfter))
    const kiBefore = Ki * integral
    const kiAfter  = Ki * rawIntegral
    const satHi =
      dutyBefore >= dutyMax && dutyAfter >= dutyMax && error > 0 && kiAfter >= kiBefore
    const satLo =
      dutyBefore <= dutyMin && dutyAfter <= dutyMin && error < 0 && kiAfter <= kiBefore
    if (!satHi && !satLo) integral = rawIntegral
    const u = pTerm + Ki * integral + dTerm
    const duty = Math.max(dutyMin, Math.min(dutyMax, u))
    onDurationMs = Math.max(0, Math.min(windowMs, (duty / 100) * windowMs))
    lastError = error
    hasLastError = true

    // 诊断日志（每 3 个窗口打一次，避免刷屏）
    if (cycleIdx % 3 === 0) {
      const pct = Math.round((simTime / (30 * 60 * 1000)) * 100)  // 30min 进度条
      console.log(
        `[PWM#${String(cycleIdx).padStart(3)}] T_in=${simTIn.toFixed(1)}℃ ` +
        `T_out=${simTOut.toFixed(2).padStart(6)}℃ | 目标=${TARGET_C}℃ | ` +
        `误差=${error >= 0 ? '+' : ''}${error.toFixed(2)}℃ | ` +
        `P=${pTerm.toFixed(2)} I=${(Ki * integral).toFixed(2)} D=${dTerm.toFixed(2)} | ` +
        `占空比=${(duty).toFixed(1)}% (开${Math.round(onDurationMs)}ms/${windowMs}ms)` +
        (satHi || satLo ? `  [抗饱和${satHi ? '上限' : '下限'}]` : '')
      )
    }
  }

  // 本周期此刻开关动作
  const elapsedInWindow = simTime - windowStart
  const desired = (onDurationMs >= windowMs || elapsedInWindow < onDurationMs) ? 'on' : 'off'

  // 防抖 + 下发
  const timeSinceLastCmd = simTime - lastEvalTs
  if (timeSinceLastCmd >= 500) {
    const desiredBool = desired === 'on'
    if (simHeatOn !== desiredBool) {
      simHeatOn = desiredBool
      lastEvalTs = simTime
      lastSent = desired
      stats.commands++
      simCmdBuffer.push({ t: simTime, cmd: desired })
      // 详细动作日志（只在状态切换时打印一行，直观看到 on/off 切换节奏）
      const tmin = (simTime / 60000).toFixed(2)
      console.log(
        `  ↳ 指令下发: heater=${desired.toUpperCase().padEnd(3)} | ` +
        `时间=${tmin}min | 当前T_out=${simTOut.toFixed(2)}℃ | ` +
        `本窗口进度=${Math.round(elapsedInWindow / (onDurationMs >= windowMs ? windowMs : onDurationMs || 1) * 100)}%`
      )
    }
  }
}

// ---------------------------------------------------------------
//  3. 仿真主循环（最多跑 30 分钟仿真时间）
// ---------------------------------------------------------------
console.log('='.repeat(80))
console.log(' PID 恒温控制 - 离线仿真自测（固定功率 200W 加热器）')
console.log('='.repeat(80))
console.log(`  目标：T_inlet=${T_INLET_C}℃  →  T_out稳定在 ${TARGET_C}℃`)
console.log(`  热模型：水量=${WATER_MASS_KG}kg，散热系数=${LOSS_COEFF}W/K`)
console.log(`  PID 参数：Kp=${PID_PARAMS.Kp}  Ki=${PID_PARAMS.Ki}  Kd=${PID_PARAMS.Kd}`)
console.log(`           周期=${PID_PARAMS.windowMs}ms (${PID_PARAMS.windowMs/1000}s)`)
console.log(`  采样间隔=${SAMPLING_INTERVAL_MS}ms，仿真时长最多 90 分钟`)
console.log('-'.repeat(80))

const TOTAL_SIM_MS = 90 * 60 * 1000  // 90 分钟（5kg水加热到35℃物理上确实需要这个量级）
const MINUTE_STEP = 60 * 1000
let lastMinuteReport = 0

for (simTime = 0; simTime < TOTAL_SIM_MS; simTime += SAMPLING_INTERVAL_MS) {
  // 进水温度在第 15 分钟模拟一次波动（从 18℃ 降到 15℃，测试抗干扰）
  if (simTime === 15 * MINUTE_STEP) {
    simTIn = 15
    console.log(`\n>>> 扰动注入：T_inlet 18℃ → 15℃（模拟冷水汇入，测试 PID 抗干扰能力）\n`)
  }

  // 评估 PID
  evaluatePID()

  // 推进热模型 1s
  stepThermal(SAMPLING_INTERVAL_MS)

  // 每分钟汇总
  if (simTime - lastMinuteReport >= MINUTE_STEP) {
    lastMinuteReport = simTime
    const min = Math.round(simTime / MINUTE_STEP)
    const dutyAvg = stats.onTimeMs + stats.offTimeMs > 0
      ? (stats.onTimeMs / (stats.onTimeMs + stats.offTimeMs) * 100).toFixed(1)
      : 0
    console.log(
      `\n──── 第 ${String(min).padStart(2)} 分钟汇总 ────` +
      `  T_out=${simTOut.toFixed(2)}℃  误差=${(simTOut-TARGET_C >= 0 ? '+' : '')}${(simTOut-TARGET_C).toFixed(2)}℃` +
      `  平均占空比=${dutyAvg}%  指令下发次数=${stats.commands}\n`
    )
  }

  // 提前终止：稳定 2 分钟且最后 3 个窗口误差 <0.2℃
  if (
    stats.settlingTimeMs != null &&
    simTime - stats.settlingTimeMs >= 2 * MINUTE_STEP &&
    Math.abs(simTOut - TARGET_C) < 0.3
  ) {
    console.log(`\n✅  PID 判定已稳定（连续 2 分钟在 ±0.5℃ 且当前误差<0.3℃），提前结束仿真`)
    break
  }
}

// ---------------------------------------------------------------
//  4. 结果报告
// ---------------------------------------------------------------
console.log('\n' + '='.repeat(80))
console.log(' 仿真结束 · 结果报告')
console.log('='.repeat(80))

const totalHeatMs = stats.onTimeMs + stats.offTimeMs
const avgDuty = totalHeatMs > 0 ? (stats.onTimeMs / totalHeatMs * 100) : 0
const energyUsedKWh = (HEATER_POWER_W * (stats.onTimeMs / 3600000) / 1000).toFixed(3)
const theoreticalNeedW = LOSS_COEFF * (TARGET_C - T_INLET_C)  // 稳态散热 = 稳态所需加热功率
const theoreticalDuty = (theoreticalNeedW / HEATER_POWER_W * 100).toFixed(1)
const settlingMin = stats.settlingTimeMs != null
  ? (stats.settlingTimeMs / 60000).toFixed(1) + ' 分钟'
  : '❌ 30分钟内仍未稳定'

console.log(`
  目标出水温度        : ${TARGET_C}℃
  初始/最终进水温度   : ${T_INLET_C}℃  →  ${simTIn}℃
  最终出水温度        : ${simTOut.toFixed(2)}℃
  最终误差            : ${(simTOut - TARGET_C >= 0 ? '+' : '')}${(simTOut - TARGET_C).toFixed(2)}℃
  出水温度范围        : ${stats.minTemp.toFixed(1)}℃  ~  ${stats.maxTemp.toFixed(1)}℃
  最大超调量          : ${stats.overshoot.toFixed(2)}℃${stats.overshoot < 2 ? '  ✅ 优秀（<2℃）' : stats.overshoot < 4 ? '  ⚠️ 可接受' : '  ❌ 过大，建议减小Kp/Ki'}
  稳定时间（±0.5℃）   : ${settlingMin}
  30 分钟内下发指令数 : ${stats.commands} 次  ${stats.commands < 200 ? '✅ 继电器寿命友好' : '⚠️ 建议增大窗口周期'}
  平均占空比          : ${avgDuty.toFixed(1)}%  （理论稳态占空比≈${theoreticalDuty}%）
  累计加热耗能        : ${energyUsedKWh} kWh  （${(stats.onTimeMs / 1000).toFixed(0)} 秒 @ 200W）
`)

// PASS / FAIL 判定
const failReasons = []
if (stats.overshoot > 3) failReasons.push(`超调过大 (${stats.overshoot.toFixed(1)}℃ > 3℃)`)
if (Math.abs(simTOut - TARGET_C) > 1) failReasons.push(`最终稳态偏差过大 (${(simTOut-TARGET_C).toFixed(1)}℃ > ±1℃)`)
if (stats.settlingTimeMs == null) failReasons.push('30 分钟内未达到稳定带')
if (stats.commands > 500) failReasons.push(`指令下发过于频繁 (${stats.commands} 次)`)

if (failReasons.length === 0) {
  console.log('\n✅  自测结果：PASS —— PID 在 200W 固定功率场景可以稳定控制出水温度。')
  console.log('   建议：实际设备上先用当前参数试运行，根据真实 T_out 曲线微调 Kp/Ki。')
} else {
  console.log('\n⚠️  自测结果：需要进一步调参。问题：')
  failReasons.forEach(r => console.log('   - ' + r))
  console.log(`
   调参建议：
   · 超调过大  → 减小 Kp，增大 Kd，或减小 Ki
   · 响应过慢  → 增大 Kp，或增大 windowMs 给加热器更多连续工作时间
   · 稳态偏差  → 增大 Ki（积分项消除稳态残差）
   · 指令频繁  → 增大 windowMs（当前 ${PID_PARAMS.windowMs/1000}s → 建议 20~30s）
`)
}
console.log('='.repeat(80) + '\n')
