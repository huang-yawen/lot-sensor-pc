/**
 * 【文件职责】正常状况联动统一规则引擎——取代原来互斥的"自动控制（简化版）"和
 * "分层联动"两套独立逻辑。除加热控制算法外，其余规则各自独立开关，可以任意勾选组合，
 * 不再被迫二选一：赛场上评委要什么组合，直接在配置中心逐条勾选，不用改代码、
 * 不用重启。
 *
 * 加热是个例外：滞回带通断（heaterHysteresis）和 PID 恒温是互斥的两套温控算法，
 * 不能同时生效，所以不放进"自由勾选"的规则清单，各自是指令中心里独立的开关
 * （preffix=heater_hysteresis_enabled / pid_enabled，谁也不依赖谁），两个都开时
 * PID 优先（见下方 evaluateLinkageRules 里 !pidEnabled 的判断）。两个开关互相
 * 独立：赛场上确定只用某一种策略，直接从 t_direct_config 删掉另一个的指令项，
 * 查不到就当作未启用，程序不会报错。
 *
 * ★★ 赛场上要改联动规则，改下面 evaluateLinkageRules 函数里对应的 if 块就够了 ★★
 *   9 条规则从上到下顺序排列，每条一个独立的 if 块，直接改 if 里的判断条件，
 *   不用跳到别的函数——跟安全联锁 checkRules、故障状态机 detectFault 是同一个风格。
 *
 * 规则清单（除 heaterHysteresis 外均可通过 LINKAGE_RULES 独立开关；判定逻辑都在
 * evaluateLinkageRules 函数里，按下面这个顺序排列）：
 *   pumpAlwaysOn   水泵常开：无故障、其他传感器读数正常就保持运行，不跟温度挂钩。
 *   heaterHysteresis 加热滞回带通断：出水温度低于"目标-回差"才开，达到目标就关（是否生效由指令中心 heater_hysteresis_enabled 决定，不是这里的独立开关；回差值优先取指令中心 heater_hysteresis，没有才用配置中心的兜底值）。反向翻转还受最小开/关驻留时间保护（heater_hysteresis_min_on_ms / heater_hysteresis_min_off_ms），防止在目标温度附近被高频通断，见 getHeaterHysteresisState。
 *   flowSingle     水泵-流量单层：流量在区间内/低于下限->开；高于上限->关（保护）。
 *   pressureSingle 水泵/加热-压力单层：压力低于下限->开泵；高于上限->关泵关热。
 *   tempSingle     加热-温度单层（带滞回）：温度低于下限->开；高于上限->关（不再参考目标温度）。
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
 * 跟安全联锁/故障状态机不同的一点：那两个是每条规则各自独立触发动作（命中就直接
 * 下发），这里 9 条规则是"投票"——每条规则给水泵、加热各投一票（'on'/'off'/不表态），
 * 全部投完才用 mergeDecision 合并成最终结论，因为同一个执行器（比如水泵）可能被
 * 好几条规则同时管，必须先收集所有意见才能定下最终该怎么做。
 *
 * 阈值、目标温度实时读取指令中心 t_direct，页面修改即时生效。
 * 【配置】LINKAGE_RULES 见对应 config.js。
 */

// ========== 赛场速改索引（要改什么 → 去哪） ==========
//  关掉全部联动         config.js enabled=false（或把 9 条规则布尔逐条关）
//  开/关某一条规则      config.js 对应布尔（pumpAlwaysOn/flowSingle/tempSingle/dualTemp/...）
//  改滞回/温差等参数    config.js（heaterHysteresisValue/tempDiffOpenThreshold/dualTempDiffThreshold/...）
//  改温度/流量/压力阈值  指令中心 t_direct（页面即时生效），不在本文件
//  某条规则的判定逻辑    evaluateLinkageRules() 里对应的 if 块，从上到下按规则1~9排列，
//                        每条一段"── 规则N：xxx ──"注释开头，直接改 if 条件就行
//  多规则冲突怎么合并    mergeDecision()（约 L170）+ evaluateLinkageRules() 末尾；"关"优先于"开"
//  每条消息的入口        evaluateLinkageRules() 约 L340
// ===================================================
// 联动规则自己的开关和参数（总开关 + 9 条规则逐条开关 + 各滞回/温差阈值）在这里。
const CONFIG = require('./config')
const EventEmitter = require('events')
const { SINGLE_DEVICE_MODE, DEFAULT_TARGET_TEMP } = require('../../config/appSettings')
const { getCurrentMode } = require('../directData/getControlMode')
const { recordEvent } = require('../controlShared/recordEvent')
const { isPidEnabled, readSwitchOn } = require('../pidHeating/pidHeating')
const { isPumpVelocityControlEnabled } = require('../pumpVelocityControl/pumpVelocityControl')
const { isLockedByFault, isAnyLocked } = require('../faultStatus/faultStatus')
const {
  getAbnormalMax,
  getThresholdValue,
  getNumberValue,
  readSensors,
  readSwitchStates,
  getTargetTemp,
  setSwitch,
  canAct,
  isFlowNormal,
  getTempDiff,
  resolveDeviceNoStr,
  TEMP_SOURCES,
} = require('../controlShared/controlHelpers')

/** 联动真正下发一次开关后 emit 'linkage'，app.js 转成 WebSocket 推给前端弹提示。
 * 跟 safetyInterlock.js 的 'safety'、faultStatus.js 的 'fault' 是同一套"内部 emit +
 * 对外订阅函数"模式，见文件底部 onLinkage。
 * 只在**真的下发了指令**时 emit，不是每条规则命中就 emit：一次动作可能由好几条规则
 * 共同判定出来（写记录时每条规则各写一行，那是给饼图统计用的），但对用户来说
 * "水泵被打开了"只是一件事，弹三条一模一样的提示只会刷屏。 */
const events = new EventEmitter()

/** 上次该条件动作，用于日志与最小化重复下发。 */
const lastActions = new Map()
/** 记录每个设备上一次的观测温度读数（观测点见 TEMP_SOURCES.tempPressureTrend），
 * 供"加热温度持续上升"判断趋势（规则9 温度+压力融合第一段用）。 */
const lastTemp = new Map()

/**
 * 加热滞回带通断专属的"上次翻转方向和时间"状态，供最小开/关驻留时间判断用。
 * 思路跟恒流速滞环通断（pumpVelocityControl.js 的 minOnMs/minOffMs）完全一致：
 * 判定要反向翻转时，必须先确认距离上次翻转已经过了这么久，否则本轮这条规则不
 * 表态（候选置为 null），防止加热继电器在目标温度附近被高频通断（短循环）。
 * 这份状态只属于"滞回带通断"这一条规则自己，不影响其它 8 条规则各自的候选。
 */
const heaterHysteresisState = new Map()
function getHeaterHysteresisState(deviceNo) {
  const key = deviceNo || 'global'
  if (!heaterHysteresisState.has(key)) {
    heaterHysteresisState.set(key, { lastSwitchTs: 0, lastSwitchTo: null })
  }
  return heaterHysteresisState.get(key)
}

/**
 * 规则 key -> 中文名，key 跟 LINKAGE_RULES 配置项、evaluateLinkageRules 里的 if 块
 * 一一对应。供"告警记录"页面的"联动控制记录"展示用（errorTypeNames.js 引用这份表），
 * 以及写 t_error_msg 时标注"这次动作是哪条规则决定的"。改规则名字只用改这一处。
 */
const LINKAGE_RULE_NAMES = {
  pumpAlwaysOn: '水泵常开',
  heaterHysteresis: '加热滞回带通断',
  flowSingle: '水泵-流量单层',
  pressureSingle: '水泵/加热-压力单层',
  tempSingle: '加热-温度单层',
  dualTemp: '水泵-双温度融合',
  tempFlow: '水泵/加热-温度+流量融合',
  pressureFlow: '水泵-压力+流量融合',
  tempPressure: '水泵/加热-温度+压力融合',
}

/**
 * 把一次联动动作写进 t_error_msg，供"告警记录"页面的"联动控制记录"板块查看
 * （表格 + 按规则统计的饼图），跟安全联锁的 recordAlarm 是同一个思路。
 * 一次动作如果是被多条规则共同判定出来的（比如泵从关变开，"水泵常开"和
 * "流量单层"都判定该开），贡献规则各自写一条——饼图才能精确统计到每条规则
 * 各命中了多少次，而不是笼统一条"联动触发了一次"。
 * @param {string|null} deviceNo - 设备号
 * @param {string} ruleKey - 贡献这次结论的规则 key（LINKAGE_RULE_NAMES 的键）
 * @param {string} deviceLabel - 执行器中文名（'水泵'/'加热'）
 * @param {'on'|'off'} action - 这次下发的动作
 * @param {Object} sensors - 当前传感器读数，写进 detail 方便排查
 */
async function recordLinkageAlarm(deviceNo, ruleKey, deviceLabel, action, sensors) {
  const actionLabel = action === 'on' ? '开' : '关'
  const ruleLabel = LINKAGE_RULE_NAMES[ruleKey] || ruleKey
  // 文案统一成"原因｜处置｜数据"三段。规则名本身就说明了命中的是什么，"命中规则"
  // 四个字是废话；四项读数用 T1/T2 简写，一行表格里才放得下。
  const detail = `T1=${sensors.temp1 ?? '-'} T2=${sensors.temp2 ?? '-'} 流量=${sensors.flow ?? '-'} 压力=${sensors.pressure ?? '-'}`
  await recordEvent({
    deviceNo,
    message: `${ruleLabel}｜${deviceLabel}→${actionLabel}｜${detail}`,
    code: ruleKey,
    type: '联动控制',
  })
}

/**
 * 广播一次联动动作，供前端右上角弹提示（LinkageNotifier.vue）。
 * @param {string|null} deviceNo    - 设备号
 * @param {string} deviceLabel      - 执行器中文名（'水泵' / '加热'）
 * @param {'on'|'off'} action       - 这次下发的动作
 * @param {Array} contributingRules - 贡献了这个结论的规则（ruleResults 里筛出来的）
 * @param {Object} sensors          - 当前读数，给提示正文带上现场数据
 */
function emitLinkage(deviceNo, deviceLabel, action, contributingRules, sensors) {
  events.emit('linkage', {
    deviceLabel,
    action,
    actionLabel: action === 'on' ? '开' : '关',
    // 可能不止一条规则同时判出这个结论，前端把它们列出来，用户才知道是被什么触发的
    rules: contributingRules.map(r => LINKAGE_RULE_NAMES[r.key] || r.key),
    sensors: {
      temp1: sensors.temp1 ?? null,
      temp2: sensors.temp2 ?? null,
      flow: sensors.flow ?? null,
      pressure: sensors.pressure ?? null,
    },
    deviceNo: deviceNo || null,
  })
}

/* ============================ 故障检测（所有规则共用的前置条件） ============================ */

/**
 * 故障检测：堵管 / 漏水 / 干烧，三种硬件级异常。这是所有规则运行前都要先看一眼
 * 的"前提检查"，不算一条独立规则（不受 LINKAGE_RULES 里任何开关控制），联动
 * 总开关一打开就一直生效，不需要单独勾选。检测到任何一种，后面各条规则都会
 * 因为 faults 数组不为空而强制把加热关掉。
 *
 * 三种故障各自在检测什么、对应什么现实情况：
 *   干烧：水泵和加热都开着，流量却低于下限——水几乎没流动，加热器在"空烧"，
 *         是最危险的一种，加热管可能因此烧坏甚至起火。
 *   堵管：压力冲到上限，流量却低于下限——水泵在使劲推水，但水推不出去，
 *         说明管路某处堵住了。
 *   漏水：压力直接掉到 0，流量也是 0 或很低——水泵在转但系统里几乎没有压力，
 *         说明管路破了、接头松了，水都漏光了压不起来。
 *
 * @param {Object} sensors - 当前传感器读数（用到 flow 流量、pressure 压力）
 * @param {string|null} deviceNo - 设备号，查阈值时用（阈值支持按设备单独配置）
 * @param {Object} states - 当前开关上报状态（用到 pumpOn 水泵、heatOn 加热）
 * @returns {Array<string>} 命中的故障名称列表，可能同时命中好几个；空数组=正常
 */
async function detectFaults(sensors, deviceNo, states) {
  const faults = []
  const flowLow = await getThresholdValue('flowLow', deviceNo)
  const pressureHigh = await getThresholdValue('pressureHigh', deviceNo)

  // 干烧：水泵和加热都开着，但流量却低于下限——水几乎不流动，加热器在空烧。
  if (states.pumpOn && states.heatOn && flowLow != null && sensors.flow != null && sensors.flow < flowLow) {
    faults.push('干烧')
  }
  // 堵管：压力高于上限、流量又低于下限——水泵使劲推却推不出去，管路被堵住了。
  if (pressureHigh != null && sensors.pressure != null && sensors.pressure > pressureHigh
    && flowLow != null && sensors.flow != null && sensors.flow < flowLow) {
    faults.push('堵管')
  }
  // 漏水：压力直接是 0，流量也是 0 或低于下限——系统里压力根本起不来，多半是漏了。
  if (sensors.pressure === 0 && (sensors.flow === 0 || (flowLow != null && sensors.flow != null && sensors.flow < flowLow))) {
    faults.push('漏水')
  }
  return faults
}

// isFlowNormal（流量读数是否正常：非 null、非 0、没顶到异常哨兵、落在上下限之间）
// 原本定义在本文件，现已上移到 service/controlShared/controlHelpers.js，
// safetyInterlock.js 也用同一份，见文件顶部 require。实现和判定完全没变，只是挪了位置。

/**
 * 把好几条规则各自给出的候选结论（比如"泵到底该开还是该关"）合并成最终一个
 * 结论。合并原则很简单，也是这套系统安全设计的底线："关闭"永远优先于
 * "打开"——只要有任意一条规则说该关，最终结果就是关，哪怕其它规则都说该开
 * 也不行；只有全部候选都说开、且没有一条说关，最终才是开；如果所有规则都
 * 没表态（都是 null），最终结果也是 null（不动作，维持现状）。
 * 这跟"规则可以自由勾选、任意组合"是配套的：规则越叠越多，宁可保守——多关
 * 一次没什么坏处，也不能因为某条规则漏判而"放行"了一个不该有的开启动作。
 * @param {...('on'|'off'|null)} values - 各条规则给出的候选结论
 * @returns {'on'|'off'|null}
 */
function mergeDecision(...values) {
  const list = values.filter(v => v === 'on' || v === 'off')
  if (list.includes('off')) return 'off'
  if (list.includes('on')) return 'on'
  return null
}

/* ============================ 主评估 ============================ */

/**
 * 每条传感器/合并实时消息都会走一次，整体执行顺序是：
 *   1. 联动总开关、故障锁、手动模式——任意一个短路条件命中就直接返回空数组，
 *      不往下算。
 *   2. 读一遍当前传感器读数、开关状态、目标温度、各类阈值（一次性用
 *      Promise.all 并发查完，避免一个一个串行查拖慢整条消息的处理）。
 *   3. ★ 按 LINKAGE_RULES 里的开关，把勾选了的规则从上到下逐条判断——9 条规则
 *      各是一个独立的 if 块，直接写在这个函数里（不用跳到别的函数），每条给出
 *      的 pump/heater 候选结论都用 collect() 塞进 pumpCandidates/heaterCandidates
 *      这两个数组。加热滞回带通断因为跟 PID 互斥，不在这份"自由勾选"的清单里，
 *      是单独判断要不要跑。
 *   4. 用 mergeDecision 把每个执行器收集到的所有候选结论合并成一个最终结论
 *      （关优先）。
 *   5. 拿最终结论跟设备当前实际开关状态比，不一样就真的下发一次指令；水泵
 *      如果被恒流速控制接管了、加热如果被 PID 接管了，这里就不再插手，
 *      避免两个控制器抢同一个执行器。真下发时，回头从 ruleResults 里找出
 *      "候选结论跟最终结论一致"的那些规则（贡献规则可能不止一条），各自
 *      写一条联动控制记录到 t_error_msg（recordLinkageAlarm），供"告警记录"
 *      页面精确统计到具体是哪条规则触发的。
 * @param {Object} info - 已解析的设备上报数据
 * @returns {Promise<Array>} 本次实际下发的动作（没有任何变化就是空数组）
 */
async function evaluateLinkageRules(info) {
  const config = CONFIG
  if (config.enabled !== true) return []

  const deviceNo = await resolveDeviceNoStr(info)

  // ====== 故障锁短路 ======
  if (SINGLE_DEVICE_MODE === true) {
    if (isAnyLocked()) return []
  } else if (isLockedByFault(deviceNo)) {
    return []
  }

  // ====== 手动模式短路 ======
  if ((await getCurrentMode(deviceNo)) === 'manual') return []

  const sensors = await readSensors(info)
  const states = await readSwitchStates(info)
  const targetTemp = await getTargetTemp(deviceNo, DEFAULT_TARGET_TEMP)
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
  // 加热滞回带通断 / PID 恒温是指令中心两个独立开关（heater_hysteresis_enabled /
  // pid_enabled），不是 LINKAGE_RULES 里能跟其他规则一起自由勾选的一项。两个都
  // 没配置/被删除时 readSwitchOn 返回 null，=== true 判断为 false，等同未启用，
  // 不会报错。两个都开时 PID 优先，滞回带规则整条不计算，加热完全交给 pidHeating.js。
  const pidEnabled = await isPidEnabled(deviceNo)
  const hysteresisEnabled = !pidEnabled && (await readSwitchOn('heater_hysteresis_enabled', deviceNo)) === true
  // 水泵恒流速控制（滞环通断/占空比）启用后由 pumpVelocityControl.js 独占水泵，这里
  // 涉及水泵的规则照常参与计算（合并结论和日志还要用），只是最后不下发水泵指令，
  // 避免两个控制器抢同一个执行器。跟上面加热让位给 PID 是完全对称的处理。
  // 两个恒流速开关都被删除时 isPumpVelocityControlEnabled 返回 false，水泵回到联动规则控制。
  const pumpVelocityEnabled = await isPumpVelocityControlEnabled(deviceNo)

  // 每条规则给出的都是 { pump, heater } 这样的候选结论，collect 负责把它们分别
  // 塞进两个数组，等所有勾选的规则都跑完了，再用 mergeDecision 合并成最终结论。
  // 同时把规则 key 和候选结论一起存进 ruleResults，供合并出最终结论后回溯
  // "这次结论具体是被哪条/哪些规则决定的"（写联动控制记录时要精确到规则名）。
  const pumpCandidates = []
  const heaterCandidates = []
  const ruleResults = []
  const collect = (key, r) => {
    pumpCandidates.push(r.pump)
    heaterCandidates.push(r.heater)
    ruleResults.push({ key, ...r })
  }

  /* ────────────────────────────────────────────────────────────────
   * ★★★ 赛场改这里：9 条规则从上到下顺序判断 ★★★
   * 每条规则算出 { pump, heater } 候选结论后调 collect() 记下来，互不干扰；
   * 全部跑完才在下面用 mergeDecision 合并成最终结论（"关"优先于"开"）。
   * ──────────────────────────────────────────────────────────────── */

  // ── 规则1：水泵常开 ──
  // 完全不跟温度挂钩：没有故障、且流量压力读数没有顶到异常哨兵（代表传感器读数
  // 异常/掉线）就让水泵保持开着；命中任意故障直接关泵；读数不完整时不表态（null），
  // 留给其它规则或维持现状。
  // 注意：不要求流量/压力"不为 0"——水泵还没开时流量压力本来就是 0，是正常的
  // 初始状态，不是异常；水泵冷启动时也要能被这条规则判定"该开"。"真的开着但
  // 流量长期为0"这种情况由故障状态机的④水泵空转/②出水口堵塞专门检测，检测到
  // 会计入 faults 让这条规则照样判"关"，不会因为不要求"不为0"就少一层保护。
  if (config.pumpAlwaysOn !== false) {
    const allNormal = faults.length === 0
      && sensors.flow != null && sensors.flow < getAbnormalMax()
      && sensors.pressure != null && sensors.pressure < getAbnormalMax()
    const pump = faults.length > 0 ? 'off' : (allNormal ? 'on' : null)
    collect('pumpAlwaysOn', { pump, heater: null })
  }

  // ── 规则2：加热滞回带通断 ──
  // 是否生效由指令中心 heater_hysteresis_enabled 决定，不是 config.js 里能跟其它
  // 规则一起勾选的一项（跟 PID 恒温互斥，见文件头说明），所以外层判断的是
  // hysteresisEnabled 而不是 config.heaterHysteresis。
  // 出水温度 >= 目标温度：够热了，关；< 目标-回差：明显不够热，开；中间这段
  // 维持现状不动作，这正是"回差"的意义——避免温度在目标值附近来回跨越同一
  // 条线，导致加热器像继电器一样高频通断。
  // 三层保护性短路，命中任意一层都直接强制关闭加热，不管温度算出来该开该关：
  //   ① 故障态：干烧/堵管等异常已经命中，这里不再画蛇添足判断温度。
  //   ② 水泵没开/没有流量：加热器只能加热"流经它的水"，这时候开加热就是干烧。
  //   ③ 进出水温差过大：读数不可信或管路可能有问题，保守起见先关。
  if (hysteresisEnabled) {
    // 回差、温差过大阈值、最小开/关驻留时间都跟目标温度一样，现场可以在指令中心
    // 实时调（preffix=heater_hysteresis / temp_diff_open / heater_hysteresis_min_on_ms
    // / heater_hysteresis_min_off_ms）；指令项被删掉时自动退回配置中心对应值，
    // 两个都没有才用常量兜住，不会把 NaN 带进温度比较/时长比较里。
    const [hysteresis, diffOpenThreshold, hystMinOnMs, hystMinOffMs] = await Promise.all([
      getNumberValue('heater_hysteresis', deviceNo, config.heaterHysteresisValue, 1),
      getNumberValue('temp_diff_open', deviceNo, config.tempDiffOpenThreshold, 3),
      getNumberValue('heater_hysteresis_min_on_ms', deviceNo, config.heaterHysteresisMinOnMs, 5000),
      getNumberValue('heater_hysteresis_min_off_ms', deviceNo, config.heaterHysteresisMinOffMs, 5000),
    ])
    // 盯进水还是出水由 TEMP_SOURCES.heaterHysteresis 决定，默认出水温度。
    const temp = sensors[TEMP_SOURCES.heaterHysteresis]
    // 进出水温差：两个读数只要有一个缺失就算不出来（getTempDiff 返回 null）。diff 为
    // null 时③不触发——宁可不触发这层保护，也不能拿 NaN 去跟阈值比较（那样的比较
    // 结果永远是 false，会悄悄绕过保护，看起来规则在生效实际上完全没生效）。
    const diff = getTempDiff(sensors)
    let heater
    if (faults.length > 0) heater = 'off'
    else if (states.pumpOn === false || (sensors.flow != null && sensors.flow === 0)) heater = 'off'
    else if (diff != null && diff > diffOpenThreshold) heater = 'off'
    // 观测温度暂时读不到（传感器掉线/还没上报）：不知道该开该关，索性不表态，
    // 不能瞎猜，交给其它规则或者维持上一轮状态。
    else if (temp == null) heater = null
    else if (temp >= targetTemp) heater = 'off'
    else if (temp < targetTemp - hysteresis) heater = 'on'
    // 温度落在 [目标-回差, 目标) 这个滞回带区间内：维持现状不动作，避免温度在
    // 目标值附近反复横跳、加热器高频通断。
    else heater = null

    // 最小开/关驻留时间保护（防短循环）：这条规则判定要反向翻转时，先看距离上次
    // 翻转是否已经过了 required 这么久，不够就把这轮候选压成 null（不表态，交给
    // 其它规则或维持现状）；够了才放行并记下这次翻转的时间和方向，作为下一次
    // 判断的基准。第一次表态（lastSwitchTo 还是 null）直接记录，不做等待。
    const hystState = getHeaterHysteresisState(deviceNo)
    if (heater != null) {
      if (hystState.lastSwitchTo != null && heater !== hystState.lastSwitchTo) {
        const required = hystState.lastSwitchTo === 'on' ? hystMinOnMs : hystMinOffMs
        if (Date.now() - hystState.lastSwitchTs < required) {
          heater = null
        } else {
          hystState.lastSwitchTs = Date.now()
          hystState.lastSwitchTo = heater
        }
      } else if (hystState.lastSwitchTo == null) {
        hystState.lastSwitchTs = Date.now()
        hystState.lastSwitchTo = heater
      }
    }
    collect('heaterHysteresis', { pump: null, heater })
  }

  // ── 规则3：水泵-流量单层 ──
  // 只看流量这一个指标：读不到不表态；超过上限可能水泵转太快/管路异常，关泵
  // 保护；其余情况（含流量低于下限）开泵——注意流量低于下限时这条给的是
  // "开泵"，是想让泵多出力把流量顶上去，跟安全联锁"流量太低说明堵管/漏水该
  // 关"的方向刚好相反，因为这条规则不是在做故障保护（故障保护由 detectFaults 管）。
  if (config.flowSingle === true) {
    const flow = sensors.flow
    const pump = flow == null ? null : (flowHigh != null && flow > flowHigh ? 'off' : 'on')
    collect('flowSingle', { pump, heater: null })
  }

  // ── 规则4：水泵/加热-压力单层 ──
  // 只看压力这一个指标：压力低于下限，系统压力不够，开泵把压力顶上去；压力
  // 高于上限，压力太高有风险（可能顶坏管路/接头），关泵同时把加热也一起关
  // 掉——反正泵都要关了，继续加热已经没意义，还会让风险叠加；两个阈值都没
  // 触发、或者压力读不到就不表态。
  if (config.pressureSingle === true) {
    const pressure = sensors.pressure
    const result = { pump: null, heater: null }
    if (pressure != null) {
      if (pressureLow != null && pressure < pressureLow) result.pump = 'on'
      if (pressureHigh != null && pressure > pressureHigh) {
        result.pump = 'off'
        result.heater = 'off'
      }
    }
    collect('pressureSingle', result)
  }

  // ── 规则5：加热-温度单层（带滞回） ──
  // 跟规则2 加热滞回带通断思路相似，但这条同时看进水、出水两个温度，开/关的
  // 临界点只看"温度上下限阈值"（指令中心 temp_low / temp_high），不再参考目标
  // 温度：开的临界点=温度下限-回差，关的临界点=温度上限+回差；温度下限/上限
  // 没配置（读到 null）时，对应方向不表态。判断时进水、出水两个温度只要有
  // 一个超过关闭线就关（宁可错关，优先安全），只要有一个低于开启线就开（宁可
  // 错开，优先把温度追上去）；两条都没触发就不表态，维持现状。
  if (config.tempSingle === true) {
    const tempSingleHysteresis = await getNumberValue('temp_single_hysteresis', deviceNo, config.tempSingleHysteresis, 1)
    const openThreshold = tempLow != null ? tempLow - tempSingleHysteresis : null
    const closeThreshold = tempHigh != null ? tempHigh + tempSingleHysteresis : null
    const temps = [sensors.temp1, sensors.temp2].filter(v => v != null)
    let heater = null
    if (closeThreshold != null && temps.some(t => t > closeThreshold)) heater = 'off'
    else if (openThreshold != null && temps.some(t => t < openThreshold)) heater = 'on'
    collect('tempSingle', { pump: null, heater })
  }

  // ── 规则6：水泵-双温度融合 ──
  // 进出水温差过大时开泵：温差变大通常说明水流动得不够快——加热器一直在加热，
  // 但水流速慢，还没被充分带走热量的那部分水温度就已经升得比较高，进出口
  // 温差就会被拉大；这时候开泵、加快水流，能更快把热量带走，帮温差缩小回
  // 正常范围。这条规则只在乎"温差是不是太大"，不关心到底是进水更高还是出水
  // 更高，所以用绝对值（getTempDiff）比较；进水或出水读数缺一个就不表态。
  // threshold（dual_temp_diff）建议设得比安全联锁"温差过大"的阈值小，否则温差
  // 一大是安全联锁先触发（整套强制关闭），轮不到这条开泵。
  if (config.dualTemp === true) {
    const dualTempDiff = await getNumberValue('dual_temp_diff', deviceNo, config.dualTempDiffThreshold, 2)
    const diff = getTempDiff(sensors)
    const pump = diff == null ? null : (diff > dualTempDiff ? 'on' : null)
    collect('dualTemp', { pump, heater: null })
  }

  // ── 规则7：水泵/加热-温度+流量融合 ──
  // 把温度和流量两个指标放一起看，而不是各自独立判断。
  //   条件一：有任一温度超过上限、且流量本身正常 -> 关加热。流量正常说明
  //     读数可信、不是因为流量异常才显得"温度虚高"，可以放心认为真的够热了。
  //   条件二：有任一温度未超上限、且流量又低于下限 -> 同时开加热、开泵。
  //     流量太低时先把泵开起来保证水在流动，同时因为温度还没到上限，加热
  //     可以继续开着。
  // 这两个条件不互斥，如果两个温度读数一个超上限一个没超，两个条件可能同时
  // 命中——此时以条件二（顺序在后）覆盖条件一的结果，因为代码顺序执行、
  // 后面的赋值会覆盖前面的。
  if (config.tempFlow === true) {
    const result = { pump: null, heater: null }
    const temps = [sensors.temp1, sensors.temp2].filter(v => v != null)
    if (temps.length > 0 && tempHigh != null) {
      if (temps.some(t => t > tempHigh) && flowNormal) result.heater = 'off'
      if (temps.some(t => t < tempHigh) && flowLow != null && sensors.flow != null && sensors.flow < flowLow) {
        result.heater = 'on'
        result.pump = 'on'
      }
    }
    collect('tempFlow', result)
  }

  // ── 规则8：水泵-压力+流量融合 ──
  // 把压力和流量两个指标放一起看，判断水泵开关。三种情况按顺序判断，命中
  // 第一个就不再看后面（跟 if/else if 一样是互斥的）：
  //   1. 压力超过上限、且流量低于下限 -> 关泵。压力冲高但流量却出不去，
  //      有点像堵管的前兆，先关泵保护。
  //   2. 压力低于下限、且流量本身正常 -> 开泵。流量没问题说明不是堵了，
  //      纯粹是泵没使劲，加把劲把压力顶上去。
  //   3. 压力超过上限、且流量也超过上限 -> 关泵。压力流量都超标，说明泵
  //      开得太猛了，关泵把两者都降下来。
  // 第 1 条和第 3 条都是"压力超上限"，区别只在流量是偏低还是偏高——不管流量
  // 往哪个方向异常，压力超标时都是关泵；只有流量恰好落在正常区间、压力又
  // 偏低时（第 2 条），才会开泵。
  if (config.pressureFlow === true) {
    const { pressure, flow } = sensors
    let pump = null
    if (pressure != null) {
      if (pressureHigh != null && pressure > pressureHigh && flowLow != null && flow != null && flow < flowLow) pump = 'off'
      else if (pressureLow != null && pressure < pressureLow && flowNormal) pump = 'on'
      else if (pressureHigh != null && pressure > pressureHigh && flowHigh != null && flow != null && flow > flowHigh) pump = 'off'
    }
    collect('pressureFlow', { pump, heater: null })
  }

  // ── 规则9：水泵/加热-温度+压力融合（这条是所有规则里逻辑最绕的一条，分两段看） ──
  //
  // 第一段——压力高、且加热还在让温度往上冲，就关加热：
  //   压力超过上限、且能读到观测温度时，跟上一次（上一条消息）记录的同一个
  //   观测温度比一比：如果这次比上次还高，说明温度是"正在持续上升"，而不是
  //   已经趋于稳定或者在下降。这时候才关加热——只看"这一刻温度多高"是不够
  //   的，因为压力高不一定是加热造成的（也可能是别的原因），只有确认温度确实
  //   在因为持续加热而往上涨，才有必要为了给压力"降降火"而把加热关掉；如果
  //   温度已经不涨了甚至在降，加热对当前的压力风险没有火上浇油，就不用管它。
  //   默认看出水温度而不是进水温度，是因为加热器加热的是流经的水，升温效果
  //   直接反映在出水温度上，进水温度基本不受本机加热影响；要换观测点改
  //   controlHelpers.js 的 TEMP_SOURCES.tempPressureTrend 一处即可。"上一次的
  //   观测温度"存在模块顶部的 lastTemp 这个 Map 里，每次 evaluateLinkageRules
  //   跑完都会更新（见本函数末尾），这里只负责读，不负责写。
  //
  // 第二段——压力低、温度也低，先开泵再开热：
  //   压力低于下限、且配了温度下限阈值时，只要进水或出水任一个温度低于这个
  //   下限，就要采取行动：如果水泵还没开，先开泵——水都没在流动，光加热没
  //   意义；如果水泵已经开着了（说明"没流动"不是原因），那就转而开加热，
  //   靠加热去改善偏低的温度和压力状况。这里是"二选一"（if/else），同一轮
  //   不会又开泵又开热，是循序渐进的：先保证水流动起来，流动起来了还不够，
  //   才轮到加热出手。
  if (config.tempPressure === true) {
    const result = { pump: null, heater: null }
    const pressure = sensors.pressure
    if (pressure != null) {
      // 盯进水还是出水由 TEMP_SOURCES.tempPressureTrend 决定，默认出水温度；
      // 跟本函数末尾写 lastTemp 时用的是同一个观测点，两边必须一致，否则就
      // 成了"拿这次的出水跟上次的进水比"，趋势判断完全失真。
      const trendTemp = sensors[TEMP_SOURCES.tempPressureTrend]
      if (pressureHigh != null && pressure > pressureHigh && trendTemp != null) {
        const prev = lastTemp.get(deviceNo)
        if (prev != null && trendTemp > prev) result.heater = 'off'
      }
      if (pressureLow != null && pressure < pressureLow && tempLow != null) {
        const temps = [sensors.temp1, sensors.temp2].filter(v => v != null)
        if (temps.some(t => t < tempLow)) {
          if (!states.pumpOn) result.pump = 'on'
          else result.heater = 'on'
        }
      }
    }
    collect('tempPressure', result)
  }

  /* ─────────────────────────── 9 条规则判断完毕，下面合并结论并下发 ─────────────────────────── */

  const pumpDesired = mergeDecision(...pumpCandidates)
  const heaterDesired = mergeDecision(...heaterCandidates)

  const actions = []
  const result = { targetTemp, faults, sensors }

  // 真正下发水泵指令要同时满足：①有明确结论（不是 null）；②没有被恒流速
  // 控制接管；③设备当前开关状态是已知的（不是 undefined，即读到过行为上报）；
  // ④结论跟当前实际状态不一样（已经是这个状态就不用重复下发）；⑤没有被防抖
  // 拦住（canAct 保证同一个开关短时间内不会被反复切换）。五个条件缺一不可。
  if (pumpDesired && !pumpVelocityEnabled
    && states.pumpOn !== undefined && states.pumpOn !== (pumpDesired === 'on') && canAct(deviceNo, 'pump')) {
    await setSwitch('pump', '水泵', pumpDesired, deviceNo, 'linkage_rules')
    actions.push({ device: 'pump', action: pumpDesired })
    // 找出这次真的贡献了"该开/该关"这个结论的规则（候选值跟最终结论一致才算贡献，
    // 只是没表态的 null 不算），贡献规则各写一条联动控制记录，供"告警记录"页面
    // 精确统计到具体是哪条规则触发的。
    const pumpRules = ruleResults.filter(r => r.pump === pumpDesired)
    for (const rule of pumpRules) {
      await recordLinkageAlarm(deviceNo, rule.key, '水泵', pumpDesired, sensors)
    }
    emitLinkage(deviceNo, '水泵', pumpDesired, pumpRules, sensors)
  }

  // PID恒温控制开关是开时改由 service/pidHeating/pidHeating.js 接管加热，这里跳过，
  // 避免两边抢控制权（pidEnabled 已经在上面算过一次，这里不用重复查）。
  if (heaterDesired && !pidEnabled
    && states.heatOn !== undefined && states.heatOn !== (heaterDesired === 'on') && canAct(deviceNo, 'heater')) {
    await setSwitch('heater', '加热', heaterDesired, deviceNo, 'linkage_rules')
    actions.push({ device: 'heater', action: heaterDesired })
    const heaterRules = ruleResults.filter(r => r.heater === heaterDesired)
    for (const rule of heaterRules) {
      await recordLinkageAlarm(deviceNo, rule.key, '加热', heaterDesired, sensors)
    }
    emitLinkage(deviceNo, '加热', heaterDesired, heaterRules, sensors)
  }

  // 观测点必须跟规则9第一段读的那个保持一致，见 TEMP_SOURCES.tempPressureTrend。
  const trendTemp = sensors[TEMP_SOURCES.tempPressureTrend]
  if (trendTemp != null) lastTemp.set(deviceNo, trendTemp)

  result.actions = actions
  lastActions.set(deviceNo, result)

  if (actions.length) {
    console.log(`[LinkageRules] 设备 ${deviceNo || '全局'} 联动:`, JSON.stringify(actions), '故障:', faults)
  }
  return actions
}

module.exports = {
  evaluateLinkageRules,
  LINKAGE_RULE_NAMES,
  onLinkage: (listener) => events.on('linkage', listener),
}
