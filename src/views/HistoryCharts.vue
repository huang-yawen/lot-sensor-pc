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

    <!-- ==================== 温度曲线（温度1 / 温度2） ==================== -->
    <section v-if="showTempChart" class="chart-section">
      <h2 class="section-title">温度曲线</h2>
      <div class="chart-card chart-card-wide">
        <div ref="tempChartRef" class="chart-el chart-el-tall"></div>
      </div>
    </section>

    <!-- ==================== 瞬时流量与压力（双轴） ==================== -->
    <section v-if="showFlowPressureChart" class="chart-section">
      <h2 class="section-title">瞬时流量与压力</h2>
      <div class="chart-card chart-card-wide">
        <div ref="flowPressureChartRef" class="chart-el chart-el-tall"></div>
      </div>
    </section>

    <!-- ==================== PID跟踪对比（目标温度参考线 + 温度2实际值） ==================== -->
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

    <!-- ==================== 设备状态时间线（水泵/加热开关阶梯图） ==================== -->
    <section v-if="showDeviceStateChart" class="chart-section">
      <h2 class="section-title">设备状态时间线</h2>
      <div class="chart-card chart-card-wide">
        <div ref="deviceStateChartRef" class="chart-el chart-el-tall"></div>
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
      v-if="!loading && !cumulativeEntries.length && !timeWindowEntries.length && !showAverageChart && !showTempFlowScatter && !showTempChart && !showFlowPressureChart && !showPidTrackingChart && !showDeviceStateChart && !cumulativeFlowEntry && !switchDurationEntries.length && !derivedMetricEntries.length"
      description="所选时间范围内暂无数据，或配置中心还没启用相关图表"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import api from '@/api'
import * as echarts from 'echarts'
import { useSystemConfigStore } from '@/stores/SystemConfigStore'

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
const derivedMetricData = ref({})

/** 统一的时间轴格式化，三张图共用。 */
function formatTimes(rows) {
  return rows.map((r) => (r.c_time
    ? new Date(r.c_time).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      })
    : ''))
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
    const [cumRes, twRes, avgRes, stateRes, derivedRes, scatterRes] = await Promise.allSettled([
      api.get('/api/cumulative', { params }),
      api.get('/api/time-window', { params }),
      api.get('/api/average-chart', { params }),
      api.get('/api/device-state-trend', { params }),
      api.get('/api/derived-metrics/history', { params }),
      api.get('/api/temp-flow-scatter', { params }),
    ])
    cumulativeData.value = cumRes.status === 'fulfilled' ? (cumRes.value.data?.data || {}) : {}
    timeWindowData.value = twRes.status === 'fulfilled' ? (twRes.value.data?.data || {}) : {}
    averageChartRows.value = avgRes.status === 'fulfilled' ? (avgRes.value.data?.data?.rows || []) : []
    targetTemp.value = avgRes.status === 'fulfilled' ? (avgRes.value.data?.data?.targetTemp ?? null) : null
    targetVelocity.value = avgRes.status === 'fulfilled' ? (avgRes.value.data?.data?.targetVelocity ?? null) : null
    deviceStateRows.value = stateRes.status === 'fulfilled' ? (stateRes.value.data?.data || []) : []
    derivedMetricData.value = derivedRes.status === 'fulfilled' ? (derivedRes.value.data?.data || {}) : {}
    scatterRows.value = scatterRes.status === 'fulfilled' ? (scatterRes.value.data?.data || []) : []
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
    if (cumulativeChartRef.value) renderCumulativeChart()
  })
}, { deep: true })

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
    nextTick(() => renderEntryChart(key))
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
      if (chartRefs[e.key]) renderEntryChart(e.key)
    })
  })
}, { deep: true })

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
    if (averageChartRef.value) renderAverageChart()
  })
}, { deep: true })

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
    if (scatterChartRef.value) renderScatterChart()
  })
}, { deep: true })

// ==================== 温度曲线（温度1 / 温度2） ====================
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
    { name: '温度1', type: 'line', smooth: true, data: rows.map((r) => r.temp1), itemStyle: { color: '#f97316' }, lineStyle: { color: '#f97316' } },
    { name: '温度2', type: 'line', smooth: true, data: rows.map((r) => r.temp2), itemStyle: { color: '#3b82f6' }, lineStyle: { color: '#3b82f6' } },
  ]
  const legendData = ['温度1', '温度2']

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
    if (tempChartRef.value) renderTempChart()
  })
}, { deep: true })

// ==================== 瞬时流量与压力（双轴，单位不同） ====================
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
    legend: { data: ['瞬时流量', '压力'], top: 0 },
    toolbox: {
      feature: { magicType: { type: ['line', 'bar'] }, saveAsImage: { title: '下载图片' } },
      right: 10,
      top: 0,
    },
    grid: { left: 14, right: 60, top: 50, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: [
      { type: 'value', name: '瞬时流量', nameTextStyle: { fontSize: 11 } },
      { type: 'value', name: '压力', nameTextStyle: { fontSize: 11 } },
    ],
    series: [
      { name: '瞬时流量', type: 'line', yAxisIndex: 0, smooth: true, data: rows.map((r) => r.flow), itemStyle: { color: '#0ea5e9' }, lineStyle: { color: '#0ea5e9' } },
      { name: '压力', type: 'line', yAxisIndex: 1, smooth: true, data: rows.map((r) => r.pressure), itemStyle: { color: '#a855f7' }, lineStyle: { color: '#a855f7' } },
    ],
  }, true)
}

watch([averageChartRows, flowPressureChartRef], () => {
  nextTick(() => {
    if (flowPressureChartRef.value) renderFlowPressureChart()
  })
}, { deep: true })

// ==================== PID跟踪对比（目标温度参考线 + 温度2实际值） ====================
// 目标温度在指令中心只存"当前值"，没有历史，没法画成随时间变化的曲线，
// 只能取当前生效值画一条水平参考线（markLine），跟温度2的实际曲线对照。
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
    legend: { data: ['温度2（实际）'], top: 0 },
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
        name: '温度2（实际）',
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
    if (pidTrackingChartRef.value) renderPidTrackingChart()
  })
}, { deep: true })

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
    legend: { data: ['平均流速（实际）'], top: 0 },
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
        name: '平均流速（实际）',
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
    if (pumpVelocityTrackingChartRef.value) renderPumpVelocityTrackingChart()
  })
}, { deep: true })

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
    if (deviceStateChartRef.value) renderDeviceStateChart()
  })
}, { deep: true })

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
    if (cumulativeFlowChartRef.value) renderCumulativeFlowChart()
  })
}, { deep: true })

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
    if (switchDurationChartRef.value) renderSwitchDurationChart()
  })
}, { deep: true })

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
    nextTick(() => renderDerivedEntryChart(key))
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
      if (derivedChartRefs[e.key]) renderDerivedEntryChart(e.key)
    })
  })
}, { deep: true })

function disposeAllCharts() {
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
  deviceStateChartInstance?.dispose()
  deviceStateChartInstance = null
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
