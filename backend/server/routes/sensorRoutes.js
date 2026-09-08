/**
 * 【文件职责】后端业务 API 路由总表。
 * 集中管理所有 URL → Controller/Service 的映射，app.js 只做 HTTP/WebSocket/MQTT 集成，
 * 配置为代码常量，被调用的控制器/服务各自 require 对应的 config.js。
 * 【挂载点】app.js 里 app.use('/', sensorRoutes)，所以本文件里的路径必须以 /api 开头。
 */
const express = require('express')
const router = express.Router()

// ==================== 传感器相关控制器 ====================
const getDashboardData = require('../controllers/sensor/getDashboardData')
const getTableData = require('../controllers/sensor/tableData')

// ==================== 设备管理控制器 ====================
const device = require('../controllers/device')

// ==================== 故障记录控制器 ====================
const error = require('../controllers/error')

// ==================== 指令配置控制器 ====================
const getDirectConfigTree = require('../controllers/direct/directConfigTree')
const getDirectConfigRender = require('../controllers/direct/directConfigRender')

// ==================== 智能判定控制器 ====================
const intelligentRecognize = require('../controllers/intelligent/recognize')
const judgmentRecords = require('../controllers/intelligent/records')

// ==================== 操作历史控制器 ====================
const operationHistoryController = require('../controllers/operationHistory')
const derivedMetricController = require('../controllers/derivedMetric/derivedMetricController')

// ==================== 测试图表控制器 ====================
const testChartData = require('../controllers/chart/testChartData')
const testEchartsData = require('../controllers/chart/testEchartsData')

// ==================== 累计与窗口指标控制器 ====================
const cumulativeController = require('../controllers/cumulative/cumulativeController')
const { queryFlowIntegralTotal } = require('../service/cumulative/cumulativeService')
const timeWindowController = require('../controllers/timeWindow/timeWindowController')

// ==================== 历史图表控制器 ====================
const chart = require('../controllers/computedMetrics')
const pidHeatingCycleController = require('../controllers/pidHeating/pidHeatingCycleController')
const switchDurationController = require('../controllers/switchDuration/switchDurationController')


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

// ==================== 配置常量（只读接口 + 少数路由内联逻辑要用） ====================
const { SINGLE_DEVICE_MODE } = require('../config/appSettings')
const { CUMULATIVE_METRICS, COMPUTED_METRICS } = require('../config/metrics')
const FAULT_CONFIG = require('../service/faultStatus/config')

/* ============================================================
 * 业务 API 路由
 * ============================================================ */

// ---------- 传感器数据 ----------
router.get('/api/data', getDashboardData)
router.get('/api/dataByType', getTableData)

// ---------- 设备管理 ----------
router.get('/api/deviceData', device.getDeviceManageList)
router.post('/api/deviceData/add', device.addDevice)
router.post('/api/deviceData/delete', device.deleteDevice)
router.post('/api/deviceData/update', device.updateDevice)

// ---------- 故障记录 ----------
router.get('/api/errData', error.getErrorHistory)
router.get('/api/errTypeStats', error.getErrorTypeStats)

// ---------- 智能判定 ----------
// 前端用的是 /judge；/recognize 是旧别名，保留兼容，两个指向同一个处理器。
router.post('/api/intelligent/judge', intelligentRecognize)
router.post('/api/intelligent/recognize', intelligentRecognize)
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
 * 系统配置接口（只读）
 *   配置已改为代码常量（见各 config.js），此接口只把拼装后的完整配置返回给前端展示。
 *   不再有更新 / 重置 / 导入 / 导出。
 * ============================================================ */
router.get('/api/system-config', configController.getConfig)

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
router.get('/api/average-chart', chart.averageChart)
router.get('/api/temp-flow-scatter', chart.scatterChart)
router.get('/api/current-temp', chart.currentTemp)
router.get('/api/device-state-trend', chart.deviceStateTrend)
router.get('/api/heater-energy', chart.heaterEnergy)
router.get('/api/heating-analysis', chart.heatingAnalysis)
router.get('/api/pid-heating-cycles', pidHeatingCycleController)

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
    const data = getLatestComputed()
    // 「累计流量」有两种口径，COMPUTED_METRICS.cumulativeFlowMode 控制：
    //   'all'（默认）——按 flow_integral 从数据库现算"全表积分总量"，跟历史图表页面同一套
    //     算法、同一个口径，且后端重启不归零；
    //   'session'——不覆盖，直接用 computedMetrics.js 里的内存累加值（本次后端启动以来，
    //     重启归零，跟液位反推共用同一个累加器）。
    // 查询失败时保留 computedMetrics 的内存值兜底。
    try {
        const cm = COMPUTED_METRICS || {}
        const flowMetric = (CUMULATIVE_METRICS || []).find(
            (m) => m.metric_key === 'cumulative_flow' && m.enabled && m.aggregation === 'flow_integral'
        )
        if (cm.cumulativeFlow !== false && cm.cumulativeFlowMode !== 'session' && flowMetric) {
            for (const deviceNo of Object.keys(data)) {
                // deviceNo 是字符串 'null' 代表这条消息没能在 t_device 里解析出注册设备号
                // （resolveDeviceNo 失败）——这种情况下 t_sensor_data 根本没有对应行（
                // saveMappedData 遇到未解析设备号会直接跳过入库），如果仍去查“全表总量”，
                // 会把其它已识别设备的流量错误地算到这个“未识别设备”头上。直接跳过，
                // 保留 computedMetrics 的内存值（等同于查询失败时的兜底路径）。
                if (deviceNo === 'null') continue
                const total = await queryFlowIntegralTotal({
                    source_table: flowMetric.source_table,
                    source_field: flowMetric.source_field,
                    d_no: deviceNo,
                    precision: flowMetric.precision ?? 2,
                })
                data[deviceNo].cumulativeFlow = { value: total, unit: flowMetric.unit || 'L' }
            }
        }
    } catch (err) {
        console.error('[ComputedMetrics] 累计流量总量查询失败，回退内存值:', err.message)
    }
    res.json({ success: true, data })
})


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
    const singleDeviceMode = SINGLE_DEVICE_MODE === true
    const faultConfig = FAULT_CONFIG

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
    const singleDeviceMode = SINGLE_DEVICE_MODE === true
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
