const express = require('express');
const router = express.Router();
// Controllers
const getSensorData = require('../controllers/getSensorData');
const getDataByType = require('../controllers/getDataByType');
const getDeviceManageData = require('../controllers/getDeviceManageData');
const getErrData = require('../controllers/getErrData');
const getErrTypeStats = require('../controllers/getErrTypeStats');
const getDirectTree = require('../controllers/getDirectTree')
const getDirectRender=require('../controllers/getDirectRender')
// Service: deviceData
const addDeviceData = require('../service/deviceData/addDeviceData');
const deleteDeviceData = require('../service/deviceData/deleteDeviceData');
const updateDeviceData = require('../service/deviceData/updateDeviceData');

// Service: directData
const updateMultipleDirectData=require('../service/directData/updateMultipleDirectData')

// 路由分组
// 传感器相关
router.get('/data', getSensorData);
router.get('/dataByType', getDataByType);

// 设备管理相关
router.get('/deviceData', getDeviceManageData);
router.post('/deviceData/add', addDeviceData);
router.post('/deviceData/delete', deleteDeviceData);
router.post('/deviceData/update', updateDeviceData);

// 错误数据相关
router.get('/errData', getErrData);
router.get('/errTypeStats', getErrTypeStats);

// 指令树相关
router.get('/directData', getDirectTree);
router.get('/directRender',getDirectRender)
router.post('/multipleDirectData',updateMultipleDirectData);
module.exports = router;
