<template>
  <div>
    <div class="card-chart-wrapper">
      <div class="card-container-wrapper">
        <CardContainer
          :data="store.sensorData?.processedData || []"
          :fieldUnits="store.fieldUnits"
        />
      </div>

      <div class="chart-wrapper">
        <LineBarCharts :data="data" />
      </div>
    </div>
  </div>
</template>
<script setup>
import LineBarCharts from '@/components/LineBarCharts.vue'
import { SensorStore } from '@/stores/SensorStore'
import { computed, onMounted, onUnmounted } from 'vue'
import CardContainer from '@/components/CardContainer.vue'
import { connect as wsConnect, on as wsOn, close as wsClose } from '@/utils/websocket'

const store = SensorStore()

let wsUnsubscribe = null

const reloadData = async (showLoading = true) => {
  await store.fetchData('实时数据')
  console.log('数据加载完成：', store.sensorData)
}

const data = computed(() => {
  const result = store.sensorData?.processedData
  console.log('computed data:', result)
  return result
})
onMounted(async () => {
  await reloadData()

  // 连接 WebSocket，接收实时推送
  wsConnect({
    onMessage: (data) => {
      if (data.type === 'sensor_data') {
        reloadData(false)
      }
    }
  })

  wsUnsubscribe = wsOn('sensor_data', () => {
    reloadData(false)
  })
})

onUnmounted(() => {
  if (wsUnsubscribe) {
    wsUnsubscribe()
    wsUnsubscribe = null
  }
  wsClose()
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
