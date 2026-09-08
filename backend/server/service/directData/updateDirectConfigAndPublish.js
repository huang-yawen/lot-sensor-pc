/**
 * 【文件职责】处理单条控制指令：保存当前值、记录操作历史，并向在线设备发布；离线时
 * 交由 DeviceManager 暂存，等心跳恢复后补发。
 * 【配置】SINGLE_DEVICE_MODE 决定设备选择；MQTT_TOPICS.control 决定主题；
 * CONTROL_VALUE_MAP 决定布尔/枚举线上值。字段名来自 t_direct_config.preffix，
 * 不能在业务代码写死。
 *
 * 直接指令更新服务
 *
 * 流程：
 * 1. 先通过 MQTT 发送指令到设备（或暂存等待上线后发送）
 * 2. 发送成功后再保存到数据库
 * 3. 如果设备离线，暂存指令等待上线后发送，发送成功后再保存到数据库
 *
 * 执行顺序是"先发 MQTT，成功了再存数据库"：MQTT 发送成功之后才会把值写入数据库、
 * 返回成功；MQTT 发送失败则直接返回失败，不写数据库。
 *
 * 使用方式：
 *   POST /api/directData/update
 *   Body: { config_id, value, d_no }
 * 
 * 模式说明：
 *   SINGLE_DEVICE_MODE = true  （单设备模式）
 *     - 整个系统只有一套设备
 *     - 前端不传 d_no，后端自动使用默认设备号
 *     - MQTT 消息中不携带 d_no（不传给底层设备）
 *     - 仍检查在线状态，离线暂存
 *   
 *   SINGLE_DEVICE_MODE = false （多设备模式）
 *     - 有多套设备
 *     - 前端传 d_no：null 为全局指令，设备号为单设备指令
 *     - MQTT 消息中携带 d_no
 *     - 检查在线状态，离线暂存
 */

const promisePool = require('../../config/dbPool')
const mqttClient = require('../../mqtt')
const { saveDirectData, getDirectValue } = require('./saveDirectConfig')
const { saveOperationHistory } = require('../operationHistory')
const { SINGLE_DEVICE_MODE } = require('../../config/appSettings')
const SAFETY_CONFIG = require('../safety/config')
const { getTopic, buildSwitchPayload } = require('../../utils/protocol')
const { isLockedByFault, isAnyLocked, getAnyLockedDeviceNo, handleResetButtonOff } = require('../faultStatus/faultStatus')
const { getDefaultDeviceId } = require('../../utils/mappedData')

// ============================================================
// 【模式切换变量】SINGLE_DEVICE_MODE
// ============================================================
// 从 .env 环境变量读取，修改 server/.env 中的 SINGLE_DEVICE_MODE 即可全局生效
// true  - 单设备模式（默认）
// false - 多设备模式
// ============================================================
const isSingleDeviceMode = () => SINGLE_DEVICE_MODE === true

/** 单设备模式下的默认设备编号（从 t_device 表获取的第一个设备） */
const DEFAULT_DEVICE_ID = null // 将在启动时从数据库加载

/**
 * 构建 MQTT 消息 payload。
 * 开关类指令（f_type=1）走 buildSwitchPayload：配置了 wire_template 就整体下发那个
 * 自定义协议报文（如 Modbus 透传），只替换其中 crc 字段；没配置就退回
 * { [preffix]: 线上值 }。
 * 非开关指令如果没配置 preffix（比如流量/压力阈值这类只在本地使用的参考值），
 * 说明它不需要下发给设备，返回 null，调用方据此跳过 MQTT 发送、直接保存数据库。
 * @param {number} configId
 * @param {*} value
 * @returns {Object|null}
 */
async function buildPayload(configId, value) {
  const [rows] = await promisePool.query(
    'SELECT preffix, f_type, t_name, wire_template, wire_on_payload, wire_off_payload FROM t_direct_config WHERE id = ? LIMIT 1',
    [configId]
  )
  if (!rows.length) throw new Error(`指令配置 ID ${configId} 不存在`)

  const config = rows[0]

  // 只按数据库控件类型判断开关，不再使用旧项目的硬编码 ID。
  if (String(config.f_type) === '1') {
    return buildSwitchPayload(config, value)
  }

  const key = String(config.preffix || '').trim()
  if (!key) return null

  return { [key]: String(value) }
}

/**
 * 判断给定 config_id 是否对应"复位按钮"开关（preffix = reset_button）。
 * 复位按钮有独立的状态机，不能走常规指令更新流程。
 */
async function isResetButtonConfig(configId) {
  const [rows] = await promisePool.query(
    "SELECT preffix, t_name FROM t_direct_config WHERE id = ? AND f_type = '1' LIMIT 1",
    [configId]
  )
  if (!rows.length) return false
  const prefix = String(rows[0].preffix || '').trim().toLowerCase()
  const name = String(rows[0].t_name || '').trim()
  return prefix === 'reset_button' || prefix === 'reset' || prefix === 'reset_btn' || prefix === 'reset_all' || name === '复位'
}

/** 判断给定 config_id 是否对应"加热"开关（preffix = heater）。 */
async function isHeaterConfig(configId) {
  const [rows] = await promisePool.query(
    "SELECT preffix FROM t_direct_config WHERE id = ? AND f_type = '1' LIMIT 1",
    [configId]
  )
  if (!rows.length) return false
  return String(rows[0].preffix || '').trim().toLowerCase() === 'heater'
}

/** 判断给定 config_id 是否是开关类指令项（f_type=1）。故障锁定只锁开关，
 * 阈值/参数类指令项（输入框、滑块等）不受影响，用来在锁定前区分两者。 */
async function isSwitchConfig(configId) {
  const [rows] = await promisePool.query(
    "SELECT id FROM t_direct_config WHERE id = ? AND f_type = '1' LIMIT 1",
    [configId]
  )
  return rows.length > 0
}

/** 按 preffix 查 t_direct_config.id，跟 controlShared/controlHelpers.js/safetyInterlock.js 里的同名函数逻辑一致。 */
async function resolveConfigIdByPrefix(prefix) {
  if (!prefix) return null
  const [rows] = await promisePool.query(
    "SELECT id FROM t_direct_config WHERE preffix IS NOT NULL AND preffix != '' AND LOWER(preffix) = LOWER(?) ORDER BY id ASC LIMIT 1",
    [prefix]
  )
  return rows[0]?.id ?? null
}

/** 把指令值统一判断成"开"，跟 faultSnapshot.js 的 getSwitchValueByPrefix 用同一套取值约定。 */
function isOnValue(value) {
  return ['on', 'open', '1', 'true'].includes(String(value).trim().toLowerCase())
}

/** 项目里所有"下限/上限"成对出现的阈值指令项（按 preffix），下限必须 <= 上限。
 * 新增阈值对时在这里补一行即可，不用改下面的校验逻辑。 */
const BOUND_PAIRS = [
  { low: 'temp_low', high: 'temp_high', label: '温度' },
  { low: 'flow_low', high: 'flow_high', label: '流量' },
  { low: 'pressure_low', high: 'pressure_high', label: '压力' },
  { low: 'pid_duty_min', high: 'pid_duty_max', label: '占空比' },
]

/**
 * 校验这次要设置的阈值，跟它配对的另一侧（下限/上限）比，是否仍满足"下限 <= 上限"。
 * 不是阈值对里的字段（大多数指令项都不是）直接跳过，返回 null；配对的另一侧还没
 * 配置过值时也跳过（没有基准可比，不应该因为对侧空着就拒绝这次设置）。
 * @returns {Promise<string|null>} 校验失败时返回错误提示文案，通过返回 null
 */
async function validateBoundPair(configId, value, d_no) {
  const [rows] = await promisePool.query(
    'SELECT preffix FROM t_direct_config WHERE id = ? LIMIT 1',
    [configId]
  )
  const preffix = String(rows[0]?.preffix || '').trim().toLowerCase()
  const pair = BOUND_PAIRS.find(p => p.low === preffix || p.high === preffix)
  if (!pair) return null

  const isLow = pair.low === preffix
  const counterpartId = await resolveConfigIdByPrefix(isLow ? pair.high : pair.low)
  if (counterpartId == null) return null

  const counterpartValue = await getDirectValue({ config_id: counterpartId, d_no })
  if (counterpartValue == null) return null

  const counterpartNum = Number(counterpartValue)
  const newNum = Number(value)
  if (!Number.isFinite(counterpartNum) || !Number.isFinite(newNum)) return null

  const lowNum = isLow ? newNum : counterpartNum
  const highNum = isLow ? counterpartNum : newNum
  if (lowNum > highNum) {
    return `${pair.label}下限(${lowNum})不能大于上限(${highNum})`
  }
  return null
}

/** saveDirectData 带小退避重试：故障期间数据库并发压力大时偶发死锁 / 连接抖动，
 *  重试几次再放弃。返回 { ok:true, result } 或 { ok:false, error }——调用方据此如实
 *  报错，而不是直接丢值、或把存库失败谎报成别的错。 */
async function saveDirectDataWithRetry(params, tries = 3) {
  let lastErr = null
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return { ok: true, result: await saveDirectData(params) }
    } catch (err) {
      lastErr = err
      console.warn(`[DirectUpdate] 存库第 ${attempt}/${tries} 次失败: ${err.message}`)
      if (attempt < tries) await new Promise(r => setTimeout(r, 150 * attempt))
    }
  }
  return { ok: false, error: lastErr }
}

/**
 * 处理指令更新请求
 * POST /directData/update
 * 
 * 流程：先发消息（或暂存），成功后再保存到数据库
 */
module.exports = async (req, res) => {
  try {
    const { config_id, value, d_no } = req.body

    // 参数校验
    if (config_id === undefined || config_id === null || config_id === '') {
      return res.status(400).json({ success: false, message: 'config_id 必填' })
    }

    const singleDeviceMode = isSingleDeviceMode()
    console.log('[DirectUpdate] 收到指令:', { config_id, value, d_no, mode: singleDeviceMode ? '单设备' : '多设备' })

    // ========== 故障锁定 + 复位按钮联动 ==========
    // 复位按钮有独立状态机，必须最先拦截：
    //   - 拨到 off（用户人工修复后复位）：调 handleResetButtonOff 走快照恢复流程
    //   - 拨到 on：拒绝，复位按钮只能由系统在故障触发时自动拨到 on，不能由用户手动设为 on
    //     （正常运行时复位按钮始终为 off）
    // 其他开关：故障态且复位按钮为 on 期间锁定，只读不可改；阈值/参数类指令项
    // （f_type≠1）不受锁定影响，故障期间也能正常调整（比如调阈值排查问题）
    const isResetBtn = await isResetButtonConfig(config_id)
    if (isResetBtn) {
      const v = String(value).trim().toLowerCase()
      if (['off', 'close', 'closed', '0', 'false'].includes(v)) {
        // 用户把复位按钮拨到 off -> 触发快照恢复
        // 单设备模式下用 getAnyLockedDeviceNo 取当前锁定状态对应的设备号，
        // 多设备模式下直接用前端传的 d_no
        let resetDNo = null
        if (singleDeviceMode) {
          resetDNo = getAnyLockedDeviceNo() ?? await getDefaultDeviceId()
        } else {
          resetDNo = (d_no && d_no !== 'null' && d_no !== 'undefined') ? String(d_no).trim() : null
        }
        const result = await handleResetButtonOff(resetDNo)
        return res.json({
          success: result.success,
          message: result.message,
          data: { status: 'fault_reset', ...result.data }
        })
      }
      // 用户尝试手动拨到 on -> 拒绝
      return res.status(403).json({
        success: false,
        message: '复位按钮只能由系统在故障触发时自动拨到"开"，不能手动置为开',
        data: { status: 'rejected' }
      })
    }

    // 非复位按钮的开关：故障态下锁定，禁止修改；阈值/参数类指令项（f_type≠1）
    // 跳过锁定检查，故障期间照常允许调整。
    // 单设备模式下：系统只有一个设备，任意一把锁住就拒绝
    // 多设备模式下：按 d_no 精确匹配
    if (await isSwitchConfig(config_id)) {
      if (singleDeviceMode) {
        if (isAnyLocked()) {
          console.warn(`[DirectUpdate] 指令 ${config_id} 被故障锁定拒绝（单设备模式）`)
          return res.status(403).json({
            success: false,
            message: '系统处于故障态，指令页面已锁定，请先把复位按钮拨到"关"以恢复',
            data: { status: 'locked' }
          })
        }
      } else {
        const lockDNo = (d_no && d_no !== 'null' && d_no !== 'undefined') ? String(d_no).trim() : null
        if (isLockedByFault(lockDNo)) {
          console.warn(`[DirectUpdate] 指令 ${config_id} 被故障锁定拒绝（设备=${lockDNo || '全局'}）`)
          return res.status(403).json({
            success: false,
            message: '系统处于故障态，指令页面已锁定，请先把复位按钮拨到"关"以恢复',
            data: { status: 'locked' }
          })
        }
      }
    }

    // ========== 加热必须在水泵已开启时才能打开 ==========
    // 只拦截"要把加热打开"这一种操作；关闭加热、以及水泵本身的开关都不受影响。
    // 是否启用这条拦截由 SAFETY_INTERLOCK.requirePumpBeforeHeater 单独控制，
    // 跟安全联锁评估循环是两处独立的代码，这里只在指令入口做这一次检查。
    const requirePumpBeforeHeater = SAFETY_CONFIG.requirePumpBeforeHeater !== false
    if (requirePumpBeforeHeater && isOnValue(value) && await isHeaterConfig(config_id)) {
      const pumpConfigId = await resolveConfigIdByPrefix('pump')
      // 单设备模式下水泵的值存在真实设备号下（不是 d_no IS NULL 的全局行），
      // 这里必须用 getDefaultDeviceId() 查真实设备号，传 null 会永远查不到水泵
      // 当前状态，导致这条检查在单设备模式下把"打开加热"一律误判拒绝。
      const pumpQueryDNo = singleDeviceMode ? await getDefaultDeviceId() : d_no
      const pumpValue = pumpConfigId != null ? await getDirectValue({ config_id: pumpConfigId, d_no: pumpQueryDNo }) : null
      if (!isOnValue(pumpValue)) {
        console.warn(`[DirectUpdate] 指令 ${config_id} 被拒绝：水泵未开启时不允许打开加热`)
        return res.status(403).json({
          success: false,
          message: '水泵未开启，不能打开加热，请先打开水泵',
          data: { status: 'rejected' }
        })
      }
    }

    // ========== 阈值上下限校验 ==========
    // 只有 BOUND_PAIRS 里配对的下限/上限指令项才会真的检查，其它指令项 validateBoundPair
    // 直接返回 null 跳过，不影响这些指令项本来的保存流程。
    const boundQueryDNo = singleDeviceMode ? await getDefaultDeviceId() : d_no
    const boundError = await validateBoundPair(config_id, value, boundQueryDNo)
    if (boundError) {
      console.warn(`[DirectUpdate] 指令 ${config_id} 被拒绝：${boundError}`)
      return res.status(400).json({
        success: false,
        message: boundError,
        data: { status: 'rejected' }
      })
    }

    // 1. 构建 MQTT 消息
    const payload = await buildPayload(config_id, value)

    // 2. 确定目标设备编号
    let deviceId = null

    if (singleDeviceMode) {
      // ========== 单设备模式 ==========
      // 从数据库获取默认设备编号
      deviceId = await getDefaultDeviceId()
      console.log(`[DirectUpdate] 单设备模式，默认设备编号: ${deviceId}`)
      // MQTT 消息中不携带 d_no（不传给底层设备）
    } else {
      // ========== 多设备模式 ==========
      deviceId = d_no && d_no !== 'null' && d_no !== 'undefined' ? String(d_no).trim() : null
      console.log(`[DirectUpdate] 多设备模式，设备编号: ${deviceId}`)
      // MQTT 消息中携带 d_no（传给底层设备）
      // 全局指令也传 d_no: null，让底层设备明确知道这是全局指令
      if (payload) payload.d_no = deviceId
    }

    // 2.5 没有配置 MQTT 字段的指令（如阈值类参考值）只在本地保存，不下发设备。
    if (payload === null) {
      // 统一用上面已经标准化过的 deviceId（null=全局，设备号=设备专属），不能直接
      // 用前端传来的原始 d_no——多设备模式下它可能是字符串 'null'/'undefined'，
      // t_direct 那层 saveDirectData/getDirectValue 内部有 normalizeDeviceNo 兜底
      // 不受影响，但 saveOperationHistory 没有这层兜底，字符串 'null' 会被当成真实
      // 设备号原样存进 t_operation_history，导致这条全局操作历史归错到一个叫
      // "null" 的设备名下。
      const saveDNo = deviceId
      let oldValue = null
      try {
        oldValue = await getDirectValue({ config_id, d_no: saveDNo })
      } catch (readErr) {
        console.warn('[DirectUpdate] 读旧值失败（不影响存库，仅历史 old_value 记为空）:', readErr.message)
      }
      const saved = await saveDirectDataWithRetry({ config_id, value, d_no: saveDNo })
      if (!saved.ok) {
        console.error('[DirectUpdate] 本地参数存库多次失败:', saved.error && saved.error.message)
        return res.status(503).json({
          success: false,
          message: '保存到数据库失败，请稍后重试',
          data: { status: 'save_failed', error: saved.error && saved.error.message }
        })
      }
      const saveResult = saved.result
      console.log('[DirectUpdate] 本地配置保存成功（未配置 MQTT 字段，不下发）:', saveResult)

      const historyResult = await saveOperationHistory({
        d_no: deviceId,
        config_id: Number(config_id),
        old_value: oldValue,
        new_value: String(value),
        source: 'manual'
      })

      const wsBroadcast = req.app.get('wsBroadcast')
      if (wsBroadcast) wsBroadcast('direct_data_updated', { config_id, value, d_no: saveDNo })

      return res.json({
        success: true,
        message: '本地配置已保存（未配置 MQTT 字段，不下发设备）',
        data: { db: saveResult, status: 'saved_local', history: historyResult }
      })
    }

    // 3. 检查设备在线状态
    if (deviceId) {
      const isAlive = mqttClient.checkIfAlive(deviceId)
      console.log(`[DirectUpdate] 设备 ${deviceId} 在线状态: ${isAlive}`)
      if (!isAlive) {
        // 设备离线 -> 暂存指令（不保存到数据库，等上线发送成功后再保存）
        console.log(`[DirectUpdate] 设备 ${deviceId} 离线，指令暂存`)
        mqttClient.addPendingCommand(deviceId, config_id, value)

        return res.json({
          success: true,
          message: '设备离线，指令已暂存，将在上线后自动发送并保存',
          data: { status: 'queued' }
        })
      }
    } else {
      // 无指定设备（全局配置）-> 直接发送，不检查在线状态
      console.log('[DirectUpdate] 全局配置，直接发送')
    }

    // 4. 设备在线 -> 先发送指令（间隔 200ms 连续发送两次）。
    //    这一段只负责"发出去"，跟下面第 5 步"存库"是两段独立的 try/catch：发送本身失败
    //    才返回「MQTT 发送失败」；一旦确认发出去了，存库偶发失败不再谎报成发送失败、
    //    也不直接丢弃。
    try {
      // 第一次发送
      const firstPublish = await mqttClient.publish(getTopic('control'), payload)
      if (firstPublish.status !== 'published') {
        throw new Error(`MQTT 第一次发送未成功: ${firstPublish.status}`)
      }
      console.log('[DirectUpdate] MQTT 第一次发送成功')

      // 第二次发送（间隔 200ms，确保设备可靠接收）
      await new Promise(resolve => setTimeout(resolve, 200))
      const secondPublish = await mqttClient.publish(getTopic('control'), payload)
      if (secondPublish.status !== 'published') {
        throw new Error(`MQTT 第二次发送未成功: ${secondPublish.status}`)
      }
      console.log('[DirectUpdate] MQTT 第二次发送成功')
    } catch (err) {
      console.error('[DirectUpdate] MQTT 发送失败:', err.message)
      return res.status(503).json({
        success: false,
        message: 'MQTT 发送失败，指令未保存到数据库',
        data: { status: 'failed', error: err.message }
      })
    }

    // 5. 已确认下发，再保存到数据库。统一用上面已标准化的 deviceId（null=全局，
    //    设备号=设备专属），理由同上（2.5 步）：不能直接用前端传来的原始 d_no。
    //    "确认发出去了"之后就应尽量把值落库——故障期间数据库并发压力大（快照全表扫、
    //    强制关泵/加热、告警入库、传感器持续入库、前端轮询…），saveDirectData 偶发拿不到
    //    连接 / 锁等待超时，这里带小退避重试几次，仍失败才如实返回「已发送但存库失败」，
    //    不再谎报成 MQTT 失败。
    const saveDNo = deviceId
    let oldValue = null
    try {
      oldValue = await getDirectValue({ config_id, d_no: saveDNo })
    } catch (readErr) {
      console.warn('[DirectUpdate] 读旧值失败（不影响存库，仅历史 old_value 记为空）:', readErr.message)
    }

    const saved = await saveDirectDataWithRetry({ config_id, value, d_no: saveDNo })
    if (!saved.ok) {
      console.error('[DirectUpdate] 指令已下发但存库多次失败:', saved.error && saved.error.message)
      return res.status(503).json({
        success: false,
        message: '指令已发送到设备，但保存到数据库失败，请稍后重试',
        data: { status: 'sent_not_saved', error: saved.error && saved.error.message }
      })
    }
    const saveResult = saved.result
    console.log('[DirectUpdate] 数据库保存成功:', saveResult)

    // 记录操作历史（手动指令下发）
    // 只存 config_id + new_value，操作名称和值含义通过 JOIN t_direct_config 获取
    const historyResult = await saveOperationHistory({
      d_no: deviceId,
      config_id: Number(config_id),
      old_value: oldValue,
      new_value: String(value),
      source: 'manual'
    })

    const historyMessage = historyResult.skipped
      ? '指令已发送并保存；当前配置不记录软件操作历史'
      : historyResult.success
        ? '指令已发送、保存并记录操作历史'
        : '指令已发送并保存，但操作历史记录失败'
    const wsBroadcast = req.app.get('wsBroadcast')
    if (wsBroadcast) wsBroadcast('direct_data_updated', { config_id, value, d_no: saveDNo })

    return res.json({
      success: true,
      message: historyMessage,
      data: { db: saveResult, status: 'published', history: historyResult }
    })

  } catch (err) {
    console.error('[DirectUpdate] 服务器错误:', err)
    return res.status(500).json({
      success: false,
      message: err.message || '处理指令失败'
    })
  }
}
