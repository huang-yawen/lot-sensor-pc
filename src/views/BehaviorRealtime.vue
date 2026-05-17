<template>
  <div>
    <div class="card-chart-wrapper">
      <div class="card-container-wrapper">
        <CardContainer :data="data || []" />
      </div>

      <div class="chart-wrapper">
        <LineBarCharts :data="data || []" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import CardContainer from '@/components/CardContainer.vue'
import LineBarCharts from '@/components/LineBarCharts.vue'
import { PaginationStore } from '@/stores/PaginationStore.js'

const store = PaginationStore()
const online = '实时数据'

const data = computed(() => store.paginationData || [])

onMounted(async () => {
  await store.fetchPaginationData({
    type: 'behavior',
    online: online
  })
  console.log("BehaviorRealtime data:", store.paginationData)
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
