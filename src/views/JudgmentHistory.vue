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
    <el-table :data="rows" v-loading="loading" border stripe>
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="d_no" label="设备编号" min-width="120" />
      <el-table-column prop="data_type" label="数据类型" width="100" />
      <el-table-column prop="source_ids" label="原数据ID" min-width="130" show-overflow-tooltip />
      <el-table-column prop="conclusion" label="判定结论" min-width="160" show-overflow-tooltip />
      <el-table-column prop="confidence" label="置信度" width="100" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column prop="error_message" label="错误信息" min-width="180" show-overflow-tooltip />
      <el-table-column prop="c_time" label="判定时间" width="180" />
    </el-table>
    <el-pagination
      class="pagination"
      background
      layout="total, sizes, prev, pager, next"
      :total="total"
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :page-sizes="[10, 20, 50]"
      @current-change="load"
      @size-change="page = 1; load()"
    />
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const deviceNo = ref('')
const status = ref('')
const loading = ref(false)

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

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.pagination { margin-top: 16px; justify-content: flex-end; }
</style>
