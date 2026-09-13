<!--
 * 【文件职责】
 * 业务页面："自动判定"。后端每隔几秒自己提交最新几条传感器数据给判定服务，
 * 本页面订阅结果，实时渲染成表格 + 三张图（置信度折线、结论时间轴、结论分布饼图）。
 * 页面只负责展示，不发起判定——判定节奏由后端定时器控制，关掉本页面后端照跑。
 * 【配置中心关联】
 * 读配置中心 AUTO_JUDGMENT（service/autoJudgment/config.js）：enabled 决定是否提示
 * "未启用"，intervalMs 显示当前节奏，bufferSize 决定本页最多留多少条。
 *
 * ══════════════ 赛场要改什么，改哪里 ══════════════
 * 先分清改前端还是改后端：
 *   判定跑多快、每次取几条、留多少条  → 后端 service/autoJudgment/config.js，改完重启后端
 *   页面上显示什么、怎么排版          → 本文件，改完 npm run build 重新打包
 *
 * | 赛题/现场要求                     | 改这里                                         |
 * |----------------------------------|-----------------------------------------------|
 * | 表格要加列（如设备编号）           | template 里照现有 el-table-column 抄一行，       |
 * |                                  | prop 用后端 entry 里的字段名（见下面 entries 注释） |
 * | 表格某列不要                      | 删对应 el-table-column                         |
 * | "自动判定/本地模拟/失败"想换说法    | statusLabel 映射表                             |
 * | 状态标签颜色不合赛题口味           | statusTagType 映射表                           |
 * | 饼图不要 / 只要表格               | template 里删 charts-side 那个 div             |
 * | 图表要更宽、饼图更窄              | 样式 .charts-main / .charts-side 的 flex 值     |
 * | 要表格在上、图在下                | template 里把 table-wrapper 整块挪到 charts-row 前 |
 * | 置信度是 0~100 而不是 0~1         | 不在本文件，改 components/JudgmentCharts.vue     |
 * |                                  | 的 CONFIDENCE_MAX                             |
 * -->
<template>
  <div>
    <div class="status-bar">
      <el-tag v-if="!autoEnabled" type="info" size="large">
        自动判定未启用（service/autoJudgment/config.js 的 enabled 改成 true 并重启后端）
      </el-tag>
      <template v-else>
        <el-tag type="success" size="large">自动判定运行中</el-tag>
        <span class="status-text">每 {{ (intervalMs / 1000).toFixed(1) }} 秒提交最新 {{ recentCount }} 条传感器数据</span>
        <span class="status-text">已收到 {{ entries.length }} / {{ bufferSize }} 条结果</span>
        <span v-if="latest" class="status-text">最近一次：{{ latest.time }}</span>
      </template>
    </div>

    <div class="charts-row">
      <div class="charts-main">
        <JudgmentCharts :data="entries" />
      </div>
      <div class="charts-side">
        <PieChart :data="conclusionStats" title="结论分布" />
      </div>
    </div>

    <div class="table-wrapper">
      <el-table
        :data="tableRows"
        style="width: 100%"
        v-if="tableRows.length > 0"
        border
        stripe
        :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: 600 }"
      >
        <el-table-column prop="time" label="判定时间" width="180" align="center" />
        <el-table-column prop="idsText" label="原数据ID" min-width="140" show-overflow-tooltip align="center" />
        <el-table-column prop="conclusion" label="判定结论" min-width="160" show-overflow-tooltip align="center">
          <template #default="{ row }">
            <span>{{ row.conclusion ?? '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="confidence" label="置信度" width="100" align="center">
          <template #default="{ row }">
            <span>{{ row.confidence === null || row.confidence === undefined ? '—' : row.confidence }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="110" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="error" label="错误信息" min-width="180" show-overflow-tooltip align="center">
          <template #default="{ row }">
            <span>{{ row.error ?? '' }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="empty-state">
        {{ autoEnabled ? '等待第一条判定结果...' : '暂无数据' }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'
import { connect, on as wsOn } from '@/utils/websocket'
import { useSystemConfigStore } from '@/stores/useSystemConfigStore'
import JudgmentCharts from '@/components/JudgmentCharts.vue'
import PieChart from '@/components/PieChart.vue'

const systemStore = useSystemConfigStore()

/**
 * 判定结果，按时间正序（新的在后）——图表要的就是这个顺序，表格自己再倒过来。
 *
 * 每一项是后端 service/autoJudgment/autoJudgment.js 发过来的，字段固定是这些
 * （赛场要给表格加列时，prop 只能用这里有的名字）：
 *   time       '2026-09-12 14:30:05'，后端判定那一刻的时间
 *   ids        这一轮提交的原始数据 id 数组，如 [1201,1202,1203]
 *   conclusion 判定结论字符串；失败或服务没给结论时是 null
 *   confidence 置信度数字；取不到是 null（注意 0 是合法值，不是"没取到"）
 *   results    判定服务返回的完整结果（原样透传，要展示原始响应就用它）
 *   status     'auto'=真服务判的 / 'auto_mock'=本地占位判的 / 'failed'=这轮失败
 *   error      失败原因；成功时是 null
 */
const entries = ref([])

const autoEnabled = ref(false)
const intervalMs = ref(5000)
const recentCount = ref(5)
const bufferSize = ref(50)

/** WebSocket 取消订阅函数，离开页面时调用，避免页面来回切换后同一条消息被处理多次。 */
let unsubscribe = null

const latest = computed(() => entries.value[entries.value.length - 1] || null)

/** 表格最新的排在最上面，跟项目里其它历史表一致。 */
const tableRows = computed(() => [...entries.value].reverse().map(item => ({
  ...item,
  idsText: Array.isArray(item.ids) ? item.ids.join(', ') : ''
})))

/** 饼图统计：PieChart.vue 要的是 [{ type, count }]，不是 ECharts 的 {name,value}。 */
const conclusionStats = computed(() => {
  const counter = new Map()
  for (const item of entries.value) {
    const key = item.conclusion ?? (item.status === 'failed' ? '判定失败' : '未知')
    counter.set(key, (counter.get(key) || 0) + 1)
  }
  return [...counter.entries()].map(([type, count]) => ({ type, count }))
})

const statusLabel = (status) => ({
  auto: '自动判定',
  auto_mock: '本地模拟',
  failed: '失败',
}[status] || status)

const statusTagType = (status) => ({
  auto: 'success',
  auto_mock: 'warning',
  failed: 'danger',
}[status] || 'info')

/** 追加一条结果，并按 bufferSize 丢掉最旧的——后端内存里也是这个上限，保持一致。 */
function append(entry) {
  const next = [...entries.value, entry]
  entries.value = next.length > bufferSize.value ? next.slice(-bufferSize.value) : next
}

/** 页面首次打开时补齐后端内存里已有的结果：WebSocket 只能推之后新产生的，
 *  不补的话刚进页面图表是空的，要等好几秒才出第一个点。 */
async function loadRecent() {
  try {
    const response = await api.get('/api/intelligent/auto-recent')
    entries.value = response.data.data || []
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '自动判定结果加载失败')
  }
}

onMounted(async () => {
  const config = await systemStore.load()
  const auto = config.AUTO_JUDGMENT || {}
  autoEnabled.value = auto.enabled === true
  intervalMs.value = auto.intervalMs || 5000
  recentCount.value = auto.recentCount || 5
  bufferSize.value = auto.bufferSize || 50

  await loadRecent()
  connect()
  unsubscribe = wsOn('auto_judgment', append)
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
})
</script>

<style scoped>
.status-bar {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.status-text { color: #64748b; font-size: 14px; }
.charts-row { display: flex; gap: 16px; margin-bottom: 16px; align-items: stretch; }
.charts-main { flex: 2; min-width: 0; }
.charts-side {
  flex: 1;
  min-width: 280px;
  background: white;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
  padding: 12px 8px;
}
.table-wrapper {
  background: white;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
  overflow: auto;
}
.empty-state {
  text-align: center;
  padding: 50px;
  color: #999;
  font-size: 20px;
}
</style>
