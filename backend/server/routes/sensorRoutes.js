/**
 * 【文件职责】后端业务 API 路由总表。
 * 集中管理所有 URL → Controller/Service 的映射，app.js 只做 HTTP/WebSocket/MQTT 集成，
 * 路由本身不缓存配置；被调用的控制器/服务按请求动态读取配置中心。
 * 【挂载点】app.js 里 app.use('/', sensorRoutes)，所以本文件里的路径必须以 /api 开头。
 */
const express = require('express')
const router = express.Router()

// ==================== 传感器相关控制器 ====================
const getDashboardData = require('../controllers/sensor/getDashboardData')
const getHistoryDataByType = require('../controllers/sensor/historyData')

// ==================== 设备管理控制器 ====================
const getDeviceManageList = require('../controllers/device/deviceManageList')
const addDevice = require('../controllers/device/addDevice')
const deleteDevice = require('../controllers/device/deleteDevice')
const updateDevice = require('../controllers/device/updateDevice')

// ==================== 故障记录控制器 ====================
const getErrorHistory = require('../controllers/error/errorHistory')
const getErrorTypeStats = require('../controllers/error/errorTypeStats')

// ==================== 指令配置控制器 ====================
const getDirectConfigTree = require('../controllers/direct/directConfigTree')
const getDirectConfigRender = require('../controllers/direct/directConfigRender')

// ==================== 智能判定控制器 ====================
const intelligentRecognize = require('../controllers/intelligent/recognize')
const judgmentRecords = require('../controllers/intelligent/records')

// ==================== 操作历史控制器 ====================
const operationHistoryController = require('../controllers/operationHistory/operationHistoryController')
const derivedMetricController = require('../controllers/derivedMetric/derivedMetricController')

// ==================== 测试图表控制器 ====================
const testChartData = require('../controllers/chart/testChartData')
const testEchartsData = require('../controllers/chart/testEchartsData')

// ==================== 累计与窗口指标控制器 ====================
const cumulativeController = require('../controllers/cumulative/cumulativeController')
const timeWindowController = require('../controllers/timeWindow/timeWindowController')

// ==================== 历史图表控制器 ====================
const averageChartController = require('../controllers/computedMetrics/averageChartController')
const scatterChartController = require('../controllers/computedMetrics/scatterChartController')
const currentTempController = require('../controllers/computedMetrics/currentTempController')
const deviceStateTrendController = require('../controllers/computedMetrics/deviceStateTrendController')
const heaterEnergyController = require('../controllers/computedMetrics/heaterEnergyController')
const switchDurationController = require('../controllers/switchDuration/switchDurationController')

// ==================== PID 自整定控制器 ====================
const { applyAutoTuneResult } = require('../controllers/system/pidAutoTuneController')

// ==================== 系统配置控制器 ====================
const configController = require('../controllers/system/configController')

// ==================== 指令配置服务 ====================
const updateMultipleDirectConfigs = require('../service/directData/updateMultipleDirectConfigs')
const updateDirectConfigAndPublish = require('../service/directData/updateDirectConfigAndPublish')

// ==================== 故障状态服务 ====================
const {
  getDeviceFaultState,
  getAnyLockedDeviceNo,
  handleResetButtonOff,
  isAnyLocked,
  FAULT_TYPES,
} = require('../service/faultStatus/faultStatus')

// ==================== 实时计算指标服务 ====================
const { getLatest: getLatestComputed, refreshFromDB: refreshComputedFromDB } = require('../service/computedMetrics/computedMetrics')

// ==================== MQTT 客户端（诊断 + 设备状态接口需要） ====================
const mqttClient = require('../mqtt/index')

// ==================== 配置中心 ====================
const systemConfig = require('../config/systemConfig')

/* ============================================================
 * 业务 API 路由
 * ============================================================ */

// ---------- 传感器数据 ----------
router.get('/api/data', getDashboardData)
router.get('/api/dataByType', getHistoryDataByType)

// ---------- 设备管理 ----------
router.get('/api/deviceData', getDeviceManageList)
router.post('/api/deviceData/add', addDevice)
router.post('/api/deviceData/delete', deleteDevice)
router.post('/api/deviceData/update', updateDevice)

// ---------- 故障记录 ----------
router.get('/api/errData', getErrorHistory)
router.get('/api/errTypeStats', getErrorTypeStats)

// ---------- 智能判定 ----------
router.post('/api/intelligent/recognize', intelligentRecognize)
router.post('/api/intelligent/judge', intelligentRecognize)
router.get('/api/intelligent/records', judgmentRecords)

// ---------- 操作历史 ----------
router.get('/api/operation-history', operationHistoryController.getHistoryList)
router.get('/api/operation-history/configs', operationHistoryController.getConfigOptions)

// ---------- SQL 派生指标 ----------
router.get('/api/derived-metrics', derivedMetricController.list)
router.post('/api/derived-metrics', derivedMetricController.save)
router.delete('/api/derived-metrics/:id', derivedMetricController.remove)
router.post('/api/derived-metrics/preview', derivedMetricController.preview)
router.get('/api/derived-metrics/history', derivedMetricController.history)

// ---------- 测试图表 ----------
router.get('/api/chart/test-data', testChartData)
router.get('/api/testChartData', testEchartsData)

// ---------- 指令配置 ----------
router.get('/api/directData', getDirectConfigTree)
router.get('/api/directRender', getDirectConfigRender)
router.post('/api/multipleDirectData', updateMultipleDirectConfigs)
router.post('/api/directData/update', updateDirectConfigAndPublish)

/* ============================================================
 * 系统配置接口
 *   全局场景配置的增删改查 + 导出导入，配置中心热更新后立即生效。
 * ============================================================ */
router.get('/api/system-config', configController.getConfig)
router.post('/api/system-config', configController.updateConfig)
router.post('/api/system-config/reset', configController.resetConfig)
router.get('/api/system-config/export', configController.exportConfig)
router.post('/api/system-config/import', configController.importConfig)

/* ============================================================
 * MQTT 诊断接口
 *   返回当前 MQTT 连接状态（是否已连接、客户端是否已初始化、Broker URL）。
 *   用于前端或运维快速诊断后端与 Broker 的通信是否正常。
 * ============================================================ */
router.get('/api/mqtt/status', (req, res) => {
    res.json({
        success: true,
        data: {
            isConnected: mqttClient.isConnected,
            clientInitialized: !!mqttClient.client,
            url: mqttClient.config?.url || 'mqtt://localhost:1883'
        }
    })
})

/* ============================================================
 * 累计与窗口指标接口
 *   累计指标（cumulative）按配置对历史数据做窗口函数累加；
 *   时间窗口指标（time-window）做滑动平均/波动/变化率计算。
 *   两者配置都在 system-config.json 的 CUMULATIVE_METRICS / TIME_WINDOW_METRICS 里。
 * ============================================================ */
router.get('/api/cumulative', cumulativeController)
router.get('/api/time-window', timeWindowController)

/* ============================================================
 * 历史图表接口
 *   为"历史图表"页面提供聚合查询：平均温度/流速时间线、温流散点图、
 *   当前温度、设备开关状态时间线、加热能耗分析（瞬时功率/累计耗电/换热量）。
 * ============================================================ */
router.get('/api/average-chart', averageChartController)
router.get('/api/temp-flow-scatter', scatterChartController)
router.get('/api/current-temp', currentTempController)
router.get('/api/device-state-trend', deviceStateTrendController)
router.get('/api/heater-energy', heaterEnergyController)

/* ============================================================
 * 设备与运行状态接口
 *   /api/device-status    —— 返回所有设备的在线状态（DeviceManager 同步自 t_device）。
 *   /api/switch-duration  —— 返回水泵/加热器的累计运行时长 + 本次已运行时长（首页用）。
 *   /api/computed-metrics —— 返回后端实时算出的工程指标（平均温度、能耗等）。
 *                           暂无 MQTT 数据时从数据库历史回放一次兜底，保证有值可显示。
 * ============================================================ */
router.get('/api/device-status', async (req, res) => {
    await mqttClient.waitForDeviceSync()
    res.json({ success: true, data: mqttClient.getAllDeviceStatus() })
})

router.get('/api/switch-duration', switchDurationController)

router.get('/api/computed-metrics', async (req, res) => {
    try {
        await refreshComputedFromDB()
    } catch (err) {
        console.error('[ComputedMetrics] 数据库回放失败:', err.message)
    }
    res.json({ success: true, data: getLatestComputed() })
})

/* ============================================================
 * PID 自整定接口
 *   把自整定算出的建议 Kp/Ki/Kd 写入指令中心 t_direct，用于后续运行时直接生效。
 * ============================================================ */
router.post('/api/pid-autotune/apply', applyAutoTuneResult)

/* ============================================================
 * 故障状态接口
 * ============================================================ */
// GET /api/faultStatus/state
//   查询当前故障态 + 复位按钮状态（前端轮询用）。
//   单设备模式：自动定位到当前故障态设备（无故障时返回默认 NORMAL 状态）
//   多设备模式：通过 ?d_no=xxx 指定设备；不传 d_no 时返回所有设备故障态列表
//   返回：{
//     enabled: bool,                  // FAULT_STATUS 总开关是否启用
//     faultTypes: FAULT_TYPES,        // 五种故障类型表（供前端展示）
//     data: { systemState, activeFaultId, resetButton, faultTriggeredAt },  // 单设备
//     anyLocked: bool                 // 多设备模式下的兜底聚合
//   }
router.get('/api/faultStatus/state', async (req, res) => {
  try {
    const singleDeviceMode = systemConfig.getConfig().SINGLE_DEVICE_MODE === true
    const faultConfig = systemConfig.getConfig().FAULT_STATUS || {}

    if (singleDeviceMode) {
      const deviceNo = getAnyLockedDeviceNo()
      return res.json({
        success: true,
        enabled: faultConfig.enabled === true,
        faultTypes: FAULT_TYPES,
        data: getDeviceFaultState(deviceNo),
      })
    }

    const dNoRaw = req.query.d_no
    if (dNoRaw != null && dNoRaw !== '' && dNoRaw !== 'null' && dNoRaw !== 'undefined') {
      const dNo = String(dNoRaw).trim()
      return res.json({
        success: true,
        enabled: faultConfig.enabled === true,
        faultTypes: FAULT_TYPES,
        data: getDeviceFaultState(dNo),
      })
    }

    const anyLocked = isAnyLocked()
    const anyDeviceNo = getAnyLockedDeviceNo()
    return res.json({
      success: true,
      enabled: faultConfig.enabled === true,
      faultTypes: FAULT_TYPES,
      data: anyLocked ? getDeviceFaultState(anyDeviceNo) : null,
      anyLocked,
    })
  } catch (err) {
    console.error('[FaultStatus/state] 查询失败:', err)
    return res.status(500).json({ success: false, message: err.message || '查询故障态失败' })
  }
})

// POST /api/faultStatus/reset
//   手动复位（用户人工修复设备后点击"复位"按钮）。
//   Body: { d_no?: string|null }
//   行为：等价于把"复位按钮"开关从 on 拨到 off，触发 handleResetButtonOff 走快照恢复流程。
router.post('/api/faultStatus/reset', async (req, res) => {
  try {
    const singleDeviceMode = systemConfig.getConfig().SINGLE_DEVICE_MODE === true
    let resetDNo = null

    if (singleDeviceMode) {
      resetDNo = getAnyLockedDeviceNo()
      if (resetDNo == null) {
        return res.status(400).json({
          success: false,
          message: '当前无故障态，无需复位',
          data: { status: 'no_fault' }
        })
      }
    } else {
      const dNoRaw = req.body?.d_no
      resetDNo = (dNoRaw != null && dNoRaw !== '' && dNoRaw !== 'null' && dNoRaw !== 'undefined')
        ? String(dNoRaw).trim()
        : null
    }

    const result = await handleResetButtonOff(resetDNo)
    return res.json({
      success: result.success,
      message: result.message,
      data: { status: 'fault_reset', ...result.data },
    })
  } catch (err) {
    console.error('[FaultStatus/reset] 复位失败:', err)
    return res.status(500).json({ success: false, message: err.message || '复位失败' })
  }
})

module.exports = router
