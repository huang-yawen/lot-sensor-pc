/**
 * 【文件职责】"公式计算"类配置的唯一汇总处。三类指标：
 *   CUMULATIVE_METRICS   —— 累计统计（累计流量、累计加热/水泵运行时长）
 *   TIME_WINDOW_METRICS  —— 滑动窗口统计（滑动平均 / 波动幅度 / 相邻变化量）
 *   COMPUTED_METRICS     —— 首页「需要计算的数据」各工程指标 + 各类计算参数
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 每条指标 enabled=false 就只保留配置、不参与计算。
 * 【谁在读】实现文件见下方对照表最后一列。
 *
 * ============================================================================
 * 【公式总对照表】哪个页面 → 哪张图/哪块 → 用什么公式 → 由谁实现
 * ============================================================================
 *
 * 【① 首页 Dashboard.vue →「需要计算的数据」卡片区】
 *   接口：GET /api/computed-metrics（路由内联在 routes/sensorRoutes.js → 调 computedMetrics.getLatest()）
 *   实现：service/computedMetrics/computedMetrics.js（实时内存计算，每条 MQTT 消息更新一次）
 *   开关：下面 COMPUTED_METRICS 里的同名布尔项
 *   | 卡片 | 公式 | 单位 | 开关 |
 *   |---|---|---|---|
 *   | 平均温度         | (T1 + T2) / 2                                   | ℃          | （恒开） |
 *   | 系统阻力系数 K   | P泵出口 / Q²（Q 用 L/s）                        | kPa/(L/s)² | resistanceK |
 *   | 压力陡降速率     | dP / dt                                         | kPa/s      | pressureDropRate |
 *   | 温度变化率       | (现在读数 − 1 分钟前读数) ÷ 实际间隔(分钟)      | ℃/min      | tempChangeRate |
 *   | 换热效率 η       | ρ·Cp·Q·max(0, T2−T1) ÷ P额定 × 100%             | %          | heatExchangeEfficiency |
 *   | 热平衡           | 水带走的热功率 W  /  未被带走的部分 W            | W          | eerHeatBalance |
 *   | 加热效率         | 实际升温(T2−T1) ÷ 理论升温[P额定/(ρ·Cp·Q)] ×100% | %          | heatingEfficiency |
 *   | 加热速度         | ΔT2 / Δt（只在"持续加热中"算）                  | ℃/min      | heatingRate |
 *   | 流量-压力特性曲线 | 线性回归斜率 dP/dQ                              | kPa/(L/min)| flowPressureCurve |
 *   | 累计流量         | Σ( Q/60 × min(Δt,10s) ) 或数据库全表积分         | L          | cumulativeFlow |
 *   | 平均流速         | Q / A（A = 管道横截面积 pipeAreaCm2）            | m/s        | averageVelocity |
 *   | 液位             | 由两水箱初始水量估算（见代码内说明，非实测）     | cm         | waterLevel |
 *   首页还有「累计运行时长」卡片，走 GET /api/switch-duration，
 *   实现 service/switchDuration/，开关 appSettings.js 的 SWITCH_DURATION_DISPLAY.enabled。
 *
 * 【② 历史图表页 HistoryCharts.vue】
 *   顶部时间范围选择器 → 各接口带 range / startTime / endTime / limit，
 *   统一由 utils/timeRange.js 的 resolveTimeRange() 解析、calcBucketSeconds() 分桶降采样。
 *   图/表按时间分桶聚合，桶宽随所选范围自适应（pageLimit 见 appSettings.HISTORY_CHARTS.pointLimit）。
 *   | 图表 / 表格 | 接口 | 公式实现文件 |
 *   |---|---|---|
 *   | 累计统计、累计流量、累计运行时长 | GET /api/cumulative | service/cumulative/cumulativeService.js |
 *   | 滑动统计（每条指标一张卡）       | GET /api/time-window | service/timeWindow/timeWindowService.js |
 *   | 平均温度与平均流速（秒级）       | GET /api/average-chart | service/computedMetrics/averageChartQuery.js |
 *   | 分钟平均温度与平均流速           | 同上，取返回里的 minuteRows | 同上（固定 60 秒分桶） |
 *   | 温度曲线（进水/出水）            | 同上，复用返回里的 rows | 同上 |
 *   | 瞬时流量与瞬时压力               | 同上，复用返回里的 rows | 同上 |
 *   | 温度-流量相关性（散点）          | GET /api/temp-flow-scatter | service/computedMetrics/scatterChartQuery.js |
 *   | PID 跟踪对比                    | GET /api/average-chart（rows + targetTemp） | 同上 |
 *   | 恒流速跟踪对比                   | GET /api/average-chart（averageVelocity + targetVelocity） | 同上 |
 *   | 设备状态时间线（阶梯图）         | GET /api/device-state-trend | service/computedMetrics/deviceStateQuery.js |
 *   | PID 周期加热开关 / PID 占空比    | GET /api/pid-heating-cycles | service/pidHeating/pidHeatingCycleHistory.js |
 *   | 加热能耗分析（瞬时功率/累计电耗与换热/比能耗） | GET /api/heater-energy | service/computedMetrics/heaterEnergyQuery.js |
 *   | 加热效率与加热速度               | GET /api/heating-analysis | service/computedMetrics/heatingAnalysisQuery.js |
 *   | 换热效率、温度变化率（明细表）   | 同上 | 同上 |
 *   | 自定义公式指标                   | GET /api/derived-metrics/history | service/derivedMetric/ |
 *   | 计算指标历史明细表（顶部 Tab）   | 上面各接口返回的 rows 汇总，无独立接口 | — |
 *   显隐开关：config/appSettings.js 的 HISTORY_CHARTS（showXxx）。
 *
 * 【③ 传感器/行为表格页（SensorRealtime · SensorHistory · BehaviorRealtime · BehaviorHistory）】
 *   派生列直接拼进表格查询的 SELECT，不单独发请求：
 *   实现：service/tableData/getTableData.js
 *     · CUMULATIVE_METRICS 里 mode = 'inline' / 'both' → 表格多一列累计值
 *     · TIME_WINDOW_METRICS 里 mode = 'inline' / 'both' → 表格多一列滑动值
 *     · t_derived_metric 里 show_history / show_realtime 为真的 → 自定义公式列
 *   注意：CUMULATIVE_METRICS / TIME_WINDOW_METRICS 的 mode 决定"只进首页 / 只进历史图表页 /
 *   两处都进"；而"是否合进表格"是另一回事——首页计算板块用 mode 过滤，表格内联也用 mode 过滤。
 * ============================================================================
 */

// ============================================================================
// ① 累计统计指标 CUMULATIVE_METRICS
//    【页面/图表】历史图表页 →「累计统计」合并图、「累计流量」独立图、「累计运行时长」独立图；
//                 若把某条的 mode 改成 'inline' / 'both'，还会在传感器/行为表格里内联成一列。
//    【接口】GET /api/cumulative
//    【实现】service/cumulative/cumulativeService.js
//    【公式】MySQL 窗口函数 SUM/AVG OVER(ORDER BY c_time ASC, id ASC ROWS UNBOUNDED PRECEDING)，
//            从范围内第一条数据开始逐点滚动累加，每个点给出"到该时刻为止的累计值"。
//            两种特殊聚合不走窗口函数，见下面 aggregation 说明。
//    【快照加速】cumulative_flow / on_duration 两类会额外落 t_cumulative_snapshot 表
//            （service/cumulative/cumulativeSnapshotService.js），查询优先读快照；
//            没跑过回填脚本时自动回退到实时窗口函数计算，页面不会空白。
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
    // 【页面】历史图表页 →「累计流量」独立图（柱状）
    // 【公式】flow_integral：本条增量 = max(流量,0)/60 × min(与上一条读数的秒差, 10s)，单位 L，
    //         再逐行滚动累加。源字段 field3 是"每分钟速率量 L/min"，不能直接 SUM。
    // 【为什么单列】累计流量和"运行时长"单位的指标混在一张图上会双轴打架，前端把它单独成图。
    // 【表格内联】mode=standalone，所以传感器表格里不会出现这一列；要内联改成 inline/both。
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
    // 【页面】历史图表页 →「累计运行时长」独立图（跟水泵时长同图对比）
    // 【公式】on_duration：字段值为 '1'（开启）期间实际经过的时间，单位 min。
    //         用 LAG() 取每行与上一行的秒差，超过 MAX_GAP_SEC(10s) 的部分不计入
    //         （避免设备离线期间被当成"一直在加热"）。源表 t_behavior_data.field2 = 加热开关。
    // 【表格内联】mode=standalone，表格里不出现。
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
    // 【页面】历史图表页 →「累计运行时长」独立图（跟加热时长同图对比）
    // 【公式】on_duration：同"累计加热时长"，源字段换成 t_behavior_data.field1 = 水泵开关。
    // 【表格内联】同上，mode=standalone。
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
// ② 滑动窗口指标 TIME_WINDOW_METRICS
//    【页面/图表】历史图表页 →「滑动统计」一节（每条指标一张独立卡片）。
//                 若把某条 mode 改成 'inline' / 'both'，还会在传感器/行为表格里内联成一列。
//                 特例：rolling_avg_temp 会被历史图表页的「温度曲线」图当作虚线参考线叠加显示
//                 （HistoryCharts.vue 的 renderTempChart，按 c_time 精确匹配对齐到同一根 x 轴）。
//    【接口】GET /api/time-window
//    【实现】service/timeWindow/timeWindowService.js
//    【公式】MySQL 窗口函数（ROWS n PRECEDING，窗口包含当前行）：
//              avg        滑动平均   = AVG(值) OVER (... ROWS (window_size-1) PRECEDING)
//              volatility 波动幅度   = MAX(值) - MIN(值) OVER (同窗口)  → 抖动幅度，疑似水锤/湍流
//              rate       相邻变化量 = 值 − LAG(值, 1)                 → 这一步比上一步变了多少
//    【重要提醒】rate 是"相邻两个采样点"的差值，单位是"每采样次"（℃/次、L/min/次）。
//              设备 1 秒上报一次时它等于"每秒变化量"，跟"每分钟变化率"差 60 倍，不要混用。
//    【谁在用】历史图表页 + 表格内联 + service/alarm（阈值告警可直接引用滑动指标）。
//   aggregation - avg(滑动平均) | volatility(MAX-MIN 波动) | rate(相邻两点变化率)
//   window_size - 滑动窗口行数（rate 类型固定为 2 行差值）
//   其余字段含义同 CUMULATIVE_METRICS
// 注：当前这 6 条都 enabled=true（参与计算），保留定义方便赛场按需关闭。
// ============================================================================
const TIME_WINDOW_METRICS = [
  {
    // 【页面】历史图表页「滑动统计」卡片 + 「温度曲线」图上的绿色虚线系列
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
    // 【页面】历史图表页「滑动统计」卡片（看流量是否平稳）
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
    // 【页面】历史图表页「滑动统计」卡片（柱状：10 点内流量的最大-最小，看抖动幅度）
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
    // 【页面】历史图表页「滑动统计」卡片（柱状：20 点内压力的最大-最小，看脉动/水锤）
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
    // 【页面】历史图表页「滑动统计」卡片
    // 【公式】rate：本行出水温度 − 上一行出水温度，单位 ℃/次（≠ ℃/min，见上方提醒）
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
    // 【页面】历史图表页「滑动统计」卡片
    // 【公式】rate：本行流量 − 上一行流量，单位 L/min/次（看滤网堵塞/水位下降导致的流量衰减）
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
// ③ 首页计算数据 COMPUTED_METRICS
//    【页面】首页 Dashboard.vue →「需要计算的数据」卡片区（每项一个卡片，按下面的布尔项独立显隐）。
//    【接口】GET /api/computed-metrics（routes/sensorRoutes.js 里的内联路由）
//    【实现】service/computedMetrics/computedMetrics.js —— 每条 MQTT 消息调 compute() 更新内存，
//            接口调用时 getLatest() 直接取内存最新值；没有实时数据时先 refreshFromDB() 回放兜底。
//    【公式逐条】见 computedMetrics.js 里各"---- N. 指标 ----"小节，这里只列开关与单位。
//    【物理参数】enabled 之后的数值项不是开关，而是各公式要用的常量：
//              pipeAreaCm2 填 0    → 平均流速、恒流速控制都算不出来；
//              heaterRatedPower≤0  → 换热效率 / 热平衡 / 加热效率三项都算不出来；
//              pipeAreaCm2 必须与真实管内径对应（内径 d 时 A = π(d/2)²，12mm → 1.131cm²）。
//    【开关一览】
//   enabled                - 总开关：false 时首页整块「需要计算的数据」都不显示
//   resistanceK            - 系统阻力系数 K = 泵出口压力(kPa) / 流量(L/s)²           单位 kPa/(L/s)²
//   pressureDropRate       - 压力陡降速率 dP/dt（吸入空气紧急停机判定）                单位 kPa/s
//   tempChangeRate         - 温度变化率 = (现在读数 − 1 分钟前读数) ÷ 实际间隔          单位 ℃/min
//   heatExchangeEfficiency - 换热效率 η = (ρ·Cp·Q·max(0,出水−进水)) / P_额定 × 100%    单位 %
//   eerHeatBalance         - 热平衡：P_额定 = 水带走的热功率 + 未被带走部分               单位 W
//   heatingEfficiency      - 加热效率 = 实际升温ΔT ÷ 理论升温ΔT × 100%                 单位 %
//   heatingRate            - 加热速度 = 持续加热中出水温度的升温速率                    单位 ℃/min
//   flowPressureCurve      - 流量-压力特性曲线拟合（线性回归斜率 dP/dQ）               单位 kPa/(L/min)
//   cumulativeFlow         - 累计流量                                                单位 L
//   cumulativeFlowMode     - 'all'  = 按 flow_integral 从数据库现算总量（增量算法跟历史图表页
//                                     完全一致，但范围是"库里第一条数据至今"的全量总量，
//                                     不是所选时间范围；后端重启不归零）；
//                            'session' = 不覆盖，直接用 computedMetrics 的内存累加值
//                                     （本次后端启动以来，重启归零，跟液位反推共用同一个累加器）
//   averageVelocity        - 平均流速 v = Q / A（A = pipeAreaCm2）                    单位 m/s
//   waterLevel             - 液位（由两水箱初始水量估算，不是实测值）                  单位 cm
//   averageTempChart       - 首页趋势图里"平均温度"那条线是否显示
//   averageVelocityChart   - 首页趋势图里"平均流速"那条线是否显示
// 计算参数（现场介质不是纯水时改 waterDensity / waterSpecificHeat）：
//   heaterRatedPower(W) —— 加热器额定功率，换热效率 / 热平衡 / 加热效率依赖此值（当前 200W）
//   pipeAreaCm2(水管横截面积 cm²)、initialWaterTank1/2(两水箱初始水量 L)、
//   tankAreaCm2(水箱横截面积 cm²)、waterDensity(kg/m³)、waterSpecificHeat(J/(kg·℃))
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
