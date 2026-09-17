/**
 * 【文件职责】跨页面的通用设置：场景标识、页面显示、分页刷新、术语、字段槽位、图表开关。
 * 这些不属于任何单一业务模块，集中放这里。各控制模块（安全联锁 / 故障 / PID …）自己的
 * 开关在各自目录的 config.js。
 *
 * 【值的来源】以下是从原"配置中心"持久化文件 data/system-config.json 固化下来的**当前
 * 实际生效值**（不是源码出厂默认值）。改配置直接改本文件，改完重启后端生效。
 * 【谁在读】GET /api/system-config 把这里连同各模块 config 拼成一份返回给前端展示用；
 * 后端业务代码按需 require 本文件取对应字段。
 */
module.exports = {
  // ==================== 场景身份与页面标题 ====================
  SCENE_TAG: '2026水循环系统',                       // 场景短名称，现场区分用
  SCENE_DESCRIPTION: '双温度、流量、压力监测及水泵、加热模块控制', // 场景用途说明
  SYSTEM_TITLE: '水循环智能监控系统',                 // 左侧导航标题 + 浏览器页签标题
  DEVICE_LABEL: '设备',                              // "设备"的通用称呼

  // ==================== 设备模式与字段显示 ====================
  // true：只控制一套设备，自动选数据库第一台设备并隐藏选择器。
  // false：多设备模式，操作时可选设备，控制消息按需带 d_no。
  SINGLE_DEVICE_MODE: true,
  HIDE_ID_FIELDS: true,        // 是否隐藏数据库自增主键 id（只影响显示）
  HIDE_NUMBER_FIELDS: false,   // 是否隐藏设备编号列
  SHOW_SECONDS: true,          // 时间是否显示秒
  HIDE_DEVICE_SELECTOR: false, // 多设备模式下强制隐藏设备选择器（单设备模式始终隐藏）

  // ==================== 传感器字段语义槽位（业务语义 → t_sensor_data 物理字段）====================
  // 自动控制、安全联锁、故障判断、联动、计算数据都要从 t_sensor_data 里区分
  // "哪个字段是温度1/温度2/流量/压力"，但库里字段名只是无语义的 field1~field10。
  // key 是业务语义，代码里按这些固定 key 读，不能改名。
  // value 是 t_sensor_data 的物理字段，要和 t_sensor_field_mapper 表里配的 db_name 一致。
  SENSOR_FIELD_MAP: {
    temp1: 'field1',    // 温度1（进水）
    temp2: 'field2',    // 温度2（出水）
    flow: 'field3',     // 瞬时流量
    pressure: 'field4', // 压力
  },

  // ==================== 页面功能开关 ====================
  ENABLE_CHARTS: true, // 是否显示历史/实时数据图表，关闭后只保留表格或卡片

  // ==================== 分页与刷新 ====================
  DEFAULT_PAGE_SIZE: 5,             // 历史表格默认每页条数，允许 1-100
  REALTIME_REFRESH_INTERVAL: 1000, // 实时页面刷新间隔（毫秒）；0 表示不自动刷新

  // ==================== 页面术语（只改页面名称，不影响 MQTT / 表名 / API 路径）====================
  TERMINOLOGY: {
    sensor: '传感器数据',
    behavior: '行为数据',
    device: '设备中心',
    alarm: '告警记录',
    judgment: '智能判定',
  },

  // ==================== 默认目标温度 ====================
  // 指令中心 t_direct 的 target_temperature 优先；只有指令中心没配置时，正常状况联动
  // （linkageRules）和 PID 恒温（pidHeating）才用这个兜底。
  DEFAULT_TARGET_TEMP: 40,

  // ==================== 历史图表页面显示控制 ====================
  // 控制"历史图表"页每张图是否展示、每张图最多多少个点（对应各查询接口的 limit）。
  // 赛场按赛题需要临时关掉不用的图即可。
  HISTORY_CHARTS: {
    pointLimit: 300,                     // 每张图最多显示多少个数据点
    showCumulative: true,                // 累计统计
    showTimeWindow: true,                // 滑动统计
    showAverageChart: true,              // 平均温度与平均流速
    showTempChart: true,                 // 温度曲线（温度1/温度2 原始读数对比）
    showFlowPressureChart: true,         // 瞬时流量与压力
    showPidTrackingChart: true,          // PID 跟踪对比（目标温度参考线 + 温度2 实际值）
    showPumpVelocityTrackingChart: true, // 恒流速跟踪对比（目标流速参考线 + 平均流速实际值）
    showDeviceStateChart: true,          // 设备状态时间线（水泵/加热开关阶梯图）
    showPidHeatingCycleChart: true,      // PID 周期加热开关（按 PWM 周期边界复原的阶梯图）
    showPidDutyChart: true,              // PID 占空比（每个 PWM 周期的占空比 %，跟上一张图共用同一份数据）
    showHeaterEnergyChart: true,         // 加热能耗分析（需 config/metrics.js 的 heaterRatedPower 为正）
    showHeatingAnalysisChart: true,      // 加热效率与加热速度
    showDerivedMetricCharts: true,       // "公式与图表"里勾了"历史图表"的自定义指标
    showTempFlowScatter: true,           // 温度-流量散点
  },
}
