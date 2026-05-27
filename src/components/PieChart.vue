<template>
  <div class="pie-chart-wrapper">
    <h3 class="chart-title">故障类型分布</h3>
    <div class="pie-chart-container" ref="piechart"></div>
    <div class="legend-container" v-if="chartData.length > 0">
      <div 
        v-for="(item, index) in chartData" 
        :key="index" 
        class="legend-item"
      >
        <span 
          class="legend-color" 
          :style="{ backgroundColor: colors[index % colors.length] }"
        ></span>
        <span class="legend-text">{{ item.name }}</span>
        <span class="legend-value">{{ item.value }} ({{ item.percent }}%)</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import * as echarts from 'echarts'

const piechart = ref(null)
let mychart = null

const colors = ['#2d4b8c', '#5b8dd9', '#91b3fa', '#e8f0fb', '#7cb5ec', '#434348', '#90ed7d', '#f7a35c']

const props = defineProps({
  data: { type: Array, default: () => [] }
})

const handleResize = () => {
  mychart?.resize()
}

const chartData = ref([])

const initChart = async () => {
  await nextTick()

  if (!piechart.value || piechart.value.offsetWidth === 0) {
    setTimeout(initChart, 50)
    return
  }

  if (!mychart) {
    mychart = echarts.init(piechart.value)
  }

  updateChart(props.data)
}

const updateChart = (source) => {
  try {
    if (!mychart) {
      return
    }

    if (!source || source.length === 0) {
      mychart.setOption({
        title: {
          text: '暂无数据',
          left: 'center',
          top: 'middle',
          textStyle: { color: '#999', fontSize: 14 }
        },
        series: []
      })
      chartData.value = []
      return
    }

    const total = source.reduce((sum, item) => sum + item.count, 0)
    
    const pieData = source.map(item => ({
      name: item.type || '未知故障',
      value: item.count,
      percent: total > 0 ? ((item.count / total) * 100).toFixed(1) : '0'
    }))

    chartData.value = pieData

    mychart.setOption({
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} ({d}%)'
      },
      series: [
        {
          name: '故障类型',
          type: 'pie',
          radius: ['40%', '70%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 8,
            borderColor: '#fff',
            borderWidth: 2
          },
          label: {
            show: false,
            position: 'center'
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 18,
              fontWeight: 'bold'
            }
          },
          labelLine: {
            show: false
          },
          data: pieData.map((item, index) => ({
            ...item,
            itemStyle: { color: colors[index % colors.length] }
          }))
        }
      ]
    }, true)
  } catch (err) {
    console.error('饼图更新失败：', err)
  }
}

watch(
  () => props.data,
  (newData) => {
    if (mychart) {
      updateChart(newData)
    }
  },
  { deep: true }
)

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
.pie-chart-wrapper {
  background: white;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
  padding: 24px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.chart-title {
  font-size: 16px;
  font-weight: 600;
  color: #334155;
  margin: 0 0 20px 0;
  padding-bottom: 12px;
  border-bottom: 1px solid #f1f5f9;
}

.pie-chart-container {
  flex: 1;
  min-height: 200px;
}

.legend-container {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f1f5f9;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  flex-shrink: 0;
}

.legend-text {
  font-size: 13px;
  color: #64748b;
  flex-shrink: 0;
}

.legend-value {
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}
</style>