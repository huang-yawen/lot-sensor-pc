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

    <el-empty
      v-if="!loading && !cumulativeEntries.length && !timeWindowEntries.length && !showAverageChart && !showTempChart && !showFlowPressureChart"
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
  ...systemStore.config.HISTORY_CHARTS,
}))

const cumulativeData = ref({})
const timeWindowData = ref({})
const averageChartRows = ref([])

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
    const [cumRes, twRes, avgRes] = await Promise.allSettled([
      api.get('/api/cumulative', { params }),
      api.get('/api/time-window', { params }),
      api.get('/api/average-chart', { params }),
    ])
    cumulativeData.value = cumRes.status === 'fulfilled' ? (cumRes.value.data?.data || {}) : {}
    timeWindowData.value = twRes.status === 'fulfilled' ? (twRes.value.data?.data || {}) : {}
    averageChartRows.value = avgRes.status === 'fulfilled' ? (avgRes.value.data?.data || []) : []
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

const cumulativeEntries = computed(() => {
  if (historyChartsConfig.value.showCumulative === false) return []
  const configs = cumulativeMetricConfigs.value
  return Object.entries(cumulativeData.value)
    .filter(([key, rows]) => {
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
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['温度1', '温度2'], top: 0 },
    toolbox: {
      feature: { magicType: { type: ['line', 'bar'] }, saveAsImage: { title: '下载图片' } },
      right: 10,
      top: 0,
    },
    grid: { left: 14, right: 60, top: 50, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', name: '℃', nameTextStyle: { fontSize: 11 } },
    series: [
      { name: '温度1', type: 'line', smooth: true, data: rows.map((r) => r.temp1), itemStyle: { color: '#f97316' }, lineStyle: { color: '#f97316' } },
      { name: '温度2', type: 'line', smooth: true, data: rows.map((r) => r.temp2), itemStyle: { color: '#3b82f6' }, lineStyle: { color: '#3b82f6' } },
    ],
  }, true)
}

watch([averageChartRows, tempChartRef], () => {
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

function disposeAllCharts() {
  Object.values(chartInstances).forEach((c) => c?.dispose())
  for (const key in chartInstances) delete chartInstances[key]
  for (const key in chartRefs) delete chartRefs[key]
  cumulativeChartInstance?.dispose()
  cumulativeChartInstance = null
  averageChartInstance?.dispose()
  averageChartInstance = null
  tempChartInstance?.dispose()
  tempChartInstance = null
  flowPressureChartInstance?.dispose()
  flowPressureChartInstance = null
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
.section-title { margin: 0 0 12px; font-size: 20px; color: #0f172a; }
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
