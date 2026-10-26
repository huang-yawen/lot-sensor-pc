<!--
 * 【文件职责】组合数据/实时数据页面：设备把传感器字段和行为字段放在**同一条消息**里上报，
 * 这个页面把两者渲染在同一组卡片和同一条曲线里（后端 t_scene_data 一行就是一条消息）。
 * 【配置中心关联】
 * 页面通过 SystemConfigStore 读取配置中心。实时更新靠 WebSocket 推送：设备侧一条消息，
 * 后端把同一条 payload 同时广播成 sensor_data / behavior_data 两种类型（见 app.js），
 * 所以这里只订阅 sensor_data 一种即可拿到全部字段，不需要前端做配对。
 * 【配置开关】SideBar 里用 SHOW_COMBINED_PAGE 控制菜单是否显示（见 config/appSettings.js）。
 * -->
<template>
  <div>
    <div class="card-chart-wrapper">
      <div class="card-container-wrapper">
        <CardContainer
          :data="store.paginationData || []"
          :fieldUnits="store.fieldUnits"
        />
      </div>

      <div class="chart-wrapper" v-if="chartsEnabled">
        <LineBarCharts :data="data" :settings="store.chartSettings || {}" />
      </div>
    </div>
  </div>
</template>
<script setup>
import LineBarCharts from '@/components/LineBarCharts.vue'
import { useCombinedStore } from '@/stores/useCombinedStore'
import { computed, onMounted, onUnmounted } from 'vue'
import { connect, on as wsOn } from '@/utils/websocket'
import CardContainer from '@/components/CardContainer.vue'
import { useSystemConfigStore } from '@/stores/useSystemConfigStore'

const store = useCombinedStore()
const systemStore = useSystemConfigStore()
let unsubscribeWs = null

// metricScope='realtime' 让后端按 show_realtime 过滤派生指标，且返回纯数值不拼单位
// （卡片/图表需要纯数值 + 单独的 fieldUnits）。
// dataScope='实时数据' 让后端只返回最新窗口内（两侧字段都有的最新 5 条）的记录。
const reloadData = async (silent = false) => {
  await store.fetchCombinedData({
    dataScope: '实时数据',
    metricScope: 'realtime',
    currentPage: 1,
    pageSize: systemStore.config.DEFAULT_PAGE_SIZE || 5,
  }, { silent })
}

const data = computed(() => store.paginationData || [])
const chartsEnabled = computed(() => systemStore.config.ENABLE_CHARTS !== false)

onMounted(async () => {
  await systemStore.load()
  await reloadData()

  // 实时更新统一走 WebSocket，不再另起前端定时器：后端已经按
  // REALTIME_REFRESH_INTERVAL 把 sensor_data 节流合并后再推（见 app.js 的
  // broadcastThrottled），这里收到推送就静默重拉一次当前窗口的数据。
  connect()
  unsubscribeWs = wsOn('sensor_data', () => reloadData(true))
})

onUnmounted(() => {
  unsubscribeWs?.()
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
