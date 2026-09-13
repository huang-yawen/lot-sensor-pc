<!--
 * 【文件职责】
 * 自动判定结果的两张趋势图：上面是置信度随判定时间的折线，下面是结论随时间的
 * 分色柱状。结论分布饼图不在这里，复用现成的 PieChart.vue，由页面直接摆。
 * 【配置中心关联】
 * 不读配置中心；画多少条、多久来一条由 service/autoJudgment/config.js 的
 * bufferSize / intervalMs 决定，数据由父组件传入。
 *
 * ══════════════ 赛场要改什么，改哪里 ══════════════
 * | 赛题/现场情况                      | 改这里                                      |
 * |-----------------------------------|--------------------------------------------|
 * | 置信度不是 0~1，是 0~100 的百分数    | 下面 CONFIDENCE_MAX 改成 100               |
 * | 判定服务压根不给置信度              | CONFIDENCE_MAX 不用管，折线会是空的，        |
 * |                                   | 想省地方就把 template 里第一个 chart-block 删掉 |
 * | 图太矮/太高看不清                   | 最底下样式 .chart-container 的 height       |
 * | 横轴只要时:分，不要秒                | axisLabels() 里 slice(11) 改 slice(11, 16)  |
 * | 横轴要带日期（跑很久、跨小时看趋势）    | axisLabels() 里 slice(11) 整个去掉          |
 * | 结论柱子太细/太粗                   | renderConclusion() 里 barMaxWidth          |
 * 改完前端要重新打包（npm run build）才生效，改后端 config.js 才是重启后端。
 * -->
<template>
  <div class="judgment-charts">
    <div class="chart-block">
      <h3 class="chart-title">置信度趋势</h3>
      <div class="chart-container" ref="confidenceRef"></div>
    </div>
    <div class="chart-block">
      <h3 class="chart-title">结论时间轴</h3>
      <div class="chart-container" ref="conclusionRef"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import * as echarts from '@/utils/echarts'

const props = defineProps({
  // 自动判定结果，按时间正序（旧的在前），每项形如
  // { time, ids, conclusion, confidence, status, error }
  data: { type: Array, default: () => [] }
})

/**
 * 置信度折线的纵轴上限。默认 1，因为多数判定服务给的是 0~1 的小数。
 * 【赛场注意】如果现场服务返回的是 0~100 的百分数，这里不改成 100，折线会全部
 * 顶格贴在图顶、看不出任何变化——而且不会报错，很容易被当成"图表坏了"。
 * 判断方法：看页面表格的"置信度"列，值明显大于 1 就该改成 100。
 */
const CONFIDENCE_MAX = 1

const confidenceRef = ref(null)
const conclusionRef = ref(null)
let confidenceChart = null
let conclusionChart = null

/** 判定时间只取 HH:mm:ss 做横轴标签——自动模式几秒一条，带上日期反而挤成一团。 */
const axisLabels = () => props.data.map(item => String(item.time || '').slice(11) || item.time || '')

/** 失败的那一轮没有结论，单独归成一类，让它在图上也能看出来，而不是凭空断档。 */
const conclusionOf = (item) => item.conclusion ?? (item.status === 'failed' ? '判定失败' : '未知')

const handleResize = () => {
  confidenceChart?.resize()
  conclusionChart?.resize()
}

/** 置信度折线：y 轴 0~CONFIDENCE_MAX，失败的那一轮是 null，折线在那里断开，
 *  比补 0 好——补 0 会被误读成"服务判定出置信度为 0"（那是合法值，不是失败）。 */
function renderConfidence() {
  if (!confidenceChart) return
  confidenceChart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 30, bottom: 50 },
    xAxis: {
      type: 'category',
      data: axisLabels(),
      axisLabel: { rotate: 45, fontSize: 11, color: '#64748b' }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: CONFIDENCE_MAX,
      axisLabel: { fontSize: 11, color: '#64748b' }
    },
    series: [{
      name: '置信度',
      type: 'line',
      smooth: true,
      connectNulls: false,
      showSymbol: true,
      symbolSize: 6,
      data: props.data.map(item => item.confidence),
      lineStyle: { width: 2 },
      itemStyle: { color: '#3b82f6' }
    }]
  }, { notMerge: true })
}

/**
 * 结论时间轴：每个时间点一根满高柱子，颜色代表当时的结论。
 * 做法是每种结论一个 series，堆叠在一起，某时间点属于该结论就填 1、否则填 0，
 * 于是每个时间点总高度恒为 1，一眼能看出结论在什么时候发生了切换。
 * y 轴本身没有量纲，所以刻度和轴线都隐藏掉。
 */
function renderConclusion() {
  if (!conclusionChart) return
  const kinds = [...new Set(props.data.map(conclusionOf))]
  conclusionChart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      // 堆叠里只有命中的那个 series 值为 1，其余都是 0，全列出来会刷屏，只显示命中的那条。
      formatter: (params) => {
        const hit = params.find(p => p.value === 1)
        return `${params[0]?.axisValue ?? ''}<br/>${hit ? hit.marker + hit.seriesName : '无结论'}`
      }
    },
    legend: { bottom: 0, textStyle: { fontSize: 12, color: '#64748b' } },
    grid: { left: 50, right: 20, top: 30, bottom: 60 },
    xAxis: {
      type: 'category',
      data: axisLabels(),
      axisLabel: { rotate: 45, fontSize: 11, color: '#64748b' }
    },
    yAxis: {
      type: 'value',
      max: 1,
      axisLabel: { show: false },
      axisLine: { show: false },
      splitLine: { show: false }
    },
    series: kinds.map(kind => ({
      name: kind,
      type: 'bar',
      stack: 'conclusion',
      barMaxWidth: 28,
      data: props.data.map(item => (conclusionOf(item) === kind ? 1 : 0))
    }))
  }, { notMerge: true })
}

const initCharts = async () => {
  await nextTick()
  // 页面首次渲染或图表在隐藏的 tab 里时宽度为 0，这时 init 出来的图尺寸是错的，
  // 等下一帧再试（跟项目里 PieChart.vue 的处理方式一致）。
  if (!confidenceRef.value || confidenceRef.value.offsetWidth === 0) {
    setTimeout(initCharts, 50)
    return
  }
  if (!confidenceChart) confidenceChart = echarts.init(confidenceRef.value)
  if (!conclusionChart) conclusionChart = echarts.init(conclusionRef.value)
  renderConfidence()
  renderConclusion()
}

watch(() => props.data, () => {
  renderConfidence()
  renderConclusion()
}, { deep: true })

onMounted(() => {
  initCharts()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  confidenceChart?.dispose()
  conclusionChart?.dispose()
  confidenceChart = null
  conclusionChart = null
})
</script>

<style scoped>
.judgment-charts { display: flex; flex-direction: column; gap: 16px; }
.chart-block {
  background: white;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
  padding: 12px 8px;
}
.chart-title { margin: 0 0 4px 16px; font-size: 15px; font-weight: 600; color: #334155; text-align: left; }
.chart-container { width: 100%; height: 260px; }
</style>
