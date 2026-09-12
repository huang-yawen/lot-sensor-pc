/**
 * 【文件职责】三类"指标"配置：累计统计、滑动窗口统计、首页计算数据。
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 每条指标 enabled=false 就只保留配置、不参与计算。
 * 【谁在读】service/cumulative、service/timeWindow、service/computedMetrics、
 * service/switchDuration、service/controlShared/controlHelpers、utils/mappedData 等。
 */

// ============================================================================
// 累计统计指标：后端用 MySQL 窗口函数 SUM/AVG/COUNT OVER(ORDER BY c_time ROWS
// UNBOUNDED PRECEDING) 计算累加值。
// 字段说明：
//   metric_key   - 数据库标识（小写字母+下划线）
//   metric_name  - 页面显示中文名
//   source_table - 源表：t_sensor_data 或 t_behavior_data
//   source_field - 源表中的数值字段（如 field3）
//   unit         - 单位
//   enabled      - true 启用累计计算；false 仅保留配置不查询
//   aggregation  - 省略=SUM 直接累加；avg=累计平均；on_duration=开关为1的累计时长；
//                  flow_integral=源字段是每分钟速率量（L/min），按 值/60×时间间隔 积分累加
//   mode         - "inline"=合入历史表/图表，"standalone"=仅首页独立展示，"both"=两者同时
//   precision    - 小数位数
//   chart_type   - ECharts 图表类型：line 或 bar
//   color        - 图表系列颜色
// ============================================================================
const CUMULATIVE_METRICS = [
  {
    metric_key: 'cumulative_flow',
    metric_name: '累计流量',
    source_table: 't_sensor_data',
    source_field: 'field3',
    unit: 'L',
    enabled: true,
    mode: 'standalone',
    precision: 2,
    chart_type: 'bar',
    color: '#0ea5e9',
    aggregation: 'flow_integral',
  },
  {
    metric_key: 'cumulative_heat_time',
    metric_name: '累计加热时长',
    source_table: 't_behavior_data',
    source_field: 'field2',
    unit: 'min',
    enabled: true,
    mode: 'standalone',
    precision: 2,
    chart_type: 'line',
    color: '#f59e0b',
    aggregation: 'on_duration',
  },
  {
    metric_key: 'cumulative_pump_time',
    metric_name: '累计水泵运行时长',
    source_table: 't_behavior_data',
    source_field: 'field1',
    unit: 'min',
    enabled: true,
    mode: 'standalone',
    precision: 2,
    chart_type: 'line',
    color: '#10b981',
    aggregation: 'on_duration',
  },
]

// ============================================================================
// 滑动窗口指标：用 MySQL LAG + 窗口函数实时计算滑动平均 / 波动幅度 / 变化率。
//   aggregation - avg(滑动平均) | volatility(MAX-MIN 波动) | rate(相邻两点变化率)
//   window_size - 滑动窗口行数（rate 类型固定为 2 行差值）
//   其余字段含义同 CUMULATIVE_METRICS
// 注：当前这 6 条都 enabled=false（不参与计算），保留定义方便赛场按需打开。
// ============================================================================
const TIME_WINDOW_METRICS = [
  {
    metric_key: 'rolling_avg_temp',
    metric_name: '出水温度滑动平均(5点)',
    source_table: 't_sensor_data',
    source_field: 'field2',
    aggregation: 'avg',
    window_size: 5,
    unit: '℃',
    enabled: true,
    mode: 'standalone',
    chart_type: 'line',
    color: '#3b82f6',
  },
  {
    metric_key: 'rolling_avg_flow',
    metric_name: '流量滑动平均(5点)',
    source_table: 't_sensor_data',
    source_field: 'field3',
    aggregation: 'avg',
    window_size: 5,
    unit: 'L/min',
    enabled: true,
    mode: 'standalone',
    chart_type: 'line',
    color: '#0ea5e9',
  },
  {
    metric_key: 'flow_volatility',
    metric_name: '流量波动幅度(10点)',
    source_table: 't_sensor_data',
    source_field: 'field3',
    aggregation: 'volatility',
    window_size: 10,
    unit: 'L/min',
    enabled: true,
    mode: 'standalone',
    chart_type: 'bar',
    color: '#f59e0b',
  },
  {
    metric_key: 'pressure_pulsation',
    metric_name: '压力脉动(20点)',
    source_table: 't_sensor_data',
    source_field: 'field4',
    aggregation: 'volatility',
    window_size: 20,
    unit: 'kPa',
    enabled: true,
    mode: 'standalone',
    chart_type: 'bar',
    color: '#ef4444',
  },
  {
    metric_key: 'temp_rising_rate',
    metric_name: '升温速率',
    source_table: 't_sensor_data',
    source_field: 'field2',
    aggregation: 'rate',
    window_size: 2,
    unit: '℃/次',
    enabled: true,
    mode: 'standalone',
    chart_type: 'line',
    color: '#f97316',
  },
  {
    metric_key: 'flow_decay_rate',
    metric_name: '流量衰减率',
    source_table: 't_sensor_data',
    source_field: 'field3',
    aggregation: 'rate',
    window_size: 2,
    unit: 'L/min/次',
    enabled: true,
    mode: 'standalone',
    chart_type: 'line',
    color: '#8b5cf6',
  },
]

// ============================================================================
// 首页计算数据：每个指标可用布尔值独立控制是否在首页展示；enabled 是总开关。
//   resistanceK            - 系统阻力系数 K = 泵出口压力(kPa) / 流量(L/s)²
//   pressureDropRate       - 压力陡降速率，kPa/s
//   tempChangeRate         - 温度变化率 dT/dt，℃/min
//   heatExchangeEfficiency - 换热效率 η = (ρ·Cp·Q·max(0,出水−进水)) / P_额定 ×100%
//   eerHeatBalance         - 热平衡：P_额定 = 水带走的热功率 + 未被带走部分
//   heatingEfficiency      - 加热效率 = 实际升温ΔT ÷ 理论升温ΔT ×100%
//   heatingRate            - 加热速度 = 持续加热中出水温度升温速率，℃/min
//   flowPressureCurve      - 流量-压力特性曲线拟合（线性回归斜率）
//   cumulativeFlow         - 累计流量
//   cumulativeFlowMode     - 'all'=全表累计（重启不归零）；'session'=本次启动以来内存累加
//   averageVelocity        - 平均流速 v = Q / A
//   waterLevel             - 液位（基于两水箱初始水量与累计流量）
// 计算参数（现场介质不是纯水时改 waterDensity / waterSpecificHeat）：
//   heaterRatedPower(W) —— 固定 200W 加热器，换热效率/热平衡/加热效率依赖此值
//   pipeAreaCm2(水管横截面积)、initialWaterTank1/2(两水箱初始水量 L)、
//   tankAreaCm2(水箱横截面积)、waterDensity(kg/m³)、waterSpecificHeat(J/(kg·℃))
// ============================================================================
const COMPUTED_METRICS = {
  enabled: true,
  resistanceK: true,
  pressureDropRate: true,
  tempChangeRate: true,
  heatExchangeEfficiency: true,
  eerHeatBalance: true,
  heatingEfficiency: true,
  heatingRate: true,
  flowPressureCurve: true,
  cumulativeFlow: true,
  cumulativeFlowMode: 'all',
  averageVelocity: true,
  waterLevel: true,
  averageTempChart: true,
  averageVelocityChart: true,
  heaterRatedPower: 200,
  pipeAreaCm2: 1.131,
  initialWaterTank1: 1.1,
  initialWaterTank2: 1.4,
  tankAreaCm2: 100,
  waterDensity: 1000,
  waterSpecificHeat: 4200,
}

module.exports = { CUMULATIVE_METRICS, TIME_WINDOW_METRICS, COMPUTED_METRICS }
