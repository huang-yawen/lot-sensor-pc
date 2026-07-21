<template>
  <div>
    <div class="toolbar">
      <el-input v-model="deviceNo" clearable placeholder="设备编号" style="width: 220px" @keyup.enter="load" />
      <el-select v-model="status" clearable placeholder="判定状态" style="width: 160px">
        <el-option label="成功" value="success" />
        <el-option label="本地模拟" value="mock" />
        <el-option label="失败" value="failed" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>
    <div class="table-wrapper">
      <el-table
        :data="rows"
        style="width: 100%"
        v-if="rows.length > 0"
        border
        stripe
        :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: 600 }"
      >
        <el-table-column v-if="displayStore.isFieldVisible('id')" prop="id" label="ID" width="80" align="center" />
        <el-table-column v-if="displayStore.isFieldVisible('d_no')" prop="d_no" label="设备编号" min-width="120" align="center" />
        <el-table-column prop="data_type" label="数据类型" width="100" align="center" />
        <el-table-column prop="source_ids" label="原数据ID" min-width="130" show-overflow-tooltip align="center" />
        <el-table-column prop="conclusion" label="判定结论" min-width="160" show-overflow-tooltip align="center" />
        <el-table-column prop="confidence" label="置信度" width="100" align="center" />
        <el-table-column prop="status" label="状态" width="100" align="center" />
        <el-table-column prop="error_message" label="错误信息" min-width="180" show-overflow-tooltip align="center" />
        <el-table-column prop="c_time" label="判定时间" width="180" align="center" />
      </el-table>
      <div v-else class="empty-state">
        {{ loading ? '加载中...' : '暂无数据' }}
      </div>
    </div>
    <el-pagination
      class="pagination"
      background
      layout="sizes, prev, pager, next"
      :total="total"
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :page-sizes="pageSizeOptions"
      @current-change="load"
      @size-change="page = 1; load()"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'
import { useSystemConfigStore } from '@/stores/SystemConfigStore'
import { DisplayStore } from '@/stores/DisplayStore'

const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const deviceNo = ref('')
const status = ref('')
const loading = ref(false)
const systemStore = useSystemConfigStore()
const displayStore = DisplayStore()
const pageSizeOptions = computed(() => [...new Set([pageSize.value, 5, 10, 20, 50])].sort((a, b) => a - b))

async function load() {
  loading.value = true
  try {
    const response = await api.get('/intelligent/records', { params: { page: page.value, pageSize: pageSize.value, d_no: deviceNo.value, status: status.value } })
    rows.value = response.data.data.list
    total.value = response.data.data.total
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '判定记录加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  const config = await systemStore.load()
  pageSize.value = config.DEFAULT_PAGE_SIZE || 5
  await load()
})
</script>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; align-items: center; height: 40px; }
.pagination { margin-top: 24px; display: flex; justify-content: center; }
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
  font-size: 30px;
}
</style>
