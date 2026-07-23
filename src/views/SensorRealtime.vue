<!--
 * 【文件职责】
 * 业务页面，负责组合数据、状态和用户操作，呈现完整功能界面。
 * 【配置中心关联】
 * 页面通过状态仓库读取配置中心；场景开关保存后，相关显示与交互按最新配置更新。
 * -->
<template>
  <div>
    <div class="card-chart-wrapper">
      <div class="card-container-wrapper">
        <CardContainer
          :data="store.sensorData?.processedData || []"
          :fieldUnits="store.fieldUnits"
        />
      </div>

      <div class="chart-wrapper" v-if="chartsEnabled">
        <LineBarCharts :data="data" :settings="store.sensorData?.chartSettings || {}" />
      </div>
    </div>
  </div>
</template>
<script setup>
import LineBarCharts from '@/components/LineBarCharts.vue'
import { SensorStore } from '@/stores/SensorStore'
import { computed, onMounted, onUnmounted } from 'vue'
import CardContainer from '@/components/CardContainer.vue'
import { useSystemConfigStore } from '@/stores/SystemConfigStore'

const store = SensorStore()
const systemStore = useSystemConfigStore()
let refreshTimer = null

const reloadData = async (showLoading = true) => {
  await store.fetchData('实时数据')
  console.log('数据加载完成：', store.sensorData)
}

const data = computed(() => {
  const result = store.sensorData?.processedData
  console.log('computed data:', result)
  return result
})
const chartsEnabled = computed(() => systemStore.config.ENABLE_CHARTS !== false)

const startAutoRefresh = () => {
  if (refreshTimer) clearInterval(refreshTimer)
  const interval = Number(systemStore.config.REALTIME_REFRESH_INTERVAL)
  if (interval > 0) refreshTimer = setInterval(() => reloadData(false), interval)
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
