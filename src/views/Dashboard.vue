<template>
  <div class="dashboard-page" v-loading="loading">
    <section class="hero-panel">
      <div>
        <p class="eyebrow">2026 物联网技能赛场景</p>
        <h1>水循环系统运行概览</h1>
        <p class="hero-copy">集中查看温度、流量、压力、设备在线状态与最近告警。</p>
      </div>
      <el-button type="primary" :loading="loading" @click="loadDashboard">刷新数据</el-button>
    </section>

    <section class="metric-grid">
      <article class="metric-card">
        <span>设备总数</span>
        <strong>{{ deviceTotal }}</strong>
        <small>已登记采集及控制设备</small>
      </article>
      <article class="metric-card online">
        <span>在线设备</span>
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
        <el-empty v-else description="暂无传感器数据" :image-size="72" />
        <div v-if="latestSensor" class="updated-at">
          设备 {{ latestSensor['设备编号'] || '未标识' }} · {{ latestSensor['创立时间'] || '时间未知' }}
        </div>
      </article>

      <article class="panel">
        <div class="panel-heading">
          <div>
            <h2>设备状态</h2>
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
import { computed, onMounted, onUnmounted, ref } from 'vue'
import api from '@/api'
import { connect, on as wsOn } from '@/utils/websocket'

const loading = ref(false)
const dashboard = ref({})
const deviceTotal = ref(0)
const mqttConnected = ref(false)
const deviceStatuses = ref([])
let unsubscribeStatus = null
let unsubscribeSensor = null
let unsubscribeError = null

const rows = computed(() => dashboard.value.processedData || [])
const latestSensor = computed(() => rows.value[0] || null)
const fieldUnits = computed(() => dashboard.value.fieldUnits || {})
const recentErrors = computed(() => Object.values(dashboard.value.sortedData || {}).flat())
const onlineCount = computed(() => deviceStatuses.value.filter((item) => item.online).length)
const sensorFields = computed(() => {
  if (!latestSensor.value) return []
  const excluded = new Set(['id', '设备编号', '创立时间', '数据类型'])
  return Object.keys(latestSensor.value).filter((key) => !excluded.has(key))
})

function displayValue(value, field) {
  if (value === null || value === undefined || value === '') return '--'
  const unit = fieldUnits.value[field]
  return unit ? `${value} ${unit}` : value
}

async function loadDashboard() {
  loading.value = true
  try {
    const [dataResult, deviceResult, mqttResult] = await Promise.allSettled([
      api.get('/data', { params: { online: '实时数据' } }),
      api.get('/deviceData', { params: { currentPage: 1, pageSize: 100 } }),
      api.get('/api/mqtt/status'),
    ])
    if (dataResult.status === 'fulfilled') dashboard.value = dataResult.value.data || {}
    if (deviceResult.status === 'fulfilled') {
      deviceTotal.value = Number(deviceResult.value.data?.data?.total) || 0
    }
    if (mqttResult.status === 'fulfilled') {
      mqttConnected.value = Boolean(mqttResult.value.data?.data?.isConnected)
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
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
.updated-at { margin-top: 18px; color: #64748b; font-size: 13px; }
.status-list { display: grid; gap: 10px; }
.status-row { display: grid; grid-template-columns: 12px 1fr auto; align-items: center; gap: 9px; padding: 12px; border-radius: 10px; background: #f8fafc; }
.status-dot { width: 10px; height: 10px; border-radius: 50%; background: #94a3b8; }
.status-dot.active { background: #10b981; box-shadow: 0 0 0 4px #d1fae5; }
@media (max-width: 1050px) { .metric-grid { grid-template-columns: repeat(2, 1fr); } .dashboard-grid { grid-template-columns: 1fr; } }
@media (max-width: 700px) { .hero-panel { align-items: flex-start; flex-direction: column; } .metric-grid, .reading-grid { grid-template-columns: 1fr; } }
</style>
