<!--
 * 【文件职责】
 * 可复用界面组件，通用仪表盘，展示单个数值的当前状态（如实时水温）。
 * 【配置中心关联】
 * 不持久化配置中心；数值、量程、单位均由父组件传入。
 * -->
<template>
  <div class="gauge-chart-wrapper">
    <div class="gauge-chart-container" ref="gaugechart"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import * as echarts from '@/utils/echarts'

const gaugechart = ref(null)
let mychart = null

const props = defineProps({
  value: { type: Number, default: null },
  title: { type: String, default: '' },
  unit: { type: String, default: '' },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
})

const handleResize = () => {
  mychart?.resize()
}

const initChart = async () => {
  await nextTick()

  if (!gaugechart.value || gaugechart.value.offsetWidth === 0) {
    setTimeout(initChart, 50)
    return
  }

  if (!mychart) {
    mychart = echarts.init(gaugechart.value)
  }

  updateChart(props.value)
}

const updateChart = (val) => {
  if (!mychart) return

  mychart.setOption({
    series: [
      {
        type: 'gauge',
        min: props.min,
        max: props.max,
        progress: { show: true, width: 12 },
        axisLine: { lineStyle: { width: 12 } },
        axisTick: { show: false },
        splitLine: { length: 10, lineStyle: { width: 2 } },
        axisLabel: { fontSize: 10 },
        pointer: { show: true },
        title: { fontSize: 13, offsetCenter: [0, '70%'] },
        detail: {
          valueAnimation: true,
          fontSize: 22,
          offsetCenter: [0, '40%'],
          formatter: (v) => (val == null ? '--' : `${v}${props.unit}`),
        },
        data: [{ value: val == null ? 0 : val, name: props.title }],
      },
    ],
  }, true)
}

watch(() => props.value, (val) => {
  if (mychart) updateChart(val)
})

onMounted(() => {
  window.addEventListener('resize', handleResize)
  initChart()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (mychart) {
    mychart.dispose()
    mychart = null
  }
})
</script>

<style scoped>
.gauge-chart-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.gauge-chart-container {
  flex: 1;
  min-height: 180px;
}
</style>
