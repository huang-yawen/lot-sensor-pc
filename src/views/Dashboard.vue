<!--
 * 【文件职责】
 * 业务页面，负责组合数据、状态和用户操作，呈现完整功能界面。
 * 【配置中心关联】
 * 页面通过状态仓库读取配置中心；场景开关保存后，相关显示与交互按最新配置更新。
 * -->
<template>
  <div class="dashboard-page" v-loading="loading">
    <section class="hero-panel">
      <div>
        <p class="eyebrow">{{ config.SCENE_TAG || '物联网应用场景' }}</p>
        <h1>{{ config.SYSTEM_TITLE || '物联网数据管理中心' }}</h1>
        <p class="hero-copy">{{ config.SCENE_DESCRIPTION || '集中查看实时数据、设备状态与最近告警。' }}</p>
      </div>
      <el-button type="primary" :loading="loading" @click="loadDashboard">刷新数据</el-button>
    </section>

    <section class="metric-grid">
      <article class="metric-card">
        <span>{{ deviceLabel }}总数</span>
        <strong>{{ deviceTotal }}</strong>
        <small>已登记采集及控制设备</small>
      </article>
      <article class="metric-card online">
        <span>在线{{ deviceLabel }}</span>
        <strong>{{ onlineCount }}</strong>
        <small>依据设备心跳实时判断</small>
      </article>
      <article class="metric-card sensor">
        <span>监测指标</span>
        <strong>{{ sensorFields.length }}</strong>
        <small>由数据库字段映射动态生成</small>
      </article>
      <article class="metric-card warning">
        <span>最近告警</span>
        <strong>{{ recentErrors.length }}</strong>
        <small>接口返回的最近故障记录</small>
      </article>
    </section>

    <!-- ==================== 累计派生指标独立图表区（standalone / both 模式） ==================== -->
    <section v-if="cumulativeEntries.length > 0" class="cumulative-section">
      <h2 class="section-title">累计统计</h2>
      <div class="cumulative-grid" :style="{ gridTemplateColumns: `repeat(${Math.min(cumulativeEntries.length, 2)}, 1fr)` }">
        <div v-for="entry in cumulativeEntries" :key="entry.key" class="cumulative-card">
          <div class="cumulative-card-header">
            <h3>{{ entry.config.metric_name }}</h3>
            <el-tag size="small">{{ entry.config.unit }}</el-tag>
          </div>
          <div class="cumulative-chart-wrapper">
            <div v-if="entry.rows.length === 0" class="empty-chart">
              <el-empty description="暂无累计数据" :image-size="60" />
            </div>
            <div
              v-else
              :ref="(el) => setChartRef(entry.key, el)"
              class="cumulative-chart"
            ></div>
          </div>
        </div>
      </div>
    </section>

    <!-- ==================== 时间窗口派生指标独立图表区（standalone / both 模式） ==================== -->
    <section v-if="timeWindowEntries.length > 0" class="cumulative-section">
      <h2 class="section-title">滑动统计</h2>
      <div class="cumulative-grid" :style="{ gridTemplateColumns: `repeat(${Math.min(timeWindowEntries.length, 2)}, 1fr)` }">
        <div v-for="entry in timeWindowEntries" :key="entry.key" class="cumulative-card">
          <div class="cumulative-card-header">
            <h3>{{ entry.config.metric_name }}</h3>
            <el-tag size="small" :type="entry.config.aggregation === 'avg' ? 'success' : entry.config.aggregation === 'volatility' ? 'warning' : 'info'">
              {{ entry.config.aggregation === 'avg' ? '平滑' : entry.config.aggregation === 'volatility' ? '波动' : '变化率' }}
            </el-tag>
            <el-tag size="small">{{ entry.config.unit }}</el-tag>
          </div>
          <div class="cumulative-chart-wrapper">
            <div v-if="entry.rows.length === 0" class="empty-chart">
              <el-empty description="暂无窗口数据" :image-size="60" />
            </div>
            <div
              v-else
              :ref="(el) => setChartRef(entry.key, el)"
              class="cumulative-chart"
            ></div>
          </div>
        </div>
      </div>
    </section>

    <!-- ==================== 需要计算的数据（工程指标专用板块） ==================== -->
    <section v-if="computedMetricList.length" class="computed-section">
      <h2 class="section-title">计算数据</h2>
      <div class="computed-grid">
        <div v-for="item in computedMetricList" :key="item.key" class="computed-card">
          <div class="computed-card-label">{{ item.label }}</div>
          <div class="computed-card-value">
            <template v-if="item.value != null">{{ item.value }}</template>
            <span v-else class="muted">--</span>
            <span v-if="item.value != null && item.unit" class="unit">{{ item.unit }}</span>
          </div>
          <div v-if="item.note" class="computed-card-note">{{ item.note }}</div>
        </div>
      </div>
    </section>

    <!-- ==================== 平均温度 / 平均流速 趋势图 ==================== -->
    <section v-if="computedEntry" class="cumulative-section">
      <h2 class="section-title">平均温度与平均流速</h2>
      <div class="cumulative-grid">
        <div v-if="computedEntry.flags?.averageTempChart" class="cumulative-card">
          <div class="cumulative-card-header">
            <h3>平均温度</h3>
            <el-tag size="small">℃</el-tag>
          </div>
          <div :ref="(el) => setTrendChartRef('avgTemp', el)" class="cumulative-chart"></div>
        </div>
        <div v-if="computedEntry.flags?.averageVelocityChart" class="cumulative-card">
          <div class="cumulative-card-header">
            <h3>平均流速</h3>
            <el-tag size="small">m/s</el-tag>
          </div>
          <div :ref="(el) => setTrendChartRef('avgVel', el)" class="cumulative-chart"></div>
        </div>
      </div>
    </section>

    <section class="dashboard-grid">
      <article class="panel sensor-panel">
        <div class="panel-heading">
          <div>
            <h2>最新传感数据</h2>
            <p>兼容温度、流量、压力等动态字段</p>
          </div>
          <el-tag :type="mqttConnected ? 'success' : 'danger'">
            MQTT {{ mqttConnected ? '已连接' : '未连接' }}
          </el-tag>
        </div>
        <div v-if="latestSensor" class="reading-grid">
          <div v-for="field in sensorFields" :key="field" class="reading-item">
            <span>{{ field }}</span>
            <strong>{{ displayValue(latestSensor[field], field) }}</strong>
          </div>
        </div>
        <div v-if="latestBehavior && behaviorFields.length" class="behavior-reading">
          <div class="behavior-reading-title">运行状态</div>
          <div class="reading-grid">
            <div v-for="field in behaviorFields" :key="field" class="reading-item behavior">
              <span>{{ field }}</span>
              <strong>{{ displayValue(latestBehavior[field], field) }}</strong>
            </div>
          </div>
        </div>
        <el-empty v-if="!latestSensor && !latestBehavior" description="暂无传感器数据" :image-size="72" />
        <div v-if="latestSensor" class="updated-at">
          <template v-if="displayStore.isFieldVisible('设备编号')">{{ deviceLabel }} {{ latestSensor['设备编号'] || '未标识' }} · </template>{{ latestSensor['创立时间'] || '时间未知' }}
        </div>
      </article>

      <article class="panel">
        <div class="panel-heading">
          <div>
            <h2>{{ deviceLabel }}状态</h2>
            <p>心跳状态会通过 WebSocket 自动刷新</p>
          </div>
        </div>
        <div v-if="deviceStatuses.length" class="status-list">
          <div v-for="device in deviceStatuses" :key="device.deviceId" class="status-row">
            <span class="status-dot" :class="{ active: device.online }"></span>
            <span>{{ device.deviceId }}</span>
            <el-tag size="small" :type="device.online ? 'success' : 'info'">
              {{ device.online ? '在线' : '离线' }}
            </el-tag>
          </div>
        </div>
        <el-empty v-else description="等待设备心跳" :image-size="72" />
      </article>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import api from '@/api'
import * as echarts from 'echarts'
import { connect, on as wsOn } from '@/utils/websocket'
import { useSystemConfigStore } from '@/stores/SystemConfigStore'
import { DisplayStore } from '@/stores/DisplayStore'

const loading = ref(false)
const dashboard = ref({})
const computedMetrics = ref({})
const deviceTotal = ref(0)
const mqttConnected = ref(false)
const deviceStatuses = ref([])
const systemStore = useSystemConfigStore()
const displayStore = DisplayStore()
const config = computed(() => systemStore.config)
const deviceLabel = computed(() => config.value.DEVICE_LABEL || config.value.TERMINOLOGY?.device || '设备')
let unsubscribeStatus = null
let unsubscribeSensor = null
let unsubscribeError = null

const rows = computed(() => dashboard.value.processedData || [])
const latestSensor = computed(() => rows.value[0] || null)
const latestBehavior = computed(() => (dashboard.value.behaviorOutcome || [])[0] || null)
const fieldUnits = computed(() => dashboard.value.fieldUnits || {})

// ==================== 需要计算的数据（后端实时派生指标） ====================
const computedMetricList = computed(() => {
  const keys = Object.keys(computedMetrics.value || {})
  const entry = keys.length ? computedMetrics.value[keys[0]] : null
  if (!entry) return []
  const flags = entry.flags || {}
  const fmt = (v, digits = 2) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v).toFixed(digits))
  const list = []

  if (flags.resistanceK && entry.resistanceK) {
    const trend = entry.resistanceK.trend3d
    list.push({
      key: 'resistanceK',
      label: '系统阻力系数 K',
      unit: entry.resistanceK.unit || '',
      value: fmt(entry.resistanceK.value, 4),
      note: trend != null ? `3天趋势 ${(trend * 100).toFixed(1)}%` : '',
    })
  }
  if (flags.pressureDropRate && entry.pressureDropRate) {
    list.push({
      key: 'pressureDropRate',
      label: '压力陡降速率',
      unit: entry.pressureDropRate.unit || '',
      value: fmt(entry.pressureDropRate.value, 3),
      note: entry.pressureDropRate.dropInHalfSecond ? '0.5s 内骤降' : '',
    })
  }
  if (flags.tempChangeRate && entry.tempChangeRate) {
    const t1 = fmt(entry.tempChangeRate.temp1, 3)
    const t2 = fmt(entry.tempChangeRate.temp2, 3)
    list.push({
      key: 'tempChangeRate',
      label: '温度变化率 (T1/T2)',
      unit: '℃/s',
      value: `${t1 ?? '--'} / ${t2 ?? '--'}`,
    })
  }
  if (flags.heatExchangeEfficiency && entry.heatExchangeEfficiency) {
    const eff = entry.heatExchangeEfficiency.value
    list.push({
      key: 'heatExchangeEfficiency',
      label: '换热效率',
      unit: '%',
      value: eff != null ? fmt(eff * 100, 1) : null,
      note: entry.heatExchangeEfficiency.heatTransferredW ? `换热量 ${fmt(entry.heatExchangeEfficiency.heatTransferredW, 0)}W` : '',
    })
  }
  if (flags.eerHeatBalance && entry.eerHeatBalance) {
    list.push({
      key: 'eerHeatBalance',
      label: '能效比 / 热平衡',
      unit: '',
      value: entry.eerHeatBalance.cop != null ? fmt(entry.eerHeatBalance.cop, 3) : null,
      note: entry.eerHeatBalance.heatLossW != null ? `散热损失 ${fmt(entry.eerHeatBalance.heatLossW, 0)}W` : '',
    })
  }
  if (flags.flowPressureCurve && entry.flowPressureCurve) {
    list.push({
      key: 'flowPressureCurve',
      label: '流量-压力曲线斜率',
      unit: entry.flowPressureCurve.unit || '',
      value: fmt(entry.flowPressureCurve.slope, 3),
    })
  }
  if (flags.cumulativeFlow && entry.cumulativeFlow) {
    list.push({ key: 'cumulativeFlow', label: '累计流量', unit: entry.cumulativeFlow.unit || '', value: fmt(entry.cumulativeFlow.value, 2) })
  }
  if (flags.averageVelocity && entry.averageVelocity) {
    list.push({ key: 'averageVelocity', label: '平均流速', unit: entry.averageVelocity.unit || '', value: fmt(entry.averageVelocity.value, 4) })
  }
  if (flags.waterLevel && entry.waterLevel) {
    const t1 = entry.waterLevel.tank1
    const t2 = entry.waterLevel.tank2
    list.push({
      key: 'waterLevel',
      label: '液位（水箱1/水箱2）',
      unit: entry.waterLevel.unit || 'cm',
      value: t1 && t2 ? `${fmt(t1.levelCm, 1)} / ${fmt(t2.levelCm, 1)}` : null,
    })
  }
  return list
})

// ==================== 平均温度 / 平均流速 趋势图数据源 ====================
const computedEntry = computed(() => {
  const values = Object.values(computedMetrics.value || {})
  return values.find(v => v && v.series && v.series.length) || null
})

/** 趋势图实例与 refs（与累计图实例分开管理） */
const trendChartInstances = {}
const trendChartRefs = {}

function setTrendChartRef(key, el) {
  if (el && !trendChartRefs[key]) {
    trendChartRefs[key] = el
    nextTick(() => renderTrendChart(key))
  }
}

function renderTrendChart(key) {
  const entry = computedEntry.value
  const el = trendChartRefs[key]
  if (!entry || !el || el.offsetWidth === 0) {
    if (el) setTimeout(() => renderTrendChart(key), 50)
    return
  }
  if (trendChartInstances[key]) trendChartInstances[key].dispose()
  const chart = echarts.init(el)
  trendChartInstances[key] = chart

  const series = entry.series || []
  const times = series.map(p => p.time)
  const data = series.map(p => (key === 'avgTemp' ? p.averageTemp : p.averageVelocity))
  const name = key === 'avgTemp' ? '平均温度' : '平均流速'
  const unit = key === 'avgTemp' ? '℃' : 'm/s'
  const color = key === 'avgTemp' ? '#3b82f6' : '#10b981'

  chart.setOption({
    tooltip: { trigger: 'axis' },
    toolbox: { feature: { saveAsImage: { title: '下载图片' } }, right: 10, top: 0 },
    grid: { left: 14, right: 40, top: 40, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', name: unit, nameTextStyle: { fontSize: 11 } },
    series: [{ name, type: 'line', data, smooth: true, itemStyle: { color }, lineStyle: { color } }]
  }, true)
}

watch(computedEntry, () => {
  nextTick(() => {
    if (trendChartRefs.avgTemp) renderTrendChart('avgTemp')
    if (trendChartRefs.avgVel) renderTrendChart('avgVel')
  })
}, { deep: true })

const recentErrors = computed(() => Object.values(dashboard.value.sortedData || {}).flat())
const onlineCount = computed(() => deviceStatuses.value.filter((item) => item.online).length)
const sensorFields = computed(() => {
  if (!latestSensor.value) return []
  const excluded = new Set(['创立时间', '数据类型'])
  return Object.keys(latestSensor.value).filter((key) => !excluded.has(key) && displayStore.isFieldVisible(key))
})

const behaviorFields = computed(() => {
  if (!latestBehavior.value) return []
  const excluded = new Set(['创立时间', '更新时间', '数据类型', '储运箱ID', '控制模式'])
  return Object.keys(latestBehavior.value).filter((key) => !excluded.has(key) && displayStore.isFieldVisible(key))
})

function displayValue(value, field) {
  if (value === null || value === undefined || value === '') return '--'
  const unit = fieldUnits.value[field]
  return unit ? `${value} ${unit}` : value
}

// ==================== 累计 + 时间窗口派生指标（共用的图表渲染引擎） ====================
const cumulativeEntries = computed(() => {
  const data = dashboard.value.cumulativeData || {}
  return Object.entries(data)
    .filter(([, v]) => v.rows && v.rows.length > 0)
    .map(([key, v]) => ({ key, config: v.config, rows: v.rows }))
})

const timeWindowEntries = computed(() => {
  const data = dashboard.value.timeWindowData || {}
  return Object.entries(data)
    .filter(([, v]) => v.rows && v.rows.length > 0)
    .map(([key, v]) => ({ key, config: v.config, rows: v.rows }))
})

/** 存放每个图表的 ECharts 实例 */
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
  // 同时搜索两个 entry 列表
  let entry = cumulativeEntries.value.find(e => e.key === key)
  if (!entry) entry = timeWindowEntries.value.find(e => e.key === key)
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

  // 累计指标数据在 r.cumulative，时间窗口在 r.value
  const isCumulative = cumulativeEntries.value.some(e => e.key === key)
  const data = isCumulative ? rows.map(r => r.cumulative) : rows.map(r => r.value)

  const times = rows.map(r => r.c_time
    ? new Date(r.c_time).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      })
    : '')
  chart.setOption({
    tooltip: { trigger: 'axis' },
    toolbox: {
      feature: {
        magicType: { type: ['line', 'bar'] },
        saveAsImage: { title: '下载图片' },
      },
      right: 10,
      top: 0,
    },
    grid: { left: 14, right: 60, top: 40, bottom: 50 },
    xAxis: { type: 'category', data: times, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', name: unit, nameTextStyle: { fontSize: 11 } },
    series: [
      {
        name,
        type,
        data,
        itemStyle: { color },
        lineStyle: { color },
        smooth: true,
      }
    ]
  }, true)
}

// 监听两个列表变化
const allEntries = computed(() => [...cumulativeEntries.value, ...timeWindowEntries.value])
watch(allEntries, () => {
  nextTick(() => {
    allEntries.value.forEach(e => {
      if (chartRefs[e.key]) renderEntryChart(e.key)
    })
  })
}, { deep: true })

function disposeAllCharts() {
  Object.values(chartInstances).forEach(c => c?.dispose())
  for (const key in chartInstances) delete chartInstances[key]
  for (const key in chartRefs) delete chartRefs[key]
  Object.values(trendChartInstances).forEach(c => c?.dispose())
  for (const key in trendChartInstances) delete trendChartInstances[key]
  for (const key in trendChartRefs) delete trendChartRefs[key]
}

async function loadDashboard() {
  loading.value = true
  try {
    const [dataResult, deviceResult, mqttResult, computedResult] = await Promise.allSettled([
      api.get('/data', { params: { online: '实时数据' } }),
      api.get('/deviceData', { params: { currentPage: 1, pageSize: 100 } }),
      api.get('/api/mqtt/status'),
      api.get('/api/computed-metrics'),
    ])
    if (dataResult.status === 'fulfilled') dashboard.value = dataResult.value.data || {}
    if (deviceResult.status === 'fulfilled') {
      deviceTotal.value = Number(deviceResult.value.data?.data?.total) || 0
    }
    if (mqttResult.status === 'fulfilled') {
      mqttConnected.value = Boolean(mqttResult.value.data?.data?.isConnected)
    }
    if (computedResult.status === 'fulfilled') {
      computedMetrics.value = computedResult.value.data?.data || {}
    }
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await systemStore.load()
  loadDashboard()
  connect()
  unsubscribeStatus = wsOn('device_status', (payload) => {
    if (Array.isArray(payload)) deviceStatuses.value = payload
  })
  unsubscribeSensor = wsOn('sensor_data', loadDashboard)
  unsubscribeError = wsOn('error_data', loadDashboard)
})

onUnmounted(() => {
  unsubscribeStatus?.()
  unsubscribeSensor?.()
  unsubscribeError?.()
  disposeAllCharts()
})
</script>

<style scoped>
.dashboard-page { background: #f4f7fb !important; color: #1f2937; }
.hero-panel { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 26px 30px; border-radius: 16px; color: #fff; background: linear-gradient(125deg, #15375d, #087f8c); }
.eyebrow { margin-bottom: 6px; color: #a7f3d0; font-size: 13px; font-weight: 700; letter-spacing: .08em; }
.hero-panel h1 { margin: 0 0 8px; color: #fff; font-size: 30px; }
.hero-copy { color: #dbeafe; }
.metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 16px 0; }
.metric-card, .panel { border: 1px solid #e5e7eb; border-radius: 14px; background: #fff; box-shadow: 0 6px 20px rgba(15, 23, 42, .05); }
.metric-card { padding: 18px 20px; text-align: left; border-top: 4px solid #64748b; }
.metric-card.online { border-top-color: #10b981; }
.metric-card.sensor { border-top-color: #0ea5e9; }
.metric-card.warning { border-top-color: #f59e0b; }
.metric-card span, .metric-card small { display: block; color: #64748b; }
.metric-card strong { display: block; margin: 9px 0 4px; font-size: 30px; color: #0f172a; }
.dashboard-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); gap: 16px; }
.panel { min-height: 300px; padding: 22px; text-align: left; }
.panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.panel-heading h2 { margin: 0 0 4px; font-size: 20px; color: #0f172a; }
.panel-heading p { color: #64748b; font-size: 14px; }
.reading-grid { display: grid; grid-template-columns: repeat(3, minmax(130px, 1fr)); gap: 12px; }
.reading-item { padding: 16px; border-radius: 12px; background: #f0f9ff; }
.reading-item span { display: block; color: #64748b; font-size: 14px; }
.reading-item strong { display: block; margin-top: 8px; color: #075985; font-size: 22px; }
.behavior-reading { margin-top: 16px; padding-top: 16px; border-top: 1px dashed #e5e7eb; }
.behavior-reading-title { margin-bottom: 10px; color: #64748b; font-size: 14px; }
.reading-item.behavior { background: #f0fdf4; }
.reading-item.behavior strong { color: #047857; }
.updated-at { margin-top: 18px; color: #64748b; font-size: 13px; }

/* ===== 需要计算的数据 ===== */
.computed-section { margin: 0 0 16px; }
.computed-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.computed-card { padding: 16px; border: 1px solid #e5e7eb; border-radius: 14px; background: #fff; box-shadow: 0 6px 20px rgba(15, 23, 42, .05); }
.computed-card-label { color: #64748b; font-size: 13px; }
.computed-card-value { margin-top: 8px; font-size: 24px; font-weight: 700; color: #0f172a; }
.computed-card-value .unit { margin-left: 6px; font-size: 13px; font-weight: 400; color: #64748b; }
.computed-card-value .muted { color: #cbd5e1; font-weight: 400; }
.computed-card-note { margin-top: 6px; color: #e6a23c; font-size: 12px; }

.status-list { display: grid; gap: 10px; }
.status-row { display: grid; grid-template-columns: 12px 1fr auto; align-items: center; gap: 9px; padding: 12px; border-radius: 10px; background: #f8fafc; }
.status-dot { width: 10px; height: 10px; border-radius: 50%; background: #94a3b8; }
.status-dot.active { background: #10b981; box-shadow: 0 0 0 4px #d1fae5; }

/* ===== 累计图表区 ===== */
.cumulative-section { margin: 0 0 16px; }
.section-title { margin: 0 0 12px; font-size: 20px; color: #0f172a; }
.cumulative-grid { display: grid; gap: 14px; }
.cumulative-card { border: 1px solid #e5e7eb; border-radius: 14px; background: #fff; box-shadow: 0 6px 20px rgba(15, 23, 42, .05); padding: 20px; }
.cumulative-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.cumulative-card-header h3 { margin: 0; font-size: 16px; color: #0f172a; }
.cumulative-chart-wrapper { min-height: 240px; }
.cumulative-chart { width: 100%; height: 240px; }
.empty-chart { display: flex; align-items: center; justify-content: center; min-height: 240px; }

@media (max-width: 1050px) { .metric-grid { grid-template-columns: repeat(2, 1fr); } .dashboard-grid { grid-template-columns: 1fr; } .cumulative-grid { grid-template-columns: 1fr !important; } }
@media (max-width: 700px) { .hero-panel { align-items: flex-start; flex-direction: column; } .metric-grid, .reading-grid { grid-template-columns: 1fr; } }
</style>
