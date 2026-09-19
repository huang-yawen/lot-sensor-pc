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

    <section class="gauge-section">
      <article class="gauge-card">
        <GaugeChart :value="inletTemp" title="进水温度" unit="℃" :min="0" :max="60" />
      </article>
      <article class="gauge-card">
        <GaugeChart :value="currentTemp" title="出水温度" unit="℃" :min="0" :max="60" />
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
        <div v-if="latestBehavior && behaviorFields.length" class="behavior-reading">
          <div class="behavior-reading-title">运行状态</div>
          <div class="reading-grid">
            <div v-for="field in behaviorFields" :key="field" class="reading-item behavior">
              <span>{{ field }}</span>
              <strong>{{ displayValue(latestBehavior[field], field) }}</strong>
              <div v-if="switchDurationEnabled && durationInfoFor(field)?.isOn" class="duration-hint">
                累计运行 {{ formatDuration(durationInfoFor(field).totalMinutes) }} · 本次已运行 {{ formatDuration(durationInfoFor(field).currentSessionMinutes) }}
              </div>
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

    <!-- ==================== 需要计算的数据（工程指标专用板块） ==================== -->
    <section v-if="computedMetricList.length" class="computed-section">
      <article class="panel computed-panel">
        <div class="panel-heading">
          <div>
            <h2>计算数据</h2>
            <p>后端实时派生的工程指标</p>
          </div>
        </div>
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
      </article>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import api from '@/api'
import { connect, on as wsOn } from '@/utils/websocket'
import { useSystemConfigStore } from '@/stores/useSystemConfigStore'
import { useDisplayStore } from '@/stores/useDisplayStore'
import GaugeChart from '@/components/GaugeChart.vue'

const loading = ref(false)
const currentTemp = ref(null)
const dashboard = ref({})
const computedMetrics = ref({})
const deviceTotal = ref(0)
const mqttConnected = ref(false)
const deviceStatuses = ref([])
const switchDuration = ref({ pump: null, heater: null })
const systemStore = useSystemConfigStore()
const displayStore = useDisplayStore()
const config = computed(() => systemStore.config)
const deviceLabel = computed(() => config.value.DEVICE_LABEL || config.value.TERMINOLOGY?.device || '设备')
const switchDurationEnabled = computed(() => config.value.SWITCH_DURATION_DISPLAY?.enabled !== false)
let unsubscribeStatus = null
let unsubscribeSensor = null
let unsubscribeError = null
let wsRefreshTimer = null
let wsRefreshPending = false

const rows = computed(() => dashboard.value.processedData || [])
const latestSensor = computed(() => rows.value[0] || null)
const latestBehavior = computed(() => (dashboard.value.behaviorOutcome || [])[0] || null)
// 首页进水温度仪表盘：直接取最新一条传感数据里的“进水温度”原始读数（/api/data 已返回，
// 不再单独请求接口）。出水温度仪表盘仍走 /api/current-temp。
const inletTemp = computed(() => {
  const raw = latestSensor.value?.['进水温度']
  const n = Number(raw)
  return raw == null || raw === '' || !Number.isFinite(n) ? null : n
})
const fieldUnits = computed(() => dashboard.value.fieldUnits || {})

// ==================== 需要计算的数据（后端实时派生指标） ====================
const computedMetricList = computed(() => {
  const keys = Object.keys(computedMetrics.value || {})
  const entry = keys.length ? computedMetrics.value[keys[0]] : null
  if (!entry) return []
  const flags = entry.flags || {}
  if (flags.enabled === false) return []
  const fmt = (v, digits = 2) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v).toFixed(digits))
  const list = []

  // 只要 flags.X 是 true 就一定产出卡片：后端这一条没算出来时 value 给 null，
  // 模板会渲染成 "--"。否则"配置中心开着、页面上整块消失"，分不清是没开还是没数据。
  // 换热效率/热平衡/加热效率/加热速度这四项后端只在加热开启时算，缺值时注明原因。
  const HEAT_OFF_NOTE = '加热关闭时不计算'

  if (flags.resistanceK) {
    const rk = entry.resistanceK
    const trend = rk?.trendRecent
    list.push({
      key: 'resistanceK',
      label: '系统阻力系数 K',
      unit: rk?.unit || '',
      value: fmt(rk?.value, 4),
      note: trend != null ? `近期趋势 ${(trend * 100).toFixed(1)}%（约30分钟内，未落库）` : '',
    })
  }
  if (flags.pressureDropRate) {
    const pd = entry.pressureDropRate
    list.push({
      key: 'pressureDropRate',
      label: '压力陡降速率',
      unit: pd?.unit || '',
      value: fmt(pd?.value, 3),
      note: pd?.dropInHalfSecond ? '0.5s 内骤降' : '',
    })
  }
  if (flags.tempChangeRate) {
    const tc = entry.tempChangeRate
    // 口径 = "当前时刻往前 1 分钟"的变化率（后端 computedMetrics.js 的 60 秒窗口）：
    // (现在读数 − 1 分钟前读数) ÷ 实际间隔，单位 ℃/min。
    // 2 位小数足够：60 秒窗口下温差本身只有 0.1~1℃ 量级，折算过来留 3 位小数只是噪声。
    // 2 也正好是 fmt 的默认位数。
    const t1 = fmt(tc?.temp1, 2)
    const t2 = fmt(tc?.temp2, 2)
    list.push({
      key: 'tempChangeRate',
      label: '温度变化率 (进水/出水)',
      // 单位跟着后端返回值走（同 pressureDropRate 的写法），别在前端写死：
      // 后端 computedMetrics.js 这个口径改过（按秒 → 按分钟 → 现在的"前一分钟窗口"），
      // 写死就会跟实际值对不上。
      unit: tc?.unit || '℃/min',
      value: tc ? `${t1 ?? '--'} / ${t2 ?? '--'}` : null,
      // 把实际回溯秒数标出来（后端正常返回 59~61），一眼能确认口径确实是"往前 1 分钟"。
      note: tc?.windowSec != null ? `往前 ${tc.windowSec}s 窗口` : '',
    })
  }
  if (flags.heatExchangeEfficiency) {
    const hx = entry.heatExchangeEfficiency
    list.push({
      key: 'heatExchangeEfficiency',
      label: '换热效率',
      unit: '%',
      // 后端 value 已是百分数（水带走的热功率 ÷ 加热额定电功率 ×100），这里不再 ×100
      value: hx?.value != null ? fmt(hx.value, 1) : null,
      note: hx ? (hx.heatTransferredW ? `换热量 ${fmt(hx.heatTransferredW, 0)}W` : '') : HEAT_OFF_NOTE,
    })
  }
  if (flags.eerHeatBalance) {
    const bal = entry.eerHeatBalance
    list.push({
      key: 'eerHeatBalance',
      label: '热平衡（电功率去向）',
      unit: 'W',
      // 电阻加热器 COP 恒为 1，不再展示"能效比"；只给电功率去向分解：
      // 水带走的热功率 / 没被水带走的部分（散热+蓄热+测量误差）
      value: bal?.heatTransferredW != null
        ? `换热 ${fmt(bal.heatTransferredW, 0)} / 未带走 ${fmt(bal.heatLossW, 0)}`
        : null,
      note: bal ? '' : HEAT_OFF_NOTE,
    })
  }
  if (flags.heatingEfficiency) {
    const he = entry.heatingEfficiency
    list.push({
      key: 'heatingEfficiency',
      label: '加热效率',
      unit: '%',
      // 实际升温ΔT ÷ 理论升温ΔT ×100%（理论升温 = 加热额定功率全进水里能升多少度）
      value: he?.value != null ? fmt(he.value, 1) : null,
      note: he
        ? (he.actualRiseC != null ? `实际升温 ${fmt(he.actualRiseC, 2)}℃ / 理论 ${fmt(he.theoreticalRiseC, 2)}℃` : '')
        : HEAT_OFF_NOTE,
    })
  }
  if (flags.heatingRate) {
    const hr = entry.heatingRate
    list.push({
      key: 'heatingRate',
      label: '加热速度',
      unit: hr?.unit || '℃/min',
      // 2 位小数：跟温度变化率同为 ℃/min、同样用 1 分钟窗口，两张卡片位数保持一致。
      value: fmt(hr?.value, 2),
      // 后端要求"往前 1 分钟这整段都在加热"才给值（跟温度变化率共用同一个 60 秒窗口，
      // 只是多一条"持续加热"的门槛），所以措辞比上面三项更严格一点。
      note: hr?.windowSec != null ? `往前 ${hr.windowSec}s 窗口（持续加热）` : '持续加热中才计算',
    })
  }
  if (flags.flowPressureCurve) {
    const fc = entry.flowPressureCurve
    list.push({
      key: 'flowPressureCurve',
      label: '流量-压力曲线斜率',
      unit: fc?.unit || '',
      value: fmt(fc?.slope, 3),
    })
  }
  if (flags.cumulativeFlow) {
    list.push({ key: 'cumulativeFlow', label: '累计流量', unit: entry.cumulativeFlow?.unit || '', value: fmt(entry.cumulativeFlow?.value, 2) })
  }
  if (flags.averageVelocity) {
    list.push({ key: 'averageVelocity', label: '平均流速', unit: entry.averageVelocity?.unit || '', value: fmt(entry.averageVelocity?.value, 4) })
  }
  if (flags.waterLevel) {
    const t1 = entry.waterLevel?.tank1
    const t2 = entry.waterLevel?.tank2
    list.push({
      key: 'waterLevel',
      label: '液位（水箱1/水箱2）',
      unit: entry.waterLevel?.unit || 'cm',
      value: t1 && t2 ? `${fmt(t1.levelCm, 1)} / ${fmt(t2.levelCm, 1)}` : null,
    })
  }
  return list
})

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

// 根据"运行状态"字段的中文名（如"水泵"、"加热"）找到对应的运行时长数据，找不到匹配的
// pump/heater（未开启，或配置中心已删除对应的累计指标）返回 null。
function durationInfoFor(fieldLabel) {
  const { pump, heater } = switchDuration.value
  if (pump?.fieldLabel === fieldLabel) return pump
  if (heater?.fieldLabel === fieldLabel) return heater
  return null
}

function formatDuration(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return '--'
  const totalMin = Math.round(minutes)
  if (totalMin < 1) return '<1 分钟'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} 分钟`
  if (m === 0) return `${h} 小时`
  return `${h} 小时 ${m} 分钟`
}

// showLoading=false 用于 WebSocket 推送触发的后台静默刷新，不切换 loading，
// 避免刷新动画跟着推送频率一直闪烁；手动点“刷新数据”和首次进入页面仍然显示。
async function loadDashboard(showLoading = true) {
  if (showLoading) loading.value = true
  try {
    // 开关运行时长展示总开关关闭时不请求 /api/switch-duration，避免白跑一趟。
    const requests = [
      // chart:false —— 首页不渲染 LineBarCharts，用不上 chartSettings，跳过这份数据。
      api.get('/api/data', { params: { dataScope: '实时数据', chart: 'false' } }),
      api.get('/api/deviceData', { params: { currentPage: 1, pageSize: 100 } }),
      api.get('/api/mqtt/status'),
      api.get('/api/computed-metrics'),
      api.get('/api/current-temp'),
    ]
    if (switchDurationEnabled.value) requests.push(api.get('/api/switch-duration'))

    const [dataResult, deviceResult, mqttResult, computedResult, currentTempResult, switchDurationResult] = await Promise.allSettled(requests)
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
    if (currentTempResult.status === 'fulfilled') {
      const val = currentTempResult.value.data?.data
      currentTemp.value = val == null ? null : Number(val)
    }
    if (switchDurationEnabled.value && switchDurationResult?.status === 'fulfilled') {
      switchDuration.value = switchDurationResult.value.data?.data || { pump: null, heater: null }
    }
  } finally {
    if (showLoading) loading.value = false
  }
}

// WebSocket 推送触发的静默刷新要节流：设备大约每秒上报一条，而 loadDashboard 一次要打
// 5~6 个接口，不节流就是每秒 5~6 个请求压在后端和数据库上（连接池只有 10 个连接）。
// 这里是"首次立即刷新 + 窗口内合并"：第一条推送马上刷新，窗口期内再来的推送只记一个
// 待刷新标记，窗口结束时补刷一次，保证最后一条推送的数据不会被丢掉。
const WS_REFRESH_INTERVAL_MS = 2000

function scheduleWsRefresh() {
  if (wsRefreshTimer) {
    wsRefreshPending = true
    return
  }
  loadDashboard(false)
  wsRefreshTimer = setTimeout(() => {
    wsRefreshTimer = null
    if (wsRefreshPending) {
      wsRefreshPending = false
      scheduleWsRefresh()
    }
  }, WS_REFRESH_INTERVAL_MS)
}

onMounted(async () => {
  await systemStore.load()
  loadDashboard()
  connect()
  unsubscribeStatus = wsOn('device_status', (payload) => {
    if (Array.isArray(payload)) deviceStatuses.value = payload
  })
  unsubscribeSensor = wsOn('sensor_data', () => scheduleWsRefresh())
  unsubscribeError = wsOn('error_data', () => scheduleWsRefresh())
})

onUnmounted(() => {
  unsubscribeStatus?.()
  unsubscribeSensor?.()
  unsubscribeError?.()
  if (wsRefreshTimer) {
    clearTimeout(wsRefreshTimer)
    wsRefreshTimer = null
  }
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
.gauge-section { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin: 16px 0; }
.gauge-card { border: 1px solid #e5e7eb; border-radius: 14px; background: #fff; box-shadow: 0 6px 20px rgba(15, 23, 42, .05); padding: 12px; height: 220px; }
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
.duration-hint { margin-top: 6px; color: #64748b; font-size: 12px; line-height: 1.5; }
.updated-at { margin-top: 18px; color: #64748b; font-size: 13px; }

/* ===== 需要计算的数据 ===== */
.computed-section { margin: 16px 0 0; }
.computed-panel { min-height: 0; }
.computed-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
.computed-card { padding: 16px; border-radius: 12px; background: #f8fafc; border-left: 3px solid #0ea5e9; }
.computed-card-label { color: #64748b; font-size: 13px; }
.computed-card-value { margin-top: 8px; font-size: 24px; font-weight: 700; color: #0f172a; }
.computed-card-value .unit { margin-left: 6px; font-size: 13px; font-weight: 400; color: #64748b; }
.computed-card-value .muted { color: #cbd5e1; font-weight: 400; }
.computed-card-note { margin-top: 6px; color: #e6a23c; font-size: 12px; }

.status-list { display: grid; gap: 10px; }
.status-row { display: grid; grid-template-columns: 12px 1fr auto; align-items: center; gap: 9px; padding: 12px; border-radius: 10px; background: #f8fafc; }
.status-dot { width: 10px; height: 10px; border-radius: 50%; background: #94a3b8; }
.status-dot.active { background: #10b981; box-shadow: 0 0 0 4px #d1fae5; }

@media (max-width: 1050px) { .metric-grid { grid-template-columns: repeat(2, 1fr); } .dashboard-grid { grid-template-columns: 1fr; } }
@media (max-width: 700px) { .hero-panel { align-items: flex-start; flex-direction: column; } .metric-grid, .reading-grid { grid-template-columns: 1fr; } }
</style>
