/** 【文件职责】后端业务 API 路由总表。
 * 【配置中心关联】路由不缓存配置，控制器和服务按请求动态读取。 */
const express = require('express')
const router = express.Router()

// 传感器相关控制器
const getDashboardData = require('../controllers/sensor/getDashboardData')
const getHistoryDataByType = require('../controllers/sensor/historyData')

// 设备相关控制器
const getDeviceManageList = require('../controllers/device/deviceManageList')
const addDevice = require('../controllers/device/addDevice')
const deleteDevice = require('../controllers/device/deleteDevice')
const updateDevice = require('../controllers/device/updateDevice')

// 故障相关控制器
const getErrorHistory = require('../controllers/error/errorHistory')
const getErrorTypeStats = require('../controllers/error/errorTypeStats')

// 指令配置相关控制器
const getDirectConfigTree = require('../controllers/direct/directConfigTree')
const getDirectConfigRender = require('../controllers/direct/directConfigRender')

// 智能判定控制器
const intelligentRecognize = require('../controllers/intelligent/recognize')
const judgmentRecords = require('../controllers/intelligent/records')

// 操作历史控制器
const operationHistoryController = require('../controllers/operationHistory/operationHistoryController')
const derivedMetricController = require('../controllers/derivedMetric/derivedMetricController')

// 测试图表数据控制器
const testChartData = require('../controllers/chart/testChartData')
const testEchartsData = require('../controllers/chart/testEchartsData')

// 指令配置服务
const updateMultipleDirectConfigs = require('../service/directData/updateMultipleDirectConfigs')
const updateDirectConfigAndPublish = require('../service/directData/updateDirectConfigAndPublish')

// 故障状态服务（查询故障态 + 手动复位）
const {
  getDeviceFaultState,
  getAnyLockedDeviceNo,
  handleResetButtonOff,
  isAnyLocked,
  FAULT_TYPES,
} = require('../service/faultStatus/faultStatus')
const systemConfig = require('../config/systemConfig')

// 传感器接口
router.get('/data', getDashboardData)
router.get('/dataByType', getHistoryDataByType)

// 设备管理接口
router.get('/deviceData', getDeviceManageList)
router.post('/deviceData/add', addDevice)
router.post('/deviceData/delete', deleteDevice)
router.post('/deviceData/update', updateDevice)

// 故障接口
router.get('/errData', getErrorHistory)
router.get('/errTypeStats', getErrorTypeStats)

// 智能判定接口
router.post('/intelligent/recognize', intelligentRecognize)
router.post('/intelligent/judge', intelligentRecognize)
router.get('/intelligent/records', judgmentRecords)

// 操作历史接口
router.get('/api/operation-history', operationHistoryController.getHistoryList)
router.get('/api/operation-history/configs', operationHistoryController.getConfigOptions)

// SQL 派生指标与 ECharts 配置
router.get('/api/derived-metrics', derivedMetricController.list)
router.post('/api/derived-metrics', derivedMetricController.save)
router.delete('/api/derived-metrics/:id', derivedMetricController.remove)
router.post('/api/derived-metrics/preview', derivedMetricController.preview)

// 测试图表数据接口
router.get('/chart/test-data', testChartData)
router.get('/testChartData', testEchartsData)

// 指令配置接口
router.get('/directData', getDirectConfigTree)

router.get('/directRender', getDirectConfigRender)
router.post('/multipleDirectData', updateMultipleDirectConfigs)
router.post('/directData/update', updateDirectConfigAndPublish)

// ============================================================
// 故障状态接口
// ============================================================
// GET /api/faultStatus/state
//   查询当前故障态 + 复位按钮状态（前端轮询用）。
//   单设备模式：自动定位到当前故障态设备（无故障时返回默认 NORMAL 状态）
//   多设备模式：通过 ?d_no=xxx 指定设备；不传 d_no 时返回所有设备故障态列表
//   返回：{
//     enabled: bool,                  // FAULT_STATUS 总开关是否启用
//     faultTypes: FAULT_TYPES,        // 五种故障类型表（供前端展示）
//     single: { systemState, activeFaultId, resetButton, faultTriggeredAt },  // 单设备
//     list:  [{ deviceNo, systemState, activeFaultId, resetButton, faultTriggeredAt }, ...]  // 多设备
//   }
router.get('/api/faultStatus/state', async (req, res) => {
  try {
    const singleDeviceMode = systemConfig.getConfig().SINGLE_DEVICE_MODE === true
    const faultConfig = systemConfig.getConfig().FAULT_STATUS || {}

    if (singleDeviceMode) {
      // 单设备模式：自动定位到当前故障态设备；无故障时返回默认 NORMAL
      const deviceNo = getAnyLockedDeviceNo()
      return res.json({
        success: true,
        enabled: faultConfig.enabled === true,
        faultTypes: FAULT_TYPES,
        data: getDeviceFaultState(deviceNo),
      })
    }

    // 多设备模式：传 d_no 则返回该设备；否则返回当前所有故障态设备列表
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

    // 未指定 d_no：聚合所有当前处于 FAULT 的设备
    // 注意：deviceStateMap 是 faultStatus 内部 Map，这里通过 isAnyLocked + getAnyLockedDeviceNo
    //       只能拿到一个；完整列表需要 faultStatus 暴露迭代器。本期先返回 isAnyLocked 兜底，
    //       前端若需要列表可单独再扩展。
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
//   单设备模式：自动定位到当前故障态设备；找不到时按默认设备号尝试。
//   多设备模式：用前端传的 d_no；未传时取 'global'。
router.post('/api/faultStatus/reset', async (req, res) => {
  try {
    const singleDeviceMode = systemConfig.getConfig().SINGLE_DEVICE_MODE === true
    let resetDNo = null

    if (singleDeviceMode) {
      // 单设备模式：优先用当前故障态设备的 key，避免设备号映射不一致
      resetDNo = getAnyLockedDeviceNo()
      if (resetDNo == null) {
        // 没有故障态时直接拒绝（正常运行时不需要复位）
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
/** 【文件职责】业务 API 路由总表，将 URL 映射到各领域控制器。
 * 【配置中心关联】路由本身不保存配置；被调用的控制器/服务按需要动态读取配置中心。 */
