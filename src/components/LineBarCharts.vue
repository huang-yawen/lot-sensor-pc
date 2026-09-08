<!--
 * 【文件职责】
 * 可复用界面组件，负责展示数据或组织页面布局。
 * 【配置中心关联】
 * 不持久化配置中心；需要展示场景信息时由父组件或状态仓库传入。
 * -->
<template>
  <div>
    <h3 style="text-align:left;margin-left:60px;color:black;">折线图与柱状图</h3>
    <div class="chart-container" ref="linechart"></div>
  </div>
</template>

<script setup>

import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import * as echarts from 'echarts'
import { useDisplayStore } from '@/stores/useDisplayStore'

/**
 * @description ECharts 实例引用
 */
const linechart = ref(null)

/**
 * @description ECharts 图表实例对象
 */
let mychart = null

/**
 * @description 用户通过工具栏 magicType 手动切换后的图表类型（'line'/'bar'）。
 * 实时页面每隔 REALTIME_REFRESH_INTERVAL 会带着新数据重建一次图表（notMerge: true），
 * 重建时必须沿用这个值，否则每次刷新都会把手动切换的柱状图重置回默认折线图。
 */
const currentChartType = ref(null)

/**
 * @description 组件属性定义
 * @property {Array} data - 图表数据源，需按接口原始顺序传入（id DESC，最新在前）；
 *   组件内部会自动截取最新 pageSize 条并反转成时间递增顺序，调用方不需要自己 reverse。
 * @property {Number} pageSize - 显示数据条数，默认5条
 */
const props = defineProps({
  data: { type: Array, default: () => [] },
  pageSize: { type: Number, default: 5 },
  // 由公式指标配置生成：{ 指标显示名: { visible,type,yAxis,color,min,max,unit } }
  settings: { type: Object, default: () => ({}) },
  // 行为数据（0/1 开关状态）专用：true 时 y 轴刻度线只显示 0 和 1。
  binary: { type: Boolean, default: false }
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
    // 记录用户手动切换的图表类型，供刷新重建时沿用，避免被重置回默认折线图。
    mychart.on('magictypechanged', (params) => {
      currentChartType.value = params.currentType
    })
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
    
    // 调用方传入的数据统一按接口原始顺序（id DESC，最新在前）。先截取最新 pageSize 条，
    // 再反转成时间递增顺序，保证图表横坐标从左到右时间变大，不需要调用方各自处理。
    const json = (source?.slice(0, props.pageSize) || []).reverse()
    
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
    const fields = elemKeys.filter(k => !exclude.includes(k) && props.settings[k]?.visible !== false)

    // 处理时间数据，格式化为可读字符串
    const displayStore = useDisplayStore()
    const times = json.map(item => {
      if (item['创立时间']) {
        return displayStore.formatTime(item['创立时间'])
      }
      return '未知时间'
    })

    // 构建 series 数据，每个字段对应一条折线
    const series = fields.map(field => {
      const setting = props.settings[field] || {}
      return {
      name: field,
      type: currentChartType.value || setting.type || 'line',
      yAxisIndex: setting.yAxis === 'right' ? 1 : 0,
      itemStyle: setting.color ? { color: setting.color } : undefined,
      lineStyle: setting.color ? { color: setting.color } : undefined,
      data: json.map(item => {
        const raw = item[field]
        if (raw == null || raw === '') return 0
        const text = raw.toString().trim()
        // 配置中心 value_map 可能把数据库原始值换成了文字（如 开/关/自动/手动），
        // 图表要按数值画图，这里先按常见文字换回数字，换不了再走数字提取。
        if (['开', '自动', 'on', 'true'].includes(text)) return 1
        if (['关', '手动', 'off', 'false'].includes(text)) return 0
        // 提取纯数字并转换为数值类型
        const num = parseFloat(text.replace(/[^\d.-]/g, ''))
        return isNaN(num) ? 0 : num
      })
    }})

    const axisConfig = (side) => {
      const configured = fields.map(field => props.settings[field]).filter(setting => setting?.yAxis === side)
      const units = [...new Set(configured.map(setting => setting.unit).filter(Boolean))]
      const min = configured.find(setting => setting.min != null)?.min
      const max = configured.find(setting => setting.max != null)?.max
      return {
        type: 'value',
        name: units.join('/'),
        position: side,
        min: props.binary ? 0 : (min ?? undefined),
        max: props.binary ? 1 : (max ?? undefined),
        interval: props.binary ? 1 : undefined,
      }
    }

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
      yAxis: [axisConfig('left'), axisConfig('right')],
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
  () => [props.data, props.pageSize, props.settings],
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
