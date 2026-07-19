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

// 测试图表数据控制器
const testChartData = require('../controllers/chart/testChartData')
const testEchartsData = require('../controllers/chart/testEchartsData')

// 指令配置服务
const updateMultipleDirectConfigs = require('../service/directData/updateMultipleDirectConfigs')
const updateDirectConfigAndPublish = require('../service/directData/updateDirectConfigAndPublish')

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

// 测试图表数据接口
router.get('/chart/test-data', testChartData)
router.get('/testChartData', testEchartsData)

// 指令配置接口
router.get('/directData', getDirectConfigTree)

router.get('/directRender', getDirectConfigRender)
router.post('/multipleDirectData', updateMultipleDirectConfigs)
router.post('/directData/update', updateDirectConfigAndPublish)

module.exports = router
