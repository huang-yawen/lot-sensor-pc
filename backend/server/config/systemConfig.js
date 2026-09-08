/**
 * 【文件职责】把散落在各领域的 config.js 拼成一份完整配置对象，供只读接口
 * GET /api/system-config 返回给前端展示（标题、术语、单设备模式、页面开关等）。
 *
 * 【历史】原来这里是"配置中心"：1200+ 行，负责默认值 + 持久化 system-config.json +
 * 校验 + 浏览器热更新。现在配置改成代码常量（见下面 require 的那些 config.js），
 * 改配置 = 改对应 config.js + 重启后端。本文件只剩"拼装"这一个职责。
 *
 * 【怎么改配置】不要改这里。按下面的对应关系去改各 config.js：
 *   config/appSettings.js ............ 场景标识 / 显示 / 分页刷新 / 术语 / 字段槽位 / 图表开关 / 默认目标温度
 *   config/mqtt.js .................. MQTT 连接 / 主题 / 心跳
 *   config/protocol.js ............... 设备编号&时间字段候选名 / 控制值映射
 *   config/metrics.js ............... 累计 / 滑动窗口 / 首页计算 三类指标
 *   service/safety/config.js ......... 安全联锁
 *   service/faultStatus/config.js .... 故障状态
 *   service/pidHeating/config.js ..... PID 恒温
 *   service/pumpVelocityControl/config.js  恒流速
 *   service/linkageRules/config.js ... 正常状况联动
 *   service/quantityShutdown/config.js  定量停机
 *   service/alarm/config.js ......... 阈值告警
 *   service/operationHistory/config.js  操作历史记录模式
 *   service/switchDuration/config.js .. 首页开关运行时长显示
 *   controllers/intelligent/config.js  智能判定适配器
 *
 * 【业务代码怎么读】各模块直接 require 自己那份 config.js（如
 * `require('./config')`），不要再走 systemConfig.getConfig()。getConfig() 只留给
 * 只读接口用。
 */
const appSettings = require('./appSettings')
const mqtt = require('./mqtt')
const protocol = require('./protocol')
const { CUMULATIVE_METRICS, TIME_WINDOW_METRICS, COMPUTED_METRICS } = require('./metrics')
const { OPERATION_HISTORY_MODE } = require('../service/operationHistory/config')
const SAFETY_INTERLOCK = require('../service/safety/config')
const FAULT_STATUS = require('../service/faultStatus/config')
const PID_HEATING = require('../service/pidHeating/config')
const PUMP_VELOCITY_CONTROL = require('../service/pumpVelocityControl/config')
const LINKAGE_RULES = require('../service/linkageRules/config')
const QUANTITY_SHUTDOWN = require('../service/quantityShutdown/config')
const ALARM_RULES = require('../service/alarm/config')
const SWITCH_DURATION_DISPLAY = require('../service/switchDuration/config')
const INTELLIGENT_JUDGMENT = require('../controllers/intelligent/config')

// 场景结构版本，仅用于前端识别配置结构，不表示项目版本。
const CONFIG_VERSION = 2

// 拼成一份完整配置。键名与含义保持和历史"配置中心"完全一致，前端读取方式不变。
const fullConfig = {
  CONFIG_VERSION,
  ...appSettings,
  OPERATION_HISTORY_MODE,
  CUMULATIVE_METRICS,
  TIME_WINDOW_METRICS,
  ...mqtt,
  ...protocol,
  INTELLIGENT_JUDGMENT,
  SAFETY_INTERLOCK,
  LINKAGE_RULES,
  QUANTITY_SHUTDOWN,
  FAULT_STATUS,
  PID_HEATING,
  PUMP_VELOCITY_CONTROL,
  COMPUTED_METRICS,
  SWITCH_DURATION_DISPLAY,
  ALARM_RULES,
}

/** 返回完整配置的深拷贝，防止调用方改到源对象。只给 GET /api/system-config 用。 */
function getConfig() {
  return JSON.parse(JSON.stringify(fullConfig))
}

module.exports = { getConfig }
