/**
 * 【文件职责】PID 自整定服务：继电反馈整定法（Relay Feedback / Åström–Hägglund），
 * 工业上给"时间比例控制"类温控回路自动整定 Kp/Ki/Kd 的标准做法。
 *
 * 原理：开启后暂时接管加热输出（不跑正常 PID 公式），让加热器在"目标温度 ± 回差"
 * 之间强制切换高/低占空比，逼出出水温度的稳定振荡；测量振荡周期 Pu 和振幅 a，
 * 按经典 Ziegler-Nichols 闭环整定公式（Ti=Pu/2、Td=Pu/8）反推：
 *   Ku = 4h / (π·a)        h = 继电测试高低占空比之差的一半
 *   Kp = 0.6·Ku,  Ki = 1.2·Ku/Pu,  Kd = 0.075·Ku·Pu
 * 只把结果写入 PID_AUTOTUNE.result 供人工核准，不会自动覆盖当前生效的 Kp/Ki/Kd，
 * 需要在"PID恒温"配置页点"应用"才会真正写入指令中心。
 *
 * 【配置中心关联】PID_AUTOTUNE 每次评估动态读取；status/progress/message/result
 * 由本文件写回配置中心，前端轮询 /api/system-config 展示进度和结果。
 */
const systemConfig = require('../../config/systemConfig')
const { resolveDeviceNo } = require('../../utils/mappedData')
const { readTempOut, getTargetTemp, setHeater } = require('./pidHeating')

/** 每个设备的自整定状态，结构说明见 getState()。 */
const stateMap = new Map()

/** 两次 setHeater 下发之间的最小时长，跟 pidHeating.js 保持一致，避免继电器抖动。 */
const MIN_COMMAND_INTERVAL_MS = 500

function getState(deviceNo) {
  const key = deviceNo || 'global'
  if (!stateMap.has(key)) {
    stateMap.set(key, {
      startedAt: 0,          // 本轮测试开始时间戳
      relayOn: false,        // 继电测试当前输出是“高”还是“低”
      lastOnSwitchAt: null,  // 上一次切到“高”的时间戳，用于量测振荡周期
      curMin: null,          // 当前测量窗口内的最低温
      curMax: null,          // 当前测量窗口内的最高温
      cycles: [],            // 已采集的完整振荡周期 [{ period, peak, trough }]
      lastEvalTs: 0,
      lastSentHeater: null,
    })
  }
  return stateMap.get(key)
}

function resetState(deviceNo) {
  stateMap.delete(deviceNo || 'global')
}

// 停止后再重新开始自整定时，必须清空上一轮遗留的振荡周期数据，否则新一轮会掺进
// 旧数据导致算出的 Ku/Pu（进而 Kp/Ki/Kd）不准。监听 enabled 从 false 变为 true 的
// 那一刻清空全部设备状态，覆盖“页面点停止再点开始”“直接调 API 重启”等所有路径。
let previousEnabled = systemConfig.getConfig().PID_AUTOTUNE?.enabled === true
systemConfig.onChange((cfg) => {
  const nowEnabled = cfg.PID_AUTOTUNE?.enabled === true
  if (nowEnabled && !previousEnabled) {
    stateMap.clear()
  }
  previousEnabled = nowEnabled
})

/** 经典 Ziegler-Nichols 闭环整定公式（Ti=Pu/2、Td=Pu/8）。 */
function zieglerNichols(ku, pu) {
  const kp = 0.6 * ku
  const ki = (1.2 * ku) / pu
  const kd = 0.075 * ku * pu
  return { kp, ki, kd }
}

/** 结束本轮测试：清空运行态，把最终结果写回配置中心。 */
function finish(status, message, result) {
  try {
    systemConfig.updateConfig({ PID_AUTOTUNE: { enabled: false, status, message, result: result || null } })
  } catch (err) {
    console.error('[PidAutoTune] 写回结果失败:', err.message)
  }
}

async function evaluateAutoTune(info) {
  const deviceNo = String((await resolveDeviceNo(info)) || '').trim() || null
  const cfg = systemConfig.getConfig()
  const at = cfg.PID_AUTOTUNE || {}

  const tempOut = await readTempOut(info)
  if (tempOut == null) return []

  const targetTemp = await getTargetTemp(deviceNo, cfg.DEFAULT_TARGET_TEMP)
  const hysteresis = Number(at.hysteresis) > 0 ? Number(at.hysteresis) : 0.3
  const highDuty = Number.isFinite(at.relayHighDuty) ? at.relayHighDuty : 100
  const lowDuty = Number.isFinite(at.relayLowDuty) ? at.relayLowDuty : 0
  const minCycles = Number.isInteger(at.minCycles) && at.minCycles >= 2 ? at.minCycles : 4
  const timeoutMs = Number(at.timeoutMs) > 0 ? Number(at.timeoutMs) : 1800000

  const state = getState(deviceNo)
  const now = Date.now()

  if (state.startedAt === 0) {
    state.startedAt = now
    // 初始输出状态跟着当前温度走：已经低于目标就先开（升温），已经高于/等于目标
    // 就先关（降温）——保证测试一开始就是"往目标温度方向调节"，不会白白等一整个
    // 无意义的反向周期才进入正常振荡。
    state.relayOn = tempOut < targetTemp
    state.curMin = tempOut
    state.curMax = tempOut
    systemConfig.updateConfig({
      PID_AUTOTUNE: { status: 'running', progress: 0, message: '自整定进行中，正在采集振荡周期', result: null },
    })
  }

  if (now - state.startedAt > timeoutMs) {
    resetState(deviceNo)
    finish('failed', `超时（${Math.round(timeoutMs / 1000)}秒）未采集到足够的振荡周期，请检查加热器是否正常响应、目标温度是否合理`, null)
    return []
  }

  state.curMin = Math.min(state.curMin, tempOut)
  state.curMax = Math.max(state.curMax, tempOut)

  // 【为什么要用滞环（hysteresis）而不是直接比较 tempOut 和 targetTemp】
  // 如果当前正开着（relayOn=true），并不是温度一超过 targetTemp 就立刻切断，而是
  // 要继续等到低于 targetTemp - hysteresis 才切断；反之亦然。这个"多等一段误差
  // 空间才切换"就是继电反馈整定法的核心：温度必须先明显冲过头再往回走，才能形成
  // 稳定、可测量的振荡，而不是在 targetTemp 这一条线上因为传感器噪声来回抖动式
  // 切换（那样测不出真实的振荡周期和振幅，算出来的 Ku/Pu 也不准）。
  const error = targetTemp - tempOut
  let switchedToOn = false
  if (state.relayOn && error <= -hysteresis) {
    state.relayOn = false
  } else if (!state.relayOn && error >= hysteresis) {
    state.relayOn = true
    switchedToOn = true
  }

  if (switchedToOn) {
    // 相邻两次“切到高”之间正好经过一次完整的高低振荡，用这段时间内的峰谷值算振幅。
    if (state.lastOnSwitchAt != null) {
      state.cycles.push({ period: now - state.lastOnSwitchAt, peak: state.curMax, trough: state.curMin })
    }
    state.lastOnSwitchAt = now
    state.curMin = tempOut
    state.curMax = tempOut

    systemConfig.updateConfig({
      PID_AUTOTUNE: { progress: state.cycles.length, message: `已采集 ${state.cycles.length}/${minCycles} 个振荡周期（不含首个丢弃周期）` },
    })

    // 丢弃第一个周期（测试刚开始，温度还没进入稳定振荡），从第二个周期起采集。
    if (state.cycles.length >= minCycles + 1) {
      const collected = state.cycles.slice(1)
      const avgPeriodMs = collected.reduce((sum, c) => sum + c.period, 0) / collected.length
      // 振幅定义为"峰谷差的一半"（波动幅度以中线为基准的偏移量），是继电反馈法
      // 公式里 a 的标准定义，不是振荡区间本身的宽度，所以要除以 2。
      const avgAmp = collected.reduce((sum, c) => sum + (c.peak - c.trough), 0) / collected.length / 2
      // h 是继电测试高低占空比之差的一半——公式 Ku = 4h/(π·a) 里的 h 对应的是
      // "继电器输出在中线两侧各摆动多少"，跟上面振幅 a 的定义方式保持一致，
      // 两者都是"半幅"，这样算出来的 Ku 才符合 Åström–Hägglund 公式的原始定义。
      const h = Math.abs(highDuty - lowDuty) / 2

      resetState(deviceNo)

      if (avgAmp <= 0.05 || h <= 0) {
        finish('failed', '振荡幅度过小，无法计算（可能是继电测试的高低占空比差太小，或传感器精度不足）', null)
        return []
      }

      const ku = (4 * h) / (Math.PI * avgAmp)
      const pu = avgPeriodMs / 1000
      const { kp, ki, kd } = zieglerNichols(ku, pu)
      finish('done', '自整定完成，建议值已生成，请核对后点击"应用"写入指令中心', {
        ku: Number(ku.toFixed(3)),
        pu: Number(pu.toFixed(2)),
        amplitude: Number(avgAmp.toFixed(3)),
        kp: Number(kp.toFixed(3)),
        ki: Number(ki.toFixed(4)),
        kd: Number(kd.toFixed(3)),
        tunedAt: new Date().toISOString(),
      })
      return []
    }
  }

  // ====== 指令下发（沿用 pidHeating.js 的防抖同步逻辑）======
  const desired = state.relayOn ? 'on' : 'off'
  const duty = state.relayOn ? highDuty : lowDuty
  const timeSinceLastCmd = now - state.lastEvalTs
  const actions = []
  if (timeSinceLastCmd >= MIN_COMMAND_INTERVAL_MS && state.lastSentHeater !== desired) {
    try {
      await setHeater(desired, deviceNo, 'pid_autotune')
      state.lastEvalTs = now
      state.lastSentHeater = desired
      actions.push({ device: 'heater', action: desired, duty, tempOut, targetTemp, reason: '自整定继电测试' })
    } catch (err) {
      console.error(`[PidAutoTune] 下发加热指令失败: ${err.message}`)
    }
  }
  return actions
}

module.exports = { evaluateAutoTune }
