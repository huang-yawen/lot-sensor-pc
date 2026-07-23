<!--
 * 【文件职责】
 * 可复用界面组件，负责展示数据或组织页面布局。
 * 【配置中心关联】
 * 不持久化配置中心；需要展示场景信息时由父组件或状态仓库传入。
 * -->
<template>
  <div class="pie-chart-wrapper">
    <div class="pie-chart-container" ref="piechart"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import * as echarts from 'echarts'

const piechart = ref(null)
let mychart = null

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
      title: {
        text: '故障类型分布',
        left: 'center',
        bottom: 0,
        textStyle: { color: '#64748b', fontSize: 14, fontWeight: 500 }
      },
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} ({d}%)'
      },
      legend: {
        orient: 'horizontal',
        bottom: 28,
        textStyle: { fontSize: 12, color: '#64748b' }
      },
      series: [
        {
          name: '故障类型',
          type: 'pie',
          radius: ['40%', '65%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 6,
            borderColor: '#fff',
            borderWidth: 2
          },
          label: {
            show: false
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
          data: pieData
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
  height: 100%;
  display: flex;
  flex-direction: column;
}

.pie-chart-container {
  flex: 1;
  min-height: 200px;
}

</style>
