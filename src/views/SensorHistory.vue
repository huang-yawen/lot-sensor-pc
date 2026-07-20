<template>
  <div>
    <TableContainer
      ref="tableContainer"
      :data="data"
      :loading="loading"
      :total="total"
      :pageSize="pageSize"
      :online="online"
      type="sensor"
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

    <div class="chartContainer" v-if="data.length > 0">
      <LineBarCharts :data="data" :pageSize="pageSize" :settings="store.chartSettings" />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { PaginationStore } from '@/stores/PaginationStore.js'
import TableContainer from '@/components/TableContainer.vue'
import LineBarCharts from '@/components/LineBarCharts.vue'
import api from '@/api'

const store = PaginationStore()

const online = '保存数据'
const selectedRows = ref([])
const showRecognizeBtn = ref(false)
const recognizing = ref(false)
const dialogVisible = ref(false)
const recognizeResult = ref(null)

const data = computed(() => store.paginationData || [])
const loading = computed(() => store.loading || false)
const total = computed(() => store.total || 0)
const pageSize = computed(() => store.pageSize || 5)

const onSelectionChange = (selection) => {
  selectedRows.value = selection
}

// 调用后端智能判定接口
const handleRecognize = async () => {
  if (selectedRows.value.length === 0) {
    ElMessage.warning('请先勾选需要判定的传感器数据')
    return
  }
  recognizing.value = true
  try {
    const ids = selectedRows.value.map(item => item.id)
    const res = await api.post('/intelligent/judge', {
      type: 'sensor',
      ids: ids
    })
    if (res.data.success) {
      recognizeResult.value = res.data.data
      dialogVisible.value = true
    } else {
      ElMessage.error(res.data.message || '判定失败')
    }
  } catch (err) {
    console.error('[SensorHistory] 智能判定失败:', err)
    ElMessage.error(err.response?.data?.message || '判定请求失败，请稍后重试')
  } finally {
    recognizing.value = false
  }
}

const handleSearch = async (params) => {
  await store.fetchPaginationData({
    type: params.type || 'sensor',
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
    type: 'sensor',
    currentPage: page,
    pageSize: pageSize.value,
    keyword: '',
    startTime: null,
    endTime: null,
    online: online
  })
}

const handleSizeChange = (size) => {
  store.pageSize = size
  handleSearch({
    type: 'sensor',
    currentPage: 1,
    pageSize: size,
    keyword: '',
    startTime: null,
    endTime: null,
    online: online
  })
}

onMounted(async () => {
  // 从后端获取系统配置，决定是否显示智能判定按钮
  try {
    const res = await api.get('/api/system-config')
    if (res.data.success) {
      showRecognizeBtn.value = res.data.data.ENABLE_SENSOR_RECOGNIZE === true
    }
  } catch (err) {
    console.error('[SensorHistory] 获取系统配置失败:', err)
    showRecognizeBtn.value = true // 默认显示
  }

  await store.fetchPaginationData({
    type: 'sensor',
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
