<!--
 * 【文件职责】传感器实时数据页面。
 * 跟传感器汇总数据（SensorHistory）、行为实时/汇总数据页面统一使用 usePaginationStore
 * 和 /api/dataByType 接口，通过 metricScope='realtime' 区分实时模式：
 *   - 用 show_realtime 过滤派生指标（跟原 getDashboardData 的实时返回一致）
 *   - 返回纯数值不拼接单位（卡片和图表组件需要纯数值 + 单独的 fieldUnits）
 * 【配置中心关联】
 * 页面通过 SystemConfigStore 读取配置中心；REALTIME_REFRESH_INTERVAL 控制自动刷新间隔。
 * -->
<template>
  <div>
    <div class="card-chart-wrapper">
      <div class="card-container-wrapper">
        <CardContainer
          :data="store.paginationData || []"
          :fieldUnits="store.fieldUnits"
        />
      </div>

      <div class="chart-wrapper" v-if="chartsEnabled">
        <LineBarCharts :data="data" :settings="store.chartSettings || {}" />
      </div>
    </div>
  </div>
</template>
<script setup>
import LineBarCharts from '@/components/LineBarCharts.vue'
import { usePaginationStore } from '@/stores/PaginationStore.js'
import { computed, onMounted, onUnmounted } from 'vue'
import CardContainer from '@/components/CardContainer.vue'
import { useSystemConfigStore } from '@/stores/SystemConfigStore'

// 跟传感器汇总数据页面（SensorHistory）使用同一个 store（usePaginationStore）。
// 区别在于：实时页传 dataScope='实时数据'（只取最新窗口 5 条）+ metricScope='realtime'
// （用 show_realtime 过滤指标 + 不拼单位），汇总页 dataScope 留空（全部数据）+ 不传
// metricScope（默认 history 模式 + 拼单位给表格用）。
const store = usePaginationStore()
const systemStore = useSystemConfigStore()
let refreshTimer = null

// metricScope='realtime' 让后端按 show_realtime 过滤派生指标，且返回纯数值不拼单位。
// dataScope='实时数据' 让后端只返回最新窗口内（最新 5 条）的记录。
const reloadData = async (silent = false) => {
  await store.fetchPaginationData({
    type: 'sensor',
    dataScope: '实时数据',
    metricScope: 'realtime',
    currentPage: 1,
    pageSize: systemStore.config.DEFAULT_PAGE_SIZE || 5,
  }, { silent })
}

const data = computed(() => store.paginationData || [])
// 接口按 id DESC（最新在前）最多返回 5 条；LineBarCharts 组件内部会自动反转成
// 时间递增顺序，卡片和图表都直接用原始顺序的 data 即可。
const chartsEnabled = computed(() => systemStore.config.ENABLE_CHARTS !== false)

const startAutoRefresh = () => {
  if (refreshTimer) clearInterval(refreshTimer)
  const interval = Number(systemStore.config.REALTIME_REFRESH_INTERVAL)
  if (interval > 0) refreshTimer = setInterval(() => reloadData(true), interval)
}

onMounted(async () => {
  await systemStore.load()
  await reloadData()
  startAutoRefresh()
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = null
})
</script>

<style>
.card-chart-wrapper {
  display: flex;
  gap: 10px;
}

.card-container-wrapper {
  flex: 1;
}

.chart-wrapper {
  flex: 2;  /* 图表占比大一点 */
  min-width: 300px; /* 防止图表太窄 */
}
</style>
