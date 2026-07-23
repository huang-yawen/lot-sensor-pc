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
        <CardContainer :data="data || []" />
      </div>

      <div class="chart-wrapper" v-if="chartsEnabled">
        <LineBarCharts :data="data || []" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import CardContainer from '@/components/CardContainer.vue'
import LineBarCharts from '@/components/LineBarCharts.vue'
import { PaginationStore } from '@/stores/PaginationStore.js'
import { transformBehaviorList } from '@/utils/fieldTransform'
import { useSystemConfigStore } from '@/stores/SystemConfigStore'

const store = PaginationStore()
const systemStore = useSystemConfigStore()
const online = '实时数据'
let refreshTimer = null

const data = computed(() => transformBehaviorList(store.paginationData || []))
const chartsEnabled = computed(() => systemStore.config.ENABLE_CHARTS !== false)

const reloadData = () => store.fetchPaginationData({
  type: 'behavior',
  online: online,
  pageSize: systemStore.config.DEFAULT_PAGE_SIZE || 5,
})

onMounted(async () => {
  await systemStore.load()
  await reloadData()
  const interval = Number(systemStore.config.REALTIME_REFRESH_INTERVAL)
  if (interval > 0) refreshTimer = setInterval(reloadData, interval)
  console.log("BehaviorRealtime data:", store.paginationData)
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
  flex: 2;
  min-width: 300px;
}
</style>
