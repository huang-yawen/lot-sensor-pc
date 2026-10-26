<!--
 * 【文件职责】组合数据/汇总数据页面（当前生效的数据汇总页）。
 *   一条上报消息 = 表格一行：同时展示传感器列和行为列（列名带 `传感器·` / `行为·` 前缀，
 *   前缀是为了避免两张字段映射表出现同名中文列时互相覆盖）。
 *   支持：设备编号搜索、时间范围筛选、分页、勾选若干行 → 点「智能判定」做**组合判定**。
 *
 * 【智能判定按钮的完整流程】（想改判定相关行为，看这段）
 *   勾选行 → 取每行的 id（= t_scene_data.id，一行 = 一条完整消息）
 *          → POST /api/intelligent/judge { type: 'combined', ids }
 *          → 后端读 t_scene_data 整行、按映射表把槽位还原成设备上报字段名（temp_in / pump ...）
 *          → 请求现场判定服务 → 解析结论 → 落库 t_judgment_record（data_type='combined'）
 *          → 前端拿 { results, conclusion, confidence, mock } 弹出 JudgmentResultDialog
 *   按钮显隐：INTELLIGENT_JUDGMENT.showOnCombinedPage（没配就跟随 showOnSensorPage）。
 *   注意：手动判定**不会**触发"关泵/关加热"联动，只有自动/实时判定会。
 *
 * 【与分开版页面的差异】SensorHistory.vue / BehaviorHistory.vue 是分开版的两个汇总页
 *   （当前已停用、路由重定向到本页），它们发的 type 是 'sensor' / 'behavior'，
 *   报文里只有那一侧、且是数据库裸槽位名 field1~field10。详见 JUDGMENT_GUIDE.md 第 4 节。
 *
 * 【配置中心关联】
 *   通过 SystemConfigStore 读取配置中心：INTELLIGENT_JUDGMENT.showOnCombinedPage 控制"智能判定"按钮，
 *   DEFAULT_PAGE_SIZE 控制默认每页条数，ENABLE_CHARTS 控制图表是否展示。
 * 【配置开关】SideBar 里用 SHOW_COMBINED_PAGE 控制菜单是否显示（见 config/appSettings.js）。
 * -->
<template>
  <div>
    <TableContainer
      ref="tableContainer"
      :data="data"
      :loading="loading"
      :total="total"
      :pageSize="pageSize"
      :data-scope="dataScope"
      type="combined"
      searchPlaceholder="输入设备编号"
      @search="handleSearch"
      @pageChange="handlePageChange"
      @sizeChange="handleSizeChange"
      @selectionChange="onSelectionChange"
    >
      <template #actions>
        <el-button
          v-if="showRecognizeBtn"
          type="warning"
          :loading="recognizing"
          :disabled="selectedRows.length === 0"
          @click="handleRecognize"
        >
          智能判定
        </el-button>
      </template>
    </TableContainer>

    <!-- 识别结果对话框（原始数据展示） -->
    <JudgmentResultDialog v-model:visible="dialogVisible" :result="recognizeResult" />

    <div class="chartContainer" v-if="chartsEnabled && data.length > 0">
      <LineBarCharts :data="data" :pageSize="pageSize" :settings="store.chartSettings" />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useCombinedStore } from '@/stores/useCombinedStore'
import TableContainer from '@/components/TableContainer.vue'
import LineBarCharts from '@/components/LineBarCharts.vue'
import JudgmentResultDialog from '@/components/JudgmentResultDialog.vue'
import api from '@/api'
import { useSystemConfigStore } from '@/stores/useSystemConfigStore'

const store = useCombinedStore()
const systemStore = useSystemConfigStore()

// 汇总数据页面不再按实时/保存筛选，dataScope 留空即可查到全部类型的数据（含最新的实时数据）。
const dataScope = ''
const selectedRows = ref([])
const showRecognizeBtn = ref(false)
const recognizing = ref(false)
const dialogVisible = ref(false)
const recognizeResult = ref(null)

const data = computed(() => store.paginationData || [])
const loading = computed(() => store.loading || false)
const total = computed(() => store.total || 0)
const pageSize = computed(() => store.pageSize || 5)
const chartsEnabled = computed(() => systemStore.config.ENABLE_CHARTS !== false)

const onSelectionChange = (selection) => {
  selectedRows.value = selection
}

/**
 * 调用后端智能判定接口做「组合判定」：把勾选的这几条消息的传感器字段和行为字段
 * 一起交给判定服务（type='combined'）。行的 id 是传感器侧主键，行为侧 id 由
 * 后端按同一行取，所以这里只需要传行的 id。
 */
const handleRecognize = async () => {
  if (selectedRows.value.length === 0) {
    ElMessage.warning('请先勾选需要判定的组合数据')
    return
  }
  recognizing.value = true
  try {
    const ids = selectedRows.value.map(item => item.id)
    const res = await api.post('/api/intelligent/judge', {
      type: 'combined',
      ids: ids
    })
    if (res.data.success) {
      recognizeResult.value = res.data.data
      dialogVisible.value = true
    } else {
      ElMessage.error(res.data.message || '判定失败')
    }
  } catch (err) {
    console.error('[CombinedHistory] 智能判定失败:', err)
    ElMessage.error(err.response?.data?.message || '判定请求失败，请稍后重试')
  } finally {
    recognizing.value = false
  }
}

// 记住当前生效的筛选条件，翻页/改每页条数时要沿用，不能悄悄清空。
const currentFilters = ref({ keyword: '', startTime: null, endTime: null })

const handleSearch = async (params) => {
  currentFilters.value = {
    keyword: params.keyword || '',
    startTime: params.startTime || null,
    endTime: params.endTime || null,
  }
  await store.fetchCombinedData({
    currentPage: params.currentPage,
    pageSize: params.pageSize,
    keyword: params.keyword,
    startTime: params.startTime,
    endTime: params.endTime,
    dataScope: params.dataScope
  })
}

const handlePageChange = (page) => {
  handleSearch({
    currentPage: page,
    pageSize: pageSize.value,
    keyword: currentFilters.value.keyword,
    startTime: currentFilters.value.startTime,
    endTime: currentFilters.value.endTime,
    dataScope
  })
}

const handleSizeChange = (size) => {
  store.pageSize = size
  handleSearch({
    currentPage: 1,
    pageSize: size,
    keyword: currentFilters.value.keyword,
    startTime: currentFilters.value.startTime,
    endTime: currentFilters.value.endTime,
    dataScope
  })
}

onMounted(async () => {
  try {
    const config = await systemStore.load()
    // 默认跟随 INTELLIGENT_JUDGMENT.showOnCombinedPage；没配就跟着传感器页的开关走，
    // 少一个必须记得改的配置项。
    const judgment = config.INTELLIGENT_JUDGMENT || {}
    showRecognizeBtn.value = (judgment.showOnCombinedPage ?? judgment.showOnSensorPage) === true
    store.pageSize = config.DEFAULT_PAGE_SIZE || 5
  } catch (err) {
    console.error('[CombinedHistory] 获取系统配置失败:', err)
    showRecognizeBtn.value = true // 默认显示
  }

  await store.fetchCombinedData({
    currentPage: 1,
    pageSize: pageSize.value,
    keyword: '',
    startTime: null,
    endTime: null,
    dataScope
  })
})
</script>

<style scoped>
.chartContainer {
  padding-top: 10px;
}
</style>
