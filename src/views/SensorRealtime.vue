<template>
    <div>
        <div class="card-chart-wrapper">
            <div class="card-container-wrapper">
                <!-- <CardContainer :data="store.sensorData?.proccessData || []" /> -->
            </div>

            <div class="chart-wrapper">
                <LineBarCharts :data="data" title="传感器实时数据" />
            </div>
        </div>
    </div>
</template>
<script setup>
import LineBarCharts from '@/components/LineBarCharts.vue'
import { sensorStore } from '@/stores/SensorStore'
import { computed, onMounted } from 'vue'
// import CardContainer from '@/components/CardContainer.vue'

const store = sensorStore()
const data = computed(() => {
  const result = store.sensorData?.proccessData
  console.log('computed data:', result)
  return result
})
onMounted(async () => {
    await store.fetchData('实时数据')
    console.log('数据加载完成：', store.sensorData)
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