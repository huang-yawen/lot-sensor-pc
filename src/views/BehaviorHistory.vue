<!--
 * 【文件职责】
 * 业务页面，负责组合数据、状态和用户操作，呈现完整功能界面。
 * 【配置中心关联】
 * 页面通过状态仓库读取配置中心；场景开关保存后，相关显示与交互按最新配置更新。
 * -->
<template>
  <div>
    <TableContainer
      ref="tableContainer"
      :data="data"
      :loading="loading"
      :total="total"
      :pageSize="pageSize"
      :online="online"
      type="behavior"
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
    <el-dialog
      v-model="dialogVisible"
      title="智能判定结果"
      width="700px"
      :close-on-click-modal="false"
    >
      <div v-if="recognizeResult">
        <pre class="raw-json">{{ JSON.stringify(recognizeResult, null, 2) }}</pre>
      </div>
      <template #footer>
        <el-button @click="dialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <div class="chartContainer" v-if="chartsEnabled && data.length > 0">
      <LineBarCharts :data="data" :pageSize="pageSize" />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { PaginationStore } from '@/stores/PaginationStore.js'
import TableContainer from '@/components/TableContainer.vue'
import LineBarCharts from '@/components/LineBarCharts.vue'
import { transformBehaviorList } from '@/utils/fieldTransform'
import api from '@/api'
import { useSystemConfigStore } from '@/stores/SystemConfigStore'

const store = PaginationStore()
const systemStore = useSystemConfigStore()

// 汇总数据页面不再按实时/历史筛选，留空即可查到该表全部数据（含最新的实时数据）。
const online = ''
const selectedRows = ref([])
const showRecognizeBtn = ref(false)
const recognizing = ref(false)
const dialogVisible = ref(false)
const recognizeResult = ref(null)

const data = computed(() => transformBehaviorList(store.paginationData || []))
const loading = computed(() => store.loading || false)
const total = computed(() => store.total || 0)
const pageSize = computed(() => store.pageSize || 5)
const chartsEnabled = computed(() => systemStore.config.ENABLE_CHARTS !== false)

const onSelectionChange = (selection) => {
  selectedRows.value = selection
}

// 调用后端智能判定接口
const handleRecognize = async () => {
  if (selectedRows.value.length === 0) {
    ElMessage.warning('请先勾选需要判定的运行数据')
    return
  }
  recognizing.value = true
  try {
    const ids = selectedRows.value.map(item => item.id)
    const res = await api.post('/intelligent/judge', {
      type: 'behavior',
      ids: ids
    })
    if (res.data.success) {
      recognizeResult.value = res.data.data
      dialogVisible.value = true
    } else {
      ElMessage.error(res.data.message || '判定失败')
    }
  } catch (err) {
    console.error('[BehaviorHistory] 智能判定失败:', err)
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
  await store.fetchPaginationData({
    type: params.type || 'behavior',
    currentPage: params.currentPage,
    pageSize: params.pageSize,
    keyword: params.keyword,
    startTime: params.startTime,
    endTime: params.endTime,
    online: params.online
  })
}

const handlePageChange = (page) => {
  handleSearch({
    type: 'behavior',
    currentPage: page,
    pageSize: pageSize.value,
    keyword: currentFilters.value.keyword,
    startTime: currentFilters.value.startTime,
    endTime: currentFilters.value.endTime,
    online
  })
}

const handleSizeChange = (size) => {
  store.pageSize = size
  handleSearch({
    type: 'behavior',
    currentPage: 1,
    pageSize: size,
    keyword: currentFilters.value.keyword,
    startTime: currentFilters.value.startTime,
    endTime: currentFilters.value.endTime,
    online
  })
}

onMounted(async () => {
  try {
    const config = await systemStore.load()
    showRecognizeBtn.value = config.ENABLE_BEHAVIOR_RECOGNIZE === true
    store.pageSize = config.DEFAULT_PAGE_SIZE || 5
  } catch (err) {
    console.error('[BehaviorHistory] 获取系统配置失败:', err)
    showRecognizeBtn.value = true // 默认显示
  }

  await store.fetchPaginationData({
    type: 'behavior',
    currentPage: 1,
    pageSize: pageSize.value,
    keyword: '',
    startTime: null,
    endTime: null,
    online: online
  })
})
</script>

<style scoped>
.chartContainer {
  padding-top: 10px;
}

.raw-json {
  background: #f5f5f5;
  padding: 16px;
  border-radius: 8px;
  font-size: 13px;
  max-height: 400px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
