/**
 * =========================================================================
 *  🧩 系统全局配置中心  —  PC端后端
 *  =========================================================================
 *
 *  【这个文件是干什么的？】
 *  本文件是整个系统的"总控制台"，所有能通过 API 调整的全局变量都集中在这里。
 *  你可以把它理解成一个"开关面板"——修改这里的值，就能控制系统的各种行为，
 *  而不需要去改代码里的各种硬编码。
 *
 *  【怎么用？】
 *  方式一：直接修改下面的 defaultConfig 对象（改完重启后端生效）
 *  方式二：调用 API 热更新（改完立即生效，无需重启）
 *    POST /api/system-config
 *    Body: {"配置项名": 新值}
 *    例如：{"SINGLE_DEVICE_MODE": false}
 *
 *  【场景切换】
 *  你可以把不同赛题需要的配置导出为JSON文件保存起来，
 *  需要的时候再导入，一键切换所有配置：
 *    GET  /api/system-config/export    → 导出当前配置（保存为 scene_A.json）
 *    POST /api/system-config/import    → 导入场景配置（切换赛题场景）
 *    POST /api/system-config/reset     → 恢复出厂设置（全部默认值）
 *
 *  【前端注意事项】
 *  之前前端 SideBar 上的"显示ID/隐藏编号"按钮后面可以去掉，
 *  改由这里的 HIDE_ID_FIELDS / HIDE_NUMBER_FIELDS 统一控制，
 *  确保所有用户看到的界面一致。
 *  =========================================================================
 */

const defaultConfig = {
  // ============================================================
  // 一、设备模式配置  (Device Mode)
  // ============================================================
  //
  // 【SINGLE_DEVICE_MODE】单设备模式 / 多设备模式
  //   true  = 单设备模式（推荐大多数场景使用）
  //           → 隐藏设备选择器下拉框
  //           → 系统自动选用 t_device 表中第一个设备
  //           → 前端 DirectSetting.vue 不显示设备切换
  //           → directConfigRender.js 自动取第一个设备编号
  //   false = 多设备模式（当系统连接多个设备时使用）
  //           → 显示设备选择器下拉框
  //           → 用户手动选择要配置的设备
  //           → 前端 DirectSetting.vue 显示"电车编号ID"选择器
  //
  //  默认值: true（单设备模式）
  //  影响范围: 指令配置页面、设备配置渲染
  //
  SINGLE_DEVICE_MODE: true,

  // ============================================================
  // 二、字段可见性配置  (Field Visibility)
  // ============================================================
  //  这些配置替代了之前前端 SideBar 上的"显示ID/隐藏ID"、
  //  "显示编号/隐藏编号"两个按钮。
  //  现在由后端统一控制，所有用户看到的界面一致。
  //
  // 【HIDE_ID_FIELDS】隐藏 ID 字段
  //   true  = 在所有表格和卡片中隐藏 id 列
  //   false = 显示 id 列
  //
  //  默认值: false（显示ID）
  //  影响范围: SensorHistory、BehaviorHistory、
  //           SensorRealtime、BehaviorRealtime 的所有表格和卡片
  //
  HIDE_ID_FIELDS: true,

  // 【HIDE_NUMBER_FIELDS】隐藏编号字段
  //   true  = 在所有表格和卡片中隐藏编号列（如"电车编号ID"、"d_no"、"device_id"等）
  //   false = 显示编号列
  //
  //  默认值: false（显示编号）
  //  影响范围: 同上，影响所有数据展示页面
  //
  HIDE_NUMBER_FIELDS: false,

  // ============================================================
  // 三、设备选择器配置  (Device Selector)
  // ============================================================
  //
  // 【HIDE_DEVICE_SELECTOR】隐藏设备选择器
  //   true  = 隐藏设备选择器下拉框（多设备模式下也不显示）
  //   false = 显示设备选择器（多设备模式下用户可切换设备）
  //
  //  注意：当 SINGLE_DEVICE_MODE=true 时，无论此选项是什么，
  //        选择器始终隐藏（单设备不需要选择）。
  //        此选项只在多设备模式下生效。
  //
  //  默认值: false
  //  影响范围: DirectSetting.vue（指令配置页面）
  //
  HIDE_DEVICE_SELECTOR: false,

  // ============================================================
  // 四、页面功能开关  (Feature Toggles)
  // ============================================================
  //
  // 【ENABLE_SENSOR_RECOGNIZE】启用传感器历史数据页面的智能判定
  //   true  = 传感器历史数据页面显示"智能识别"按钮
  //   false = 隐藏传感器历史数据页面的"智能识别"按钮
  //
  //  默认值: true（启用）
  //  影响范围: SensorHistory.vue（传感器历史数据页面）
  //
  ENABLE_SENSOR_RECOGNIZE: false,

  // 【ENABLE_BEHAVIOR_RECOGNIZE】启用行为历史数据页面的智能判定
  //   true  = 行为历史数据页面显示"智能识别"按钮
  //   false = 隐藏行为历史数据页面的"智能识别"按钮
  //
  //  默认值: true（启用）
  //  影响范围: BehaviorHistory.vue（行为历史数据页面）
  //
  ENABLE_BEHAVIOR_RECOGNIZE: true,

  // 【ENABLE_CHARTS】显示图表区域
  //   true  = 在数据列表下方显示折线图/柱状图
  //   false = 隐藏图表区域，只显示数据表格/卡片
  //
  //  默认值: true（显示图表）
  //  影响范围: 所有历史数据页面、实时数据页面的 LineBarCharts 组件
  //
  ENABLE_CHARTS: true,

  // ============================================================
  // 五、数据展示配置  (Data Display)
  // ============================================================
  //
  // 【DEFAULT_PAGE_SIZE】默认每页显示条数
  //   可选值: 5, 10, 15, 20 等正整数
  //   控制历史数据表格每页显示多少条数据
  //
  //  默认值: 5
  //  影响范围: BehaviorHistory.vue、SensorHistory.vue 的分页器
  //
  DEFAULT_PAGE_SIZE: 5,

  // 【REALTIME_REFRESH_INTERVAL】实时数据刷新间隔
  //   单位：毫秒
  //   控制实时数据页面每隔多少毫秒自动刷新一次数据
  //   设为 0 表示不自动刷新，需要用户手动点击"刷新"按钮
  //
  //  默认值: 3000（3秒）
  //  影响范围: SensorRealtime、BehaviorRealtime 页面的自动刷新
  //
  REALTIME_REFRESH_INTERVAL: 3000,

  // 【HEARTBEAT_TIMEOUT】设备心跳超时时间
  //   单位：毫秒
  //   控制设备心跳超时判定离线的时间。
  //   设备在指定时间内未发送心跳，系统即判定设备离线。
  //
  //  默认值: 10000（10秒）
  //  影响范围: 设备在线状态检测、指令发送的门禁检查
  //
  HEARTBEAT_TIMEOUT: 100000,

  // ============================================================
  // 六、场景预设  (Scene Presets)
  // ============================================================
  //  导出/导入配置时用于标识场景的信息，
  //  方便区分不同赛题、不同项目的配置备份。
  //
  // 【SCENE_TAG】场景标签
  //   简短的名字，如"智能家居场景"、"工业监控场景"
  //
  //  默认值: '默认场景'
  //
  SCENE_TAG: '2026水循环系统',

  // 【SCENE_DESCRIPTION】场景描述
  //   更详细的说明，描述这个场景的用途和特点
  //
  //  默认值: '系统初始默认配置'
  //
  SCENE_DESCRIPTION: '双温度、流量、压力监测及水泵、加热模块控制',
}

/**
 * 当前运行的配置（深拷贝默认值，支持热更新）
 */
let currentConfig = JSON.parse(JSON.stringify(defaultConfig))
if (process.env.SINGLE_DEVICE_MODE === 'true' || process.env.SINGLE_DEVICE_MODE === 'false') {
  currentConfig.SINGLE_DEVICE_MODE = process.env.SINGLE_DEVICE_MODE === 'true'
}

function isValidConfigValue(key, value) {
  if (typeof value !== typeof defaultConfig[key]) return false
  if (key === 'DEFAULT_PAGE_SIZE') return Number.isInteger(value) && value > 0 && value <= 100
  if (key === 'REALTIME_REFRESH_INTERVAL') return Number.isFinite(value) && value >= 0
  if (key === 'HEARTBEAT_TIMEOUT') return Number.isFinite(value) && value >= 1000
  return true
}

/**
 * 获取当前配置
 */
function getConfig() {
  return currentConfig
}

/**
 * 更新配置（部分更新，只更新传入的字段）
 */
function updateConfig(partial) {
  if (!partial || typeof partial !== 'object') return false
  let updated = false
  for (const [key, value] of Object.entries(partial)) {
    if (key in currentConfig && isValidConfigValue(key, value)) {
      currentConfig[key] = value
      updated = true
    }
  }

  // 同步 SINGLE_DEVICE_MODE 到 process.env（兼容旧代码 directConfigRender.js）
  if ('SINGLE_DEVICE_MODE' in partial) {
    process.env.SINGLE_DEVICE_MODE = String(currentConfig.SINGLE_DEVICE_MODE)
  }

  return updated
}

/**
 * 重置为默认配置
 */
function resetConfig() {
  currentConfig = JSON.parse(JSON.stringify(defaultConfig))
  process.env.SINGLE_DEVICE_MODE = String(currentConfig.SINGLE_DEVICE_MODE)
}

/**
 * 导出配置（用于保存/备份/迁移到其他赛题）
 */
function exportConfig() {
  return {
    exportTime: new Date().toISOString(),
    ...currentConfig,
  }
}

/**
 * 导入配置（从备份文件恢复）
 * @param {Object} config - 导入的配置对象
 */
function importConfig(config) {
  if (!config || typeof config !== 'object') return false
  // 移除导出时附加的时间戳等元数据
  const { exportTime, ...rest } = config
  return updateConfig(rest)
}

// 初始化时同步 SINGLE_DEVICE_MODE 到 process.env
process.env.SINGLE_DEVICE_MODE = String(currentConfig.SINGLE_DEVICE_MODE)

module.exports = {
  defaultConfig,
  getConfig,
  updateConfig,
  resetConfig,
  exportConfig,
  importConfig,
}
