<template>
  <div>
    <h3 style="text-align:left;margin-left:60px;color:black;">折线图与柱状图</h3>
    <div class="chart-container" ref="linechart"></div>
  </div>
</template>

<script setup>

import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import * as echarts from 'echarts'

/**
 * @description ECharts 实例引用
 */
const linechart = ref(null)

/**
 * @description ECharts 图表实例对象
 */
let mychart = null

/**
 * @description 组件属性定义
 * @property {Array} data - 图表数据源
 * @property {Number} pageSize - 显示数据条数，默认5条
 */
const props = defineProps({
  data: { type: Array, default: () => [] },
  pageSize: { type: Number, default: 5 }
})

/**
 * @description 处理窗口 resize 事件，自动调整图表尺寸

 */
const handleResize = () => {
  mychart?.resize()
}

/**
 * @description 初始化 ECharts 图表
 * @returns {void}
 */
const initChart = async () => {
  await nextTick()

  // 避免容器宽度为 0 的情况，递归重试直到容器就绪
  if (!linechart.value || linechart.value.offsetWidth === 0) {
    setTimeout(initChart, 50)
    return
  }

  // 创建图表实例（确保只创建一次）
  if (!mychart) {
    mychart = echarts.init(linechart.value)
  }

  // 更新图表数据
  updateChart(props.data)
}

/**
 * @description 更新图表数据和配置
 * @param {Array} source - 原始数据源
 * @returns {void}
 */
const updateChart = (source) => {
  try {
    console.log('updateChart called with source:', source)
    
    // 截取指定条数的数据
    const json = source?.slice(0, props.pageSize) || []
    
    console.log('processed json:', json)

    // 图表实例未创建时直接返回
    if (!mychart) {
      console.log('mychart not ready yet')
      return
    }

    // 处理空数据情况
    if (!source || json.length === 0) {
      console.log('empty data, showing "暂无数据"')
      mychart.setOption({
        title: {
          text: '暂无数据',
          left: 'center',
          top: 'middle',
          textStyle: { color: '#999', fontSize: 14 }
        },
        tooltip: {},
        legend: {},
        xAxis: {},
        yAxis: {},
        series: []
      }, true)
      return
    }

    // 获取数据字段（排除指定的关键字段）
    const elemKeys = Object.keys(json[0])
    const exclude = ['id', '设备编号', '数据类型', '创立时间', '采集时间','储运箱ID','物体编号']
    const fields = elemKeys.filter(k => !exclude.includes(k))

    // 处理时间数据，格式化为可读字符串
    const times = json.map(item => {
      if (item['创立时间']) {
        return new Date(item['创立时间']).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        })
      }
      return '未知时间'
    })

    // 构建 series 数据，每个字段对应一条折线
    const series = fields.map(field => ({
      name: field,
      type: 'line',
      data: json.map(item => {
        const raw = item[field]
        if (!raw) return 0
        // 提取纯数字并转换为数值类型
        const num = parseFloat(raw.toString().replace(/[^\d.-]/g, ''))
        return isNaN(num) ? 0 : num
      })
    }))

    // 设置图表配置项（使用 notMerge: true 完全替换配置，确保 restore 正常工作）
    mychart.setOption({
      tooltip: { 
        trigger: 'axis',
        formatter: function(params) {
          let result = `<div style="font-weight:bold;margin-bottom:8px;">${params[0].axisValueLabel}</div>`
          params.forEach(item => {
            result += `
              <div style="display:flex;justify-content:space-between;min-width:120px;">
                <span>${item.marker}${item.seriesName}</span>
                <span style="margin-left:15px;">${item.value}</span>
              </div>
            `
          })
          return result
        }
      },
      legend: { 
        data: fields,
        top:  '-2px'  // 图例距离顶部的距离
      },
      toolbox: {
        feature: {
          magicType: { type: ['line', 'bar'] },
          restore: {},
          dataView: {},
          saveAsImage: {}
        }
      },
      grid: {
        bottom: 80  // 增加底部留白，给图例和x轴标签留出空间
      },
      xAxis: {
        type: 'category',
        data: times,
        axisLabel: { rotate: 20, interval: 0 }
      },
      yAxis: { type: 'value' },
      series
    }, true)
  } catch (err) {
    console.error('图表更新失败：', err)
  }
}

/**
 * @description 监听数据变化，自动更新图表
 */
watch(
  () => [props.data, props.pageSize],
  ([newData]) => {
    if (mychart) {
      updateChart(newData)
    }
  },
  { deep: true }
)

/**
 * @description 组件挂载时初始化图表并绑定 resize 事件
 */
onMounted(() => {
  window.addEventListener('resize', handleResize)
  initChart()
})

/**
 * @description 组件卸载时清理图表实例和事件绑定
 */
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (mychart) {
    mychart.dispose()
    mychart = null
  }
})
</script>

<style scoped>
.chart-container {
  width: 100%;
  height: 320px;
  border-radius: 4px;
  margin-top:60px;
}
</style>
