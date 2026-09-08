<!--
 * 【文件职责】历史图表页面：累计统计、滑动统计、平均温度与平均流速，
 * 从首页搬过来，统一接一个时间范围选择器（5分钟~24小时+自定义），
 * 选择不同范围时对应重新查询数据库，保证图表数据跟所选范围一致。
 * 【配置中心关联】图表元数据（名称/单位/颜色/图表类型）读取 CUMULATIVE_METRICS、
 * TIME_WINDOW_METRICS、COMPUTED_METRICS；只展示 mode 为 standalone 或 both 的指标
 * （inline 模式是嵌入其他历史表格的列，不在本页展示）。
 * -->
<template>
  <div class="history-charts-page" v-loading="loading">
    <section class="range-panel">
      <el-radio-group v-model="rangeKey" @change="handlePresetChange">
        <el-radio-button v-for="opt in RANGE_OPTIONS" :key="opt.value" :label="opt.value">{{ opt.label }}</el-radio-button>
      </el-radio-group>
      <el-date-picker
        v-if="rangeKey === 'custom'"
        v-model="customRange"
        type="datetimerange"
        start-placeholder="开始时间"
        end-placeholder="结束时间"
        format="YYYY-MM-DD HH:mm:ss"
        value-format="YYYY-MM-DD HH:mm:ss"
        :clearable="false"
        @change="loadAll"
      />
      <el-button type="primary" :loading="loading" @click="loadAll">刷新</el-button>
    </section>

    <!-- ==================== 累计统计（合并成一张图，可切换柱状/折线） ==================== -->
    <section v-if="cumulativeEntries.length > 0" class="chart-section">
      <h2 class="section-title">累计统计</h2>
      <div class="chart-card chart-card-wide">
        <div ref="cumulativeChartRef" class="chart-el chart-el-tall"></div>
      </div>
    </section>

    <!-- ==================== 滑动统计（每个指标独立一张卡片） ==================== -->
    <section v-if="timeWindowEntries.length > 0" class="chart-section">
      <h2 class="section-title">滑动统计</h2>
      <div class="chart-grid" :style="{ gridTemplateColumns: `repeat(${Math.min(timeWindowEntries.length, 2)}, 1fr)` }">
        <div v-for="entry in timeWindowEntries" :key="entry.key" class="chart-card">
          <div class="chart-card-header">
            <h3>{{ entry.config.metric_name }}</h3>
            <el-tag size="small" :type="entry.config.aggregation === 'avg' ? 'success' : entry.config.aggregation === 'volatility' ? 'warning' : 'info'">
              {{ entry.config.aggregation === 'avg' ? '平滑' : entry.config.aggregation === 'volatility' ? '波动' : '变化率' }}
            </el-tag>
            <el-tag size="small">{{ entry.config.unit }}</el-tag>
          </div>
          <div class="chart-el-wrapper">
            <div :ref="(el) => setChartRef(entry.key, el)" class="chart-el"></div>
          </div>
        </div>
      </div>
    </section>

    <!-- ==================== 平均温度 / 平均流速（合并成一张图） ==================== -->
    <section v-if="showAverageChart" class="chart-section">
      <h2 class="section-title">平均温度与平均流速</h2>
      <div class="chart-card chart-card-wide">
        <div ref="averageChartRef" class="chart-el chart-el-tall"></div>
      </div>
    </section>

    <!-- ==================== 温度-流量相关性（散点图） ==================== -->
    <section v-if="showTempFlowScatter" class="chart-section">
      <h2 class="section-title">温度-流量相关性</h2>
      <div class="chart-card chart-card-wide">
        <div ref="scatterChartRef" class="chart-el chart-el-tall"></div>
      </div>
    </section>

    <!-- ==================== 温度曲线（进水温度 / 出水温度） ==================== -->
    <section v-if="showTempChart" class="chart-section">
      <h2 class="section-title">温度曲线</h2>
      <div class="chart-card chart-card-wide">
        <div ref="tempChartRef" class="chart-el chart-el-tall"></div>
      </div>
    </section>

    <!-- ==================== 瞬时流量与瞬时压力（双轴） ==================== -->
    <section v-if="showFlowPressureChart" class="chart-section">
      <h2 class="section-title">瞬时流量与瞬时压力</h2>
      <div class="chart-card chart-card-wide">
        <div ref="flowPressureChartRef" class="chart-el chart-el-tall"></div>
      </div>
    </section>

    <!-- ==================== PID跟踪对比（目标温度参考线 + 出水温度实际值） ==================== -->
    <section v-if="showPidTrackingChart" class="chart-section">
      <h2 class="section-title">
        PID跟踪对比
        <span class="target-temp-badge">当前目标温度 {{ targetTemp }}℃</span>
      </h2>
      <div class="chart-card chart-card-wide">
        <div ref="pidTrackingChartRef" class="chart-el chart-el-tall"></div>
      </div>
    </section>

    <!-- ==================== 恒流速跟踪对比（目标流速参考线 + 平均流速实际值） ==================== -->
    <section v-if="showPumpVelocityTrackingChart" class="chart-section">
      <h2 class="section-title">
        恒流速跟踪对比
        <span class="target-temp-badge">当前目标流速 {{ targetVelocity }} m/s</span>
      </h2>
      <div class="chart-card chart-card-wide">
        <div ref="pumpVelocityTrackingChartRef" class="chart-el chart-el-tall"></div>
      </div>
    </section>

    <!-- ==================== 加热能耗分析（瞬时功率 / 累计电耗与换热量 / 单位流量能耗） ==================== -->
    <!-- 三张图各自独立开关判断（有数据才画），整节由 showHeaterEnergyChart 一个总开关控制，
         跟"PID跟踪对比"/"恒流速跟踪对比"一样，不做成逐条更细的开关，避免赛场配置项爆炸。 -->
    <section v-if="showHeaterEnergyChart" class="chart-section">
      <h2 class="section-title">加热能耗分析</h2>
      <div class="chart-grid" style="grid-template-columns: repeat(3, 1fr);">
        <div class="chart-card">
          <div class="chart-card-header"><h3>瞬时加热功率</h3></div>
          <div ref="actualPowerChartRef" class="chart-el"></div>
        </div>
        <div class="chart-card">
          <div class="chart-card-header"><h3>累计耗电量 / 累计换热量</h3></div>
          <div ref="heatEnergyChartRef" class="chart-el"></div>
        </div>
        <div class="chart-card">
          <div class="chart-card-header"><h3>单位流量能耗（比能耗 SEC）</h3></div>
          <div ref="secChartRef" class="chart-el"></div>
        </div>
      </div>
    </section>

    <!-- ==================== 加热效率与加热速度 ==================== -->
    <section v-if="showHeatingAnalysisChart" class="chart-section">
      <h2 class="section-title">加热效率与加热速度</h2>
      <div class="chart-grid" style="grid-template-columns: repeat(2, 1fr);">
        <div class="chart-card">
          <div class="chart-card-header"><h3>加热效率（实际升温 / 理论升温）</h3></div>
          <div ref="heatingEfficiencyChartRef" class="chart-el"></div>
        </div>
        <div class="chart-card">
          <div class="chart-card-header"><h3>加热速度（加热时出水升温速率）</h3></div>
          <div ref="heatingRateChartRef" class="chart-el"></div>
        </div>
      </div>
    </section>

    <!-- ==================== 设备状态时间线（水泵/加热开关阶梯图） ==================== -->
    <section v-if="showDeviceStateChart" class="chart-section">
      <h2 class="section-title">设备状态时间线</h2>
      <div class="chart-card chart-card-wide">
        <div ref="deviceStateChartRef" class="chart-el chart-el-tall"></div>
      </div>
    </section>

    <!-- ==================== PID周期加热开关（按PWM周期边界精确复原开关阶梯波形） ==================== -->
    <section v-if="showPidCycleChart" class="chart-section">
      <h2 class="section-title">PID周期加热开关</h2>
      <div class="chart-card chart-card-wide">
        <div ref="pidCycleChartRef" class="chart-el chart-el-tall"></div>
      </div>
    </section>

    <!-- ==================== 累计流量（从累计统计里单独摘出来，自己一张图） ==================== -->
    <section v-if="cumulativeFlowEntry" class="chart-section">
      <h2 class="section-title">累计流量</h2>
      <div class="chart-card chart-card-wide">
        <div ref="cumulativeFlowChartRef" class="chart-el chart-el-tall"></div>
      </div>
    </section>

    <!-- ==================== 累计运行时长（加热+水泵合并对比，自己一张图） ==================== -->
    <section v-if="switchDurationEntries.length > 0" class="chart-section">
      <h2 class="section-title">累计运行时长</h2>
      <div class="chart-card chart-card-wide">
        <div ref="switchDurationChartRef" class="chart-el chart-el-tall"></div>
      </div>
    </section>

    <!-- ==================== 自定义公式指标（每条一张卡片） ==================== -->
    <section v-if="derivedMetricEntries.length > 0" class="chart-section">
      <h2 class="section-title">自定义公式指标</h2>
      <div class="chart-grid" :style="{ gridTemplateColumns: `repeat(${Math.min(derivedMetricEntries.length, 2)}, 1fr)` }">
        <div v-for="entry in derivedMetricEntries" :key="entry.key" class="chart-card">
          <div class="chart-card-header">
            <h3>{{ entry.config.metric_name }}</h3>
            <el-tag size="small">{{ entry.config.unit }}</el-tag>
          </div>
          <div class="chart-el-wrapper">
            <div :ref="(el) => setDerivedChartRef(entry.key, el)" class="chart-el"></div>
          </div>
        </div>
      </div>
    </section>

    <el-empty
      v-if="!loading && !cumulativeEntries.length && !timeWindowEntries.length && !showAverageChart && !showTempFlowScatter && !showTempChart && !showFlowPressureChart && !showPidTrackingChart && !showDeviceStateChart && !showHeaterEnergyChart && !showHeatingAnalysisChart && !cumulativeFlowEntry && !switchDurationEntries.length && !derivedMetricEntries.length"
      description="所选时间范围内暂无数据，或配置中心还没启用相关图表"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import api from '@/api'
import * as echarts from 'echarts'
import { useSystemConfigStore } from '@/stores/useSystemConfigStore'

const RANGE_OPTIONS = [
  { value: '5m', label: '5分钟' },
  { value: '10m', label: '10分钟' },
  { value: '30m', label: '30分钟' },
  { value: '1h', label: '1小时' },
  { value: '3h', label: '3小时' },
  { value: '6h', label: '6小时' },
  { value: '24h', label: '24小时' },
  { value: 'custom', label: '自定义' },
]

const systemStore = useSystemConfigStore()
const loading = ref(false)
const rangeKey = ref('1h')
const customRange = ref([])

/** 历史图表页面显示控制（配置中心"累计与滑动统计"标签页维护），未加载完成前用默认值兜底。 */
const historyChartsConfig = computed(() => ({
  pointLimit: 300,
  showCumulative: true,
  showTimeWindow: true,
  showAverageChart: true,
  showTempChart: true,
  showFlowPressureChart: true,
  showPidTrackingChart: true,
  showDeviceStateChart: true,
  showPidHeatingCycleChart: true,
  showHeaterEnergyChart: true,
  showHeatingAnalysisChart: true,
  showDerivedMetricCharts: true,
  showTempFlowScatter: true,
  ...systemStore.config.HISTORY_CHARTS,
}))

const cumulativeData = ref({})
const timeWindowData = ref({})
const averageChartRows = ref([])
const targetTemp = ref(null)
const targetVelocity = ref(null)
const scatterRows = ref([])
const deviceStateRows = ref([])
const pidCycleRows = ref([])
const derivedMetricData = ref({})
const heaterEnergyRows = ref([])
const heatingEfficiencyRows = ref([])
const heatingRateRows = ref([])

/** 统一的时间轴格式化，十几张图共用。按 rows 数组引用缓存结果——loadAll() 每次拉数据
 * 都是整体换一个新数组，缓存会随新数据自然失效；同一批数据被多张图复用时直接命中缓存，
 * 省掉重复的 toLocaleString（十几张图 × 几百行 = 几千次，是进页面卡顿的一部分）。 */
const _formatTimesCache = new WeakMap()
function formatTimes(rows) {
  if (!Array.isArray(rows)) return []
  const cached = _formatTimesCache.get(rows)
  if (cached) return cached
  const out = rows.map((r) => (r.c_time
    ? new Date(r.c_time).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      })
    : ''))
  _formatTimesCache.set(rows, out)
  return out
}

// ---- 图表渲染错帧队列：进入页面时十几张 echarts 图如果在同一帧里全部 init + setOption，
// 主线程会一次性卡住几百毫秒。这里把每张图的渲染塞进队列，用 requestAnimationFrame 每帧
// 只跑到 ~8ms 就把控制权还给浏览器，图表在一两百毫秒内陆续画出来，但页面全程可交互、不卡。
const _renderQueue = []
let _renderRaf = 0
function _drainRenderQueue() {
  _renderRaf = 0
  const t0 = performance.now()
  while (_renderQueue.length && performance.now() - t0 < 8) {
    const fn = _renderQueue.shift()
    try { fn() } catch (err) { console.error('[HistoryCharts] 图表渲染失败:', err) }
  }
  if (_renderQueue.length) _renderRaf = requestAnimationFrame(_drainRenderQueue)
}
function queueRender(fn) {
  if (_renderQueue.indexOf(fn) === -1) _renderQueue.push(fn)
  if (!_renderRaf) _renderRaf = requestAnimationFrame(_drainRenderQueue)
}

function currentRangeParams() {
  const limit = historyChartsConfig.value.pointLimit
  if (rangeKey.value === 'custom') {
    const [start, end] = customRange.value || []
    return { range: 'custom', startTime: start || '', endTime: end || '', limit }
  }
  return { range: rangeKey.value, limit }
}

async function loadAll() {
  // 自定义模式下还没选完整起止时间时不查，避免打一个必然报错的请求。
  if (rangeKey.value === 'custom' && (!customRange.value || !customRange.value[0] || !customRange.value[1])) {
    return
  }
  loading.value = true
  try {
    const params = currentRangeParams()
    const [cumRes, twRes, avgRes, stateRes, pidCycleRes, derivedRes, scatterRes, energyRes, heatingRes] = await Promise.allSettled([
      api.get('/api/cumulative', { params }),
      api.get('/api/time-window', { params }),
      api.get('/api/average-chart', { params }),
      api.get('/api/device-state-trend', { params }),
      api.get('/api/pid-heating-cycles', { params }),
      api.get('/api/derived-metrics/history', { params }),
      api.get('/api/temp-flow-scatter', { params }),
      api.get('/api/heater-energy', { params }),
      api.get('/api/heating-analysis', { params }),
    ])
    cumulativeData.value = cumRes.status === 'fulfilled' ? (cumRes.value.data?.data || {}) : {}
    timeWindowData.value = twRes.status === 'fulfilled' ? (twRes.value.data?.data || {}) : {}
    averageChartRows.value = avgRes.status === 'fulfilled' ? (avgRes.value.data?.data?.rows || []) : []
    targetTemp.value = avgRes.status === 'fulfilled' ? (avgRes.value.data?.data?.targetTemp ?? null) : null
    targetVelocity.value = avgRes.status === 'fulfilled' ? (avgRes.value.data?.data?.targetVelocity ?? null) : null
    deviceStateRows.value = stateRes.status === 'fulfilled' ? (stateRes.value.data?.data || []) : []
    pidCycleRows.value = pidCycleRes.status === 'fulfilled' ? (pidCycleRes.value.data?.data || []) : []
    derivedMetricData.value = derivedRes.status === 'fulfilled' ? (derivedRes.value.data?.data || {}) : {}
    scatterRows.value = scatterRes.status === 'fulfilled' ? (scatterRes.value.data?.data || []) : []
    heaterEnergyRows.value = energyRes.status === 'fulfilled' ? (energyRes.value.data?.data?.rows || []) : []
    heatingEfficiencyRows.value = heatingRes.status === 'fulfilled' ? (heatingRes.value.data?.data?.efficiency || []) : []
    heatingRateRows.value = heatingRes.status === 'fulfilled' ? (heatingRes.value.data?.data?.rate || []) : []
  } finally {
    loading.value = false
  }
}

function handlePresetChange() {
  if (rangeKey.value !== 'custom') loadAll()
}

// ==================== 累计统计 ====================
const cumulativeMetricConfigs = computed(() => {
  const map = {}
  for (const m of systemStore.config.CUMULATIVE_METRICS || []) map[m.metric_key] = m
  return map
})

// 累计流量、累计加热时长、累计水泵运行时长单独成图（见下方"累计流量"/"累计运行时长"），
// 不再重复出现在这张合并图里；以后配置中心新增别的累计指标仍然走这里。
const SPLIT_OUT_CUMULATIVE_KEYS = new Set(['cumulative_flow', 'cumulative_heat_time', 'cumulative_pump_time'])

const cumulativeEntries = computed(() => {
  if (historyChartsConfig.value.showCumulative === false) return []
  const configs = cumulativeMetricConfigs.value
  return Object.entries(cumulativeData.value)
    .filter(([key, rows]) => {
      if (SPLIT_OUT_CUMULATIVE_KEYS.has(key)) return false
      const cfg = configs[key]
      return Array.isArray(rows) && rows.length > 0 && cfg && (cfg.mode === 'standalone' || cfg.mode === 'both')
    })
    .map(([key, rows]) => ({ key, config: configs[key], rows }))
})

const cumulativeChartRef = ref(null)
let cumulativeChartInstance = null

function renderCumulativeChart() {
  const entries = cumulativeEntries.value
  const el = cumulativeChartRef.value
  if (!entries.length || !el || el.offsetWidth === 0) {
    if (el) setTimeout(renderCumulativeChart, 50)
    return
  }
  if (cumulativeChartInstance) cumulativeChartInstance.dispose()
  const chart = echarts.init(el)
  cumulativeChartInstance = chart

  // 不同累计指标可能来自不同数据表，各自独立取数、行数和时间点不一定完全对齐；
  // 用数据点最多的一条作为共享横轴，其余按位置对齐，作为合理近似展示在同一张图里。
  const base = entries.reduce((a, b) => (b.rows.length > a.rows.length ? b : a))
  const times = formatTimes(base.rows)

  // 按单位分左右两根纵轴，最多两种单位；超出的并入右轴。
  const units = []
  const series = entries.map((entry) => {
    const unit = entry.config.unit || ''
    let axisIndex = units.indexOf(unit)
    if (axisIndex === -1) {
      axisIndex = units.length
      units.push(unit)
    }
    return {
      name: entry.config.metric_name,
      type: entry.config.chart_type || 'line',
      yAxisIndex: Math.min(axisIndex, 1),
      data: entry.rows.map((r) => r.cumulative),
      itemStyle: { color: entry.config.color || '#0ea5e9' },
      lineStyle: { color: entry.config.color || '#0ea5e9' },
      smooth: true,
    }
  })

  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: entries.map((e) => e.config.metric_name), top: 0 },
    toolbox: {
      feature: { magicType: { type: ['line', 'bar'] }, saveAsImage: { title: '下载图片' } },
      right: 10,
      top: 0,
    },
    grid: { left: 14, right: 60, top: 50, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: [
      { type: 'value', name: units[0] || '', nameTextStyle: { fontSize: 11 } },
      { type: 'value', name: units[1] || '', nameTextStyle: { fontSize: 11 } },
    ],
    series,
  }, true)
}

watch([cumulativeEntries, cumulativeChartRef], () => {
  nextTick(() => {
    if (cumulativeChartRef.value) queueRender(renderCumulativeChart)
  })
})

// ==================== 滑动统计 ====================
const timeWindowMetricConfigs = computed(() => {
  const map = {}
  for (const m of systemStore.config.TIME_WINDOW_METRICS || []) map[m.metric_key] = m
  return map
})

const timeWindowEntries = computed(() => {
  if (historyChartsConfig.value.showTimeWindow === false) return []
  const configs = timeWindowMetricConfigs.value
  return Object.entries(timeWindowData.value)
    .filter(([key, rows]) => {
      const cfg = configs[key]
      return Array.isArray(rows) && rows.length > 0 && cfg && (cfg.mode === 'standalone' || cfg.mode === 'both')
    })
    .map(([key, rows]) => ({ key, config: configs[key], rows }))
})

/** 存放每个滑动统计图表的 ECharts 实例 */
const chartInstances = {}
/** element refs 的 map */
const chartRefs = {}

function setChartRef(key, el) {
  if (el && !chartRefs[key]) {
    chartRefs[key] = el
    nextTick(() => queueRender(() => renderEntryChart(key)))
  }
}

function renderEntryChart(key) {
  const entry = timeWindowEntries.value.find((e) => e.key === key)
  if (!entry) return
  const el = chartRefs[key]
  if (!el || el.offsetWidth === 0) {
    setTimeout(() => renderEntryChart(key), 50)
    return
  }
  if (chartInstances[key]) chartInstances[key].dispose()
  const chart = echarts.init(el)
  chartInstances[key] = chart
  const rows = entry.rows
  const name = entry.config.metric_name
  const unit = entry.config.unit || ''
  const color = entry.config.color || '#0ea5e9'
  const type = entry.config.chart_type || 'line'
  const data = rows.map((r) => r.value)
  const times = formatTimes(rows)

  chart.setOption({
    tooltip: { trigger: 'axis' },
    toolbox: {
      feature: { magicType: { type: ['line', 'bar'] }, saveAsImage: { title: '下载图片' } },
      right: 10,
      top: 0,
    },
    grid: { left: 14, right: 60, top: 40, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', name: unit, nameTextStyle: { fontSize: 11 } },
    series: [{ name, type, data, itemStyle: { color }, lineStyle: { color }, smooth: true }],
  }, true)
}

watch(timeWindowEntries, () => {
  nextTick(() => {
    timeWindowEntries.value.forEach((e) => {
      if (chartRefs[e.key]) queueRender(() => renderEntryChart(e.key))
    })
  })
})

// ==================== 平均温度 / 平均流速 ====================
const showAverageChart = computed(() => {
  if (historyChartsConfig.value.showAverageChart === false) return false
  const flags = systemStore.config.COMPUTED_METRICS || {}
  return (flags.averageTempChart !== false || flags.averageVelocityChart !== false) && averageChartRows.value.length > 0
})

const averageChartRef = ref(null)
let averageChartInstance = null

function renderAverageChart() {
  const rows = averageChartRows.value
  const el = averageChartRef.value
  if (!rows.length || !el || el.offsetWidth === 0) {
    if (el) setTimeout(renderAverageChart, 50)
    return
  }
  if (averageChartInstance) averageChartInstance.dispose()
  const chart = echarts.init(el)
  averageChartInstance = chart

  const times = formatTimes(rows)
  const flags = systemStore.config.COMPUTED_METRICS || {}
  const seriesList = []
  if (flags.averageTempChart !== false) {
    seriesList.push({
      name: '平均温度', type: 'line', yAxisIndex: 0, smooth: true,
      data: rows.map((r) => r.averageTemp),
      itemStyle: { color: '#3b82f6' }, lineStyle: { color: '#3b82f6' },
    })
  }
  if (flags.averageVelocityChart !== false) {
    seriesList.push({
      name: '平均流速', type: 'line', yAxisIndex: 1, smooth: true,
      data: rows.map((r) => r.averageVelocity),
      itemStyle: { color: '#10b981' }, lineStyle: { color: '#10b981' },
    })
  }

  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: seriesList.map((s) => s.name), top: 0 },
    toolbox: {
      feature: { magicType: { type: ['line', 'bar'] }, saveAsImage: { title: '下载图片' } },
      right: 10,
      top: 0,
    },
    grid: { left: 14, right: 60, top: 50, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: [
      { type: 'value', name: '℃', nameTextStyle: { fontSize: 11 } },
      { type: 'value', name: 'm/s', nameTextStyle: { fontSize: 11 } },
    ],
    series: seriesList,
  }, true)
}

watch([averageChartRows, averageChartRef], () => {
  nextTick(() => {
    if (averageChartRef.value) queueRender(renderAverageChart)
  })
})

// ==================== 温度-流量相关性（散点图） ====================
const showTempFlowScatter = computed(() => {
  return historyChartsConfig.value.showTempFlowScatter !== false && scatterRows.value.length > 0
})

const scatterChartRef = ref(null)
let scatterChartInstance = null

function renderScatterChart() {
  const rows = scatterRows.value
  const el = scatterChartRef.value
  if (!rows.length || !el || el.offsetWidth === 0) {
    if (el) setTimeout(renderScatterChart, 50)
    return
  }
  if (scatterChartInstance) scatterChartInstance.dispose()
  const chart = echarts.init(el)
  scatterChartInstance = chart

  chart.setOption({
    tooltip: {
      trigger: 'item',
      formatter: (p) => `流量 ${p.value[0]} L/s<br/>温度 ${p.value[1]} ℃`,
    },
    toolbox: {
      feature: { saveAsImage: { title: '下载图片' } },
      right: 10,
      top: 0,
    },
    grid: { left: 50, right: 30, top: 40, bottom: 40 },
    xAxis: { type: 'value', name: '流量 (L/s)', nameTextStyle: { fontSize: 11 } },
    yAxis: { type: 'value', name: '温度 (℃)', nameTextStyle: { fontSize: 11 } },
    series: [{
      name: '温度-流量',
      type: 'scatter',
      symbolSize: 6,
      data: rows.map((r) => [r.flow, r.temp]),
      itemStyle: { color: '#8b5cf6', opacity: 0.6 },
    }],
  }, true)
}

watch([scatterRows, scatterChartRef], () => {
  nextTick(() => {
    if (scatterChartRef.value) queueRender(renderScatterChart)
  })
})

// ==================== 温度曲线（进水温度 / 出水温度） ====================
// 跟"平均温度与平均流速"共用同一批查询结果（averageChartRows 已经带了 temp1/temp2/flow/pressure），
// 不用再单独发一次请求。
const showTempChart = computed(() => {
  if (historyChartsConfig.value.showTempChart === false) return false
  return averageChartRows.value.some((r) => r.temp1 != null || r.temp2 != null)
})

const tempChartRef = ref(null)
let tempChartInstance = null

function renderTempChart() {
  const rows = averageChartRows.value
  const el = tempChartRef.value
  if (!rows.length || !el || el.offsetWidth === 0) {
    if (el) setTimeout(renderTempChart, 50)
    return
  }
  if (tempChartInstance) tempChartInstance.dispose()
  const chart = echarts.init(el)
  tempChartInstance = chart

  const times = formatTimes(rows)
  const series = [
    { name: '进水温度', type: 'line', smooth: true, data: rows.map((r) => r.temp1), itemStyle: { color: '#f97316' }, lineStyle: { color: '#f97316' } },
    { name: '出水温度', type: 'line', smooth: true, data: rows.map((r) => r.temp2), itemStyle: { color: '#3b82f6' }, lineStyle: { color: '#3b82f6' } },
  ]
  const legendData = ['进水温度', '出水温度']

  // 出水温度滑动平均（rolling_avg_temp）是独立一次时间窗口查询，不能假设它跟这里
  // 的 rows 行数、顺序一致——两边各自按等宽分桶降采样，桶内取到的具体那一行未必
  // 完全相同。按 c_time 精确字符串匹配对齐到同一根 x 轴上，两边都用 dateStrings:true
  // 的同一个连接池查出来，格式一致，能直接比较；对不上的点留空，用 connectNulls
  // 接起来，不会因为个别点缺失就断成好几截。
  const rollingAvgRows = timeWindowData.value?.rolling_avg_temp
  if (rollingAvgRows?.length) {
    const rollingAvgMap = new Map(rollingAvgRows.map((r) => [String(r.c_time), r.value]))
    series.push({
      name: '出水温度滑动平均',
      type: 'line',
      smooth: true,
      connectNulls: true,
      data: rows.map((r) => rollingAvgMap.get(String(r.c_time)) ?? null),
      itemStyle: { color: '#10b981' },
      lineStyle: { color: '#10b981', type: 'dashed' },
    })
    legendData.push('出水温度滑动平均')
  }

  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: legendData, top: 0 },
    toolbox: {
      feature: { magicType: { type: ['line', 'bar'] }, saveAsImage: { title: '下载图片' } },
      right: 10,
      top: 0,
    },
    grid: { left: 14, right: 60, top: 50, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', name: '℃', nameTextStyle: { fontSize: 11 } },
    series,
  }, true)
}

watch([averageChartRows, timeWindowData, tempChartRef], () => {
  nextTick(() => {
    if (tempChartRef.value) queueRender(renderTempChart)
  })
})

// ==================== 瞬时流量与瞬时压力（双轴，单位不同） ====================
const showFlowPressureChart = computed(() => {
  if (historyChartsConfig.value.showFlowPressureChart === false) return false
  return averageChartRows.value.some((r) => r.flow != null || r.pressure != null)
})

const flowPressureChartRef = ref(null)
let flowPressureChartInstance = null

function renderFlowPressureChart() {
  const rows = averageChartRows.value
  const el = flowPressureChartRef.value
  if (!rows.length || !el || el.offsetWidth === 0) {
    if (el) setTimeout(renderFlowPressureChart, 50)
    return
  }
  if (flowPressureChartInstance) flowPressureChartInstance.dispose()
  const chart = echarts.init(el)
  flowPressureChartInstance = chart

  const times = formatTimes(rows)
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['瞬时流量', '瞬时压力'], top: 0 },
    toolbox: {
      feature: { magicType: { type: ['line', 'bar'] }, saveAsImage: { title: '下载图片' } },
      right: 10,
      top: 0,
    },
    grid: { left: 14, right: 60, top: 50, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: [
      { type: 'value', name: '瞬时流量', nameTextStyle: { fontSize: 11 } },
      { type: 'value', name: '瞬时压力', nameTextStyle: { fontSize: 11 } },
    ],
    series: [
      { name: '瞬时流量', type: 'line', yAxisIndex: 0, smooth: true, data: rows.map((r) => r.flow), itemStyle: { color: '#0ea5e9' }, lineStyle: { color: '#0ea5e9' } },
      { name: '瞬时压力', type: 'line', yAxisIndex: 1, smooth: true, data: rows.map((r) => r.pressure), itemStyle: { color: '#a855f7' }, lineStyle: { color: '#a855f7' } },
    ],
  }, true)
}

watch([averageChartRows, flowPressureChartRef], () => {
  nextTick(() => {
    if (flowPressureChartRef.value) queueRender(renderFlowPressureChart)
  })
})

// ==================== PID跟踪对比（目标温度参考线 + 出水温度实际值） ====================
// 目标温度在指令中心只存"当前值"，没有历史，没法画成随时间变化的曲线，
// 只能取当前生效值画一条水平参考线（markLine），跟出水温度的实际曲线对照。
const showPidTrackingChart = computed(() => {
  if (historyChartsConfig.value.showPidTrackingChart === false) return false
  return targetTemp.value != null && averageChartRows.value.some((r) => r.temp2 != null)
})

const pidTrackingChartRef = ref(null)
let pidTrackingChartInstance = null

function renderPidTrackingChart() {
  const rows = averageChartRows.value
  const el = pidTrackingChartRef.value
  if (!rows.length || !el || el.offsetWidth === 0) {
    if (el) setTimeout(renderPidTrackingChart, 50)
    return
  }
  if (pidTrackingChartInstance) pidTrackingChartInstance.dispose()
  const chart = echarts.init(el)
  pidTrackingChartInstance = chart

  const times = formatTimes(rows)
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['出水温度'], top: 0 },
    toolbox: {
      feature: { magicType: { type: ['line', 'bar'] }, saveAsImage: { title: '下载图片' } },
      right: 10,
      top: 0,
    },
    grid: { left: 14, right: 60, top: 50, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', name: '℃', nameTextStyle: { fontSize: 11 } },
    series: [
      {
        name: '出水温度',
        type: 'line',
        smooth: true,
        data: rows.map((r) => r.temp2),
        itemStyle: { color: '#3b82f6' },
        lineStyle: { color: '#3b82f6' },
        markLine: {
          symbol: 'none',
          label: {
            formatter: '{c}℃',
            position: 'insideEndTop',
            fontSize: 13,
            fontWeight: 'bold',
            color: '#ef4444',
          },
          lineStyle: { color: '#ef4444', type: 'dashed', width: 2 },
          data: [{ yAxis: targetTemp.value }],
        },
      },
    ],
  }, true)
}

watch([averageChartRows, targetTemp, pidTrackingChartRef], () => {
  nextTick(() => {
    if (pidTrackingChartRef.value) queueRender(renderPidTrackingChart)
  })
})

// ==================== 恒流速跟踪对比（目标流速参考线 + 平均流速实际值） ====================
// 跟 PID 跟踪对比同一个套路：目标流速在指令中心只有"当前值"没有历史，画成水平参考线，
// 跟实际流速曲线对照，直接看出恒流速控制把流速稳在了什么位置、超调有多大。
// 实际值用的是 averageChartRows 里已经算好的 averageVelocity（v = Q / A），
// 跟恒流速控制模块判断用的是同一个公式和单位，两边对得上号。
const showPumpVelocityTrackingChart = computed(() => {
  if (historyChartsConfig.value.showPumpVelocityTrackingChart === false) return false
  return targetVelocity.value != null && averageChartRows.value.some((r) => r.averageVelocity != null)
})

const pumpVelocityTrackingChartRef = ref(null)
let pumpVelocityTrackingChartInstance = null

function renderPumpVelocityTrackingChart() {
  const rows = averageChartRows.value
  const el = pumpVelocityTrackingChartRef.value
  if (!rows.length || !el || el.offsetWidth === 0) {
    if (el) setTimeout(renderPumpVelocityTrackingChart, 50)
    return
  }
  if (pumpVelocityTrackingChartInstance) pumpVelocityTrackingChartInstance.dispose()
  const chart = echarts.init(el)
  pumpVelocityTrackingChartInstance = chart

  const times = formatTimes(rows)
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['平均流速'], top: 0 },
    toolbox: {
      feature: { magicType: { type: ['line', 'bar'] }, saveAsImage: { title: '下载图片' } },
      right: 10,
      top: 0,
    },
    grid: { left: 14, right: 60, top: 50, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', name: 'm/s', nameTextStyle: { fontSize: 11 } },
    series: [
      {
        name: '平均流速',
        type: 'line',
        smooth: true,
        data: rows.map((r) => r.averageVelocity),
        itemStyle: { color: '#0ea5e9' },
        lineStyle: { color: '#0ea5e9' },
        markLine: {
          symbol: 'none',
          label: {
            formatter: '{c} m/s',
            position: 'insideEndTop',
            fontSize: 13,
            fontWeight: 'bold',
            color: '#ef4444',
          },
          lineStyle: { color: '#ef4444', type: 'dashed', width: 2 },
          data: [{ yAxis: targetVelocity.value }],
        },
      },
    ],
  }, true)
}

watch([averageChartRows, targetVelocity, pumpVelocityTrackingChartRef], () => {
  nextTick(() => {
    if (pumpVelocityTrackingChartRef.value) queueRender(renderPumpVelocityTrackingChart)
  })
})

// ==================== 加热能耗分析（瞬时功率 / 累计电耗与换热量 / 单位流量能耗） ====================
// 数据来自独立接口 /api/heater-energy（heaterEnergyRows），不跟 averageChartRows 混用——
// 后端要联合 t_sensor_data（温度/流量）和 t_behavior_data（加热开关状态）两张表才能算出
// 这几个指标，是单独一次查询，具体公式见后端 heaterEnergyQuery.js 的详细注释。
// 三张图共用同一批行数据，只是各自取不同的列，所以只需要一个"有没有数据"的总开关；
// 后端在"加热额定功率没配置"时直接返回空数组（见 heaterEnergyQuery.js），所以这里
// 只需要判断 heaterEnergyRows 是否有数据，不用像 PID 跟踪对比那样额外判断目标值存在。
const showHeaterEnergyChart = computed(() => {
  if (historyChartsConfig.value.showHeaterEnergyChart === false) return false
  return heaterEnergyRows.value.length > 0
})

// ---- 瞬时加热功率（W）：单线图，直观看出加热器什么时候真的在通电、通了多久 ----
const actualPowerChartRef = ref(null)
let actualPowerChartInstance = null

function renderActualPowerChart() {
  const rows = heaterEnergyRows.value
  const el = actualPowerChartRef.value
  if (!rows.length || !el || el.offsetWidth === 0) {
    if (el) setTimeout(renderActualPowerChart, 50)
    return
  }
  if (actualPowerChartInstance) actualPowerChartInstance.dispose()
  const chart = echarts.init(el)
  actualPowerChartInstance = chart

  const times = formatTimes(rows)
  chart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 14, right: 20, top: 20, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', name: 'W', nameTextStyle: { fontSize: 11 } },
    series: [{
      name: '瞬时功率',
      type: 'line',
      // step: 'end' 画成阶梯线而不是 smooth 平滑曲线：加热器只有开/关两个状态，真实的
      // 功率变化就是"突然从 0 跳到额定功率、又突然跳回 0"，画成平滑曲线反而会制造出
      // "功率在缓慢爬升/下降"这种不存在的假象，阶梯线才如实反映通断的瞬间性。
      step: 'end',
      data: rows.map((r) => r.actualPower),
      itemStyle: { color: '#f59e0b' },
      lineStyle: { color: '#f59e0b' },
      areaStyle: { color: '#f59e0b', opacity: 0.12 },
    }],
  }, true)
}

watch([heaterEnergyRows, actualPowerChartRef], () => {
  nextTick(() => { if (actualPowerChartRef.value) queueRender(renderActualPowerChart) })
})

// ---- 累计耗电量 / 累计换热量（Wh，均只统计加热时段）：两条线画在同一张图，高度差
// 直观体现"花的电"和"传给水的热"之间的差距 =(1−η)×电耗，是换热效率 η 的可视化版本 ----
const heatEnergyChartRef = ref(null)
let heatEnergyChartInstance = null

function renderHeatEnergyChart() {
  const rows = heaterEnergyRows.value
  const el = heatEnergyChartRef.value
  if (!rows.length || !el || el.offsetWidth === 0) {
    if (el) setTimeout(renderHeatEnergyChart, 50)
    return
  }
  if (heatEnergyChartInstance) heatEnergyChartInstance.dispose()
  const chart = echarts.init(el)
  heatEnergyChartInstance = chart

  const times = formatTimes(rows)
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['累计耗电量', '累计换热量'], top: 0 },
    grid: { left: 14, right: 20, top: 40, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', name: 'Wh', nameTextStyle: { fontSize: 11 } },
    series: [
      {
        name: '累计耗电量',
        type: 'line',
        smooth: true,
        data: rows.map((r) => r.cumulativeElectric),
        itemStyle: { color: '#ef4444' },
        lineStyle: { color: '#ef4444' },
      },
      {
        name: '累计换热量',
        type: 'line',
        smooth: true,
        data: rows.map((r) => r.cumulativeHeatEnergy),
        itemStyle: { color: '#10b981' },
        lineStyle: { color: '#10b981' },
      },
    ],
  }, true)
}

watch([heaterEnergyRows, heatEnergyChartRef], () => {
  nextTick(() => { if (heatEnergyChartRef.value) queueRender(renderHeatEnergyChart) })
})

// ---- 单位流量能耗 SEC（Wh/L）= 加热期间累计电耗 ÷ 加热期间累计流量：每加热 1L 水
//      花了多少电（电耗/换热量/流量三个累计量都只统计加热时段，口径对称），越低越省电 ----
const secChartRef = ref(null)
let secChartInstance = null

function renderSecChart() {
  const rows = heaterEnergyRows.value
  const el = secChartRef.value
  if (!rows.length || !el || el.offsetWidth === 0) {
    if (el) setTimeout(renderSecChart, 50)
    return
  }
  if (secChartInstance) secChartInstance.dispose()
  const chart = echarts.init(el)
  secChartInstance = chart

  const times = formatTimes(rows)
  chart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 14, right: 20, top: 20, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', name: 'Wh/L', nameTextStyle: { fontSize: 11 } },
    series: [{
      name: '单位流量能耗',
      type: 'line',
      smooth: true,
      data: rows.map((r) => r.sec),
      itemStyle: { color: '#8b5cf6' },
      lineStyle: { color: '#8b5cf6' },
    }],
  }, true)
}

watch([heaterEnergyRows, secChartRef], () => {
  nextTick(() => { if (secChartRef.value) queueRender(renderSecChart) })
})

// ==================== 加热效率与加热速度 ====================
// 数据来自 /api/heating-analysis（heatingEfficiencyRows / heatingRateRows）。
// 加热效率 = 实际升温ΔT ÷ 理论升温ΔT ×100%（理论升温 = 加热额定功率全进水里能升多少度）；
// 加热速度 = 加热开启时出水温度的升温速率（℃/min）。公式见后端 heatingAnalysisQuery.js。
const showHeatingAnalysisChart = computed(() => {
  if (historyChartsConfig.value.showHeatingAnalysisChart === false) return false
  return heatingEfficiencyRows.value.length > 0 || heatingRateRows.value.length > 0
})

const heatingEfficiencyChartRef = ref(null)
let heatingEfficiencyChartInstance = null

function renderHeatingEfficiencyChart() {
  const rows = heatingEfficiencyRows.value
  const el = heatingEfficiencyChartRef.value
  if (!rows.length || !el || el.offsetWidth === 0) {
    if (el) setTimeout(renderHeatingEfficiencyChart, 50)
    return
  }
  if (heatingEfficiencyChartInstance) heatingEfficiencyChartInstance.dispose()
  const chart = echarts.init(el)
  heatingEfficiencyChartInstance = chart
  const times = formatTimes(rows)
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['实际升温', '理论升温', '加热效率'], top: 0 },
    grid: { left: 20, right: 40, top: 40, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: [
      { type: 'value', name: '℃', nameTextStyle: { fontSize: 11 } },
      { type: 'value', name: '%', nameTextStyle: { fontSize: 11 }, splitLine: { show: false } },
    ],
    series: [
      { name: '实际升温', type: 'line', smooth: true, data: rows.map((r) => r.actualRiseC), itemStyle: { color: '#10b981' }, lineStyle: { color: '#10b981' } },
      { name: '理论升温', type: 'line', smooth: true, data: rows.map((r) => r.theoreticalRiseC), itemStyle: { color: '#94a3b8' }, lineStyle: { color: '#94a3b8', type: 'dashed' } },
      { name: '加热效率', type: 'line', smooth: true, yAxisIndex: 1, data: rows.map((r) => r.efficiencyPct), itemStyle: { color: '#f59e0b' }, lineStyle: { color: '#f59e0b' } },
    ],
  }, true)
}

watch([heatingEfficiencyRows, heatingEfficiencyChartRef], () => {
  nextTick(() => { if (heatingEfficiencyChartRef.value) queueRender(renderHeatingEfficiencyChart) })
})

const heatingRateChartRef = ref(null)
let heatingRateChartInstance = null

function renderHeatingRateChart() {
  const rows = heatingRateRows.value
  const el = heatingRateChartRef.value
  if (!rows.length || !el || el.offsetWidth === 0) {
    if (el) setTimeout(renderHeatingRateChart, 50)
    return
  }
  if (heatingRateChartInstance) heatingRateChartInstance.dispose()
  const chart = echarts.init(el)
  heatingRateChartInstance = chart
  const times = formatTimes(rows)
  chart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 20, right: 20, top: 20, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', name: '℃/min', nameTextStyle: { fontSize: 11 } },
    series: [{
      name: '加热速度', type: 'line', smooth: true,
      data: rows.map((r) => r.heatingRate),
      itemStyle: { color: '#ef4444' }, lineStyle: { color: '#ef4444' },
      areaStyle: { color: '#ef4444', opacity: 0.1 },
    }],
  }, true)
}

watch([heatingRateRows, heatingRateChartRef], () => {
  nextTick(() => { if (heatingRateChartRef.value) queueRender(renderHeatingRateChart) })
})

// ==================== 设备状态时间线（水泵/加热开关阶梯图） ====================
const showDeviceStateChart = computed(() => {
  if (historyChartsConfig.value.showDeviceStateChart === false) return false
  return deviceStateRows.value.some((r) => r.pumpOn != null || r.heaterOn != null)
})

const deviceStateChartRef = ref(null)
let deviceStateChartInstance = null

function renderDeviceStateChart() {
  const rows = deviceStateRows.value
  const el = deviceStateChartRef.value
  if (!rows.length || !el || el.offsetWidth === 0) {
    if (el) setTimeout(renderDeviceStateChart, 50)
    return
  }
  if (deviceStateChartInstance) deviceStateChartInstance.dispose()
  const chart = echarts.init(el)
  deviceStateChartInstance = chart

  const times = formatTimes(rows)
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['水泵', '加热'], top: 0 },
    toolbox: {
      feature: { saveAsImage: { title: '下载图片' } },
      right: 10,
      top: 0,
    },
    grid: { left: 50, right: 30, top: 50, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: {
      type: 'value',
      min: 0,
      max: 1,
      interval: 1,
      axisLabel: { formatter: (v) => (v === 1 ? '开' : v === 0 ? '关' : '') },
    },
    series: [
      { name: '水泵', type: 'line', step: 'end', data: rows.map((r) => r.pumpOn), itemStyle: { color: '#0ea5e9' }, lineStyle: { color: '#0ea5e9', width: 2 } },
      { name: '加热', type: 'line', step: 'end', data: rows.map((r) => r.heaterOn), itemStyle: { color: '#f97316' }, lineStyle: { color: '#f97316', width: 2, type: 'dashed' } },
    ],
  }, true)
}

watch([deviceStateRows, deviceStateChartRef], () => {
  nextTick(() => {
    if (deviceStateChartRef.value) queueRender(renderDeviceStateChart)
  })
})

// ==================== PID周期加热开关（按PWM周期边界精确复原开关阶梯波形） ====================
// 跟"设备状态时间线"的区别：那张图是按设备行为上报的采样频率取样，这张图直接用
// pidHeating.js 落库的周期计划（周期起始时间 + 本周期加热应开启的时长）算出精确的
// 开-关两个时间点，横轴按 PID 自己的周期边界对齐，不受上报频率影响，更适合观察占空比。
const showPidCycleChart = computed(() => {
  if (historyChartsConfig.value.showPidHeatingCycleChart === false) return false
  return pidCycleRows.value.length > 0
})

// 每个周期两个点：周期起始时刻开始加热（1），加热满 on_duration_ms 后关闭（0）。
// 再补一个"最后一个周期窗口结束"的关闭点，让最后那一格的完整时长也能画出来。
const pidCyclePoints = computed(() => {
  const points = []
  const rows = pidCycleRows.value
  for (const row of rows) {
    const start = new Date(row.window_start).getTime()
    points.push({ time: start, value: 1 })
    points.push({ time: start + Number(row.on_duration_ms), value: 0 })
  }
  const last = rows[rows.length - 1]
  if (last && points.length) {
    const lastEnd = new Date(last.window_start).getTime() + Number(last.window_ms)
    if (lastEnd > points[points.length - 1].time) points.push({ time: lastEnd, value: 0 })
  }
  return points
})

const pidCycleChartRef = ref(null)
let pidCycleChartInstance = null

function renderPidCycleChart() {
  const points = pidCyclePoints.value
  const el = pidCycleChartRef.value
  if (!points.length || !el || el.offsetWidth === 0) {
    if (el) setTimeout(renderPidCycleChart, 50)
    return
  }
  if (pidCycleChartInstance) pidCycleChartInstance.dispose()
  const chart = echarts.init(el)
  pidCycleChartInstance = chart

  const pad2 = (n) => String(n).padStart(2, '0')
  chart.setOption({
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params
        const d = new Date(p.value[0])
        return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}<br/>加热：${p.value[1] === 1 ? '开' : '关'}`
      },
    },
    legend: { data: ['加热'], top: 0 },
    toolbox: {
      feature: { saveAsImage: { title: '下载图片' } },
      right: 10,
      top: 0,
    },
    grid: { left: 50, right: 30, top: 50, bottom: 50 },
    // 时间轴：每段宽度按真实时长渲染，才能看出每次加热持续多久、占空比大小；
    // category 轴会把每个点等距排开，开/关段一样宽，看不出时长。
    xAxis: {
      type: 'time',
      axisLabel: {
        rotate: 15,
        fontSize: 10,
        formatter: (val) => {
          const d = new Date(val)
          return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
        },
      },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 1,
      interval: 1,
      axisLabel: { formatter: (v) => (v === 1 ? '开' : v === 0 ? '关' : '') },
    },
    series: [
      { name: '加热', type: 'line', step: 'end', data: points.map((p) => [p.time, p.value]), itemStyle: { color: '#f97316' }, lineStyle: { color: '#f97316', width: 2 } },
    ],
  }, true)
}

watch([pidCyclePoints, pidCycleChartRef], () => {
  nextTick(() => {
    if (pidCycleChartRef.value) queueRender(renderPidCycleChart)
  })
})

// ==================== 累计流量（从累计统计里单独摘出来，自己一张图） ====================
const cumulativeFlowEntry = computed(() => {
  if (historyChartsConfig.value.showCumulative === false) return null
  const configs = cumulativeMetricConfigs.value
  const key = 'cumulative_flow'
  const rows = cumulativeData.value[key]
  const cfg = configs[key]
  if (!Array.isArray(rows) || !rows.length || !cfg || !(cfg.mode === 'standalone' || cfg.mode === 'both')) return null
  return { key, config: cfg, rows }
})

const cumulativeFlowChartRef = ref(null)
let cumulativeFlowChartInstance = null

function renderCumulativeFlowChart() {
  const entry = cumulativeFlowEntry.value
  const el = cumulativeFlowChartRef.value
  if (!entry || !el || el.offsetWidth === 0) {
    if (el) setTimeout(renderCumulativeFlowChart, 50)
    return
  }
  if (cumulativeFlowChartInstance) cumulativeFlowChartInstance.dispose()
  const chart = echarts.init(el)
  cumulativeFlowChartInstance = chart

  const times = formatTimes(entry.rows)
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: [entry.config.metric_name], top: 0 },
    toolbox: {
      feature: { magicType: { type: ['line', 'bar'] }, saveAsImage: { title: '下载图片' } },
      right: 10,
      top: 0,
    },
    grid: { left: 14, right: 20, top: 50, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', name: entry.config.unit || '', nameTextStyle: { fontSize: 11 } },
    series: [{
      name: entry.config.metric_name,
      type: entry.config.chart_type || 'line',
      data: entry.rows.map((r) => r.cumulative),
      itemStyle: { color: entry.config.color || '#0ea5e9' },
      lineStyle: { color: entry.config.color || '#0ea5e9' },
      smooth: true,
    }],
  }, true)
}

watch([cumulativeFlowEntry, cumulativeFlowChartRef], () => {
  nextTick(() => {
    if (cumulativeFlowChartRef.value) queueRender(renderCumulativeFlowChart)
  })
})

// ==================== 累计运行时长（累计加热时长 + 累计水泵运行时长，同图对比） ====================
const switchDurationEntries = computed(() => {
  if (historyChartsConfig.value.showCumulative === false) return []
  const configs = cumulativeMetricConfigs.value
  return ['cumulative_heat_time', 'cumulative_pump_time']
    .map((key) => {
      const rows = cumulativeData.value[key]
      const cfg = configs[key]
      if (!Array.isArray(rows) || !rows.length || !cfg || !(cfg.mode === 'standalone' || cfg.mode === 'both')) return null
      return { key, config: cfg, rows }
    })
    .filter(Boolean)
})

const switchDurationChartRef = ref(null)
let switchDurationChartInstance = null

function renderSwitchDurationChart() {
  const entries = switchDurationEntries.value
  const el = switchDurationChartRef.value
  if (!entries.length || !el || el.offsetWidth === 0) {
    if (el) setTimeout(renderSwitchDurationChart, 50)
    return
  }
  if (switchDurationChartInstance) switchDurationChartInstance.dispose()
  const chart = echarts.init(el)
  switchDurationChartInstance = chart

  const base = entries.reduce((a, b) => (b.rows.length > a.rows.length ? b : a))
  const times = formatTimes(base.rows)
  const series = entries.map((entry) => ({
    name: entry.config.metric_name,
    type: entry.config.chart_type || 'line',
    data: entry.rows.map((r) => r.cumulative),
    itemStyle: { color: entry.config.color || '#0ea5e9' },
    lineStyle: { color: entry.config.color || '#0ea5e9' },
    smooth: true,
  }))

  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: entries.map((e) => e.config.metric_name), top: 0 },
    toolbox: {
      feature: { magicType: { type: ['line', 'bar'] }, saveAsImage: { title: '下载图片' } },
      right: 10,
      top: 0,
    },
    grid: { left: 14, right: 20, top: 50, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', name: entries[0]?.config.unit || '', nameTextStyle: { fontSize: 11 } },
    series,
  }, true)
}

watch([switchDurationEntries, switchDurationChartRef], () => {
  nextTick(() => {
    if (switchDurationChartRef.value) queueRender(renderSwitchDurationChart)
  })
})

// ==================== 自定义公式指标（"公式与图表"勾选了"历史图表"的指标，每条一张卡片） ====================
const derivedMetricEntries = computed(() => {
  if (historyChartsConfig.value.showDerivedMetricCharts === false) return []
  return Object.entries(derivedMetricData.value)
    .filter(([, v]) => v.rows && v.rows.length > 0)
    .map(([key, v]) => ({ key, config: v.config, rows: v.rows }))
})

/** 存放每个自定义指标图表的 ECharts 实例 */
const derivedChartInstances = {}
/** element refs 的 map */
const derivedChartRefs = {}

function setDerivedChartRef(key, el) {
  if (el && !derivedChartRefs[key]) {
    derivedChartRefs[key] = el
    nextTick(() => queueRender(() => renderDerivedEntryChart(key)))
  }
}

function renderDerivedEntryChart(key) {
  const entry = derivedMetricEntries.value.find((e) => e.key === key)
  if (!entry) return
  const el = derivedChartRefs[key]
  if (!el || el.offsetWidth === 0) {
    setTimeout(() => renderDerivedEntryChart(key), 50)
    return
  }
  if (derivedChartInstances[key]) derivedChartInstances[key].dispose()
  const chart = echarts.init(el)
  derivedChartInstances[key] = chart
  const rows = entry.rows
  const name = entry.config.metric_name
  const unit = entry.config.unit || ''
  const color = entry.config.color || '#0ea5e9'
  const type = entry.config.chart_type || 'line'
  const data = rows.map((r) => r.value)
  const times = formatTimes(rows)

  chart.setOption({
    tooltip: { trigger: 'axis' },
    toolbox: {
      feature: { magicType: { type: ['line', 'bar'] }, saveAsImage: { title: '下载图片' } },
      right: 10,
      top: 0,
    },
    grid: { left: 14, right: 60, top: 40, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', name: unit, nameTextStyle: { fontSize: 11 } },
    series: [{ name, type, data, itemStyle: { color }, lineStyle: { color }, smooth: true }],
  }, true)
}

watch(derivedMetricEntries, () => {
  nextTick(() => {
    derivedMetricEntries.value.forEach((e) => {
      if (derivedChartRefs[e.key]) queueRender(() => renderDerivedEntryChart(e.key))
    })
  })
})

function disposeAllCharts() {
  if (_renderRaf) { cancelAnimationFrame(_renderRaf); _renderRaf = 0 }
  _renderQueue.length = 0
  Object.values(chartInstances).forEach((c) => c?.dispose())
  for (const key in chartInstances) delete chartInstances[key]
  for (const key in chartRefs) delete chartRefs[key]
  Object.values(derivedChartInstances).forEach((c) => c?.dispose())
  for (const key in derivedChartInstances) delete derivedChartInstances[key]
  for (const key in derivedChartRefs) delete derivedChartRefs[key]
  cumulativeChartInstance?.dispose()
  cumulativeChartInstance = null
  averageChartInstance?.dispose()
  averageChartInstance = null
  scatterChartInstance?.dispose()
  scatterChartInstance = null
  tempChartInstance?.dispose()
  tempChartInstance = null
  flowPressureChartInstance?.dispose()
  flowPressureChartInstance = null
  pidTrackingChartInstance?.dispose()
  pidTrackingChartInstance = null
  pumpVelocityTrackingChartInstance?.dispose()
  pumpVelocityTrackingChartInstance = null
  actualPowerChartInstance?.dispose()
  actualPowerChartInstance = null
  heatEnergyChartInstance?.dispose()
  heatEnergyChartInstance = null
  secChartInstance?.dispose()
  secChartInstance = null
  deviceStateChartInstance?.dispose()
  deviceStateChartInstance = null
  pidCycleChartInstance?.dispose()
  pidCycleChartInstance = null
  cumulativeFlowChartInstance?.dispose()
  cumulativeFlowChartInstance = null
  switchDurationChartInstance?.dispose()
  switchDurationChartInstance = null
}

onMounted(async () => {
  await systemStore.load()
  loadAll()
})

onUnmounted(() => {
  disposeAllCharts()
})
</script>

<style scoped>
.history-charts-page { color: #1f2937; }

.range-panel { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 16px 20px; margin-bottom: 16px; border: 1px solid #e5e7eb; border-radius: 14px; background: #fff; box-shadow: 0 6px 20px rgba(15, 23, 42, .05); }

.chart-section { margin: 0 0 16px; }
.section-title { margin: 0 0 12px; font-size: 20px; color: #0f172a; display: flex; align-items: center; gap: 12px; }
.target-temp-badge { font-size: 13px; font-weight: 400; color: #ef4444; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 2px 10px; }
.chart-grid { display: grid; gap: 14px; }
.chart-card { box-sizing: border-box; border: 1px solid #e5e7eb; border-radius: 14px; background: #fff; box-shadow: 0 6px 20px rgba(15, 23, 42, .05); padding: 20px; }
.chart-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.chart-card-header h3 { margin: 0; font-size: 16px; color: #0f172a; }
.chart-el-wrapper { min-height: 240px; }
.chart-el { width: 100%; height: 240px; }
.chart-card-wide { width: 100%; }
.chart-el-tall { height: 340px; }

@media (max-width: 1050px) { .chart-grid { grid-template-columns: 1fr !important; } }
@media (max-width: 700px) { .range-panel { flex-direction: column; align-items: stretch; } }
</style>
