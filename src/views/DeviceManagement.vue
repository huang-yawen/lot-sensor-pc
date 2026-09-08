<!--
 * 【文件职责】
 * 业务页面，负责组合数据、状态和用户操作，呈现完整功能界面。
 * 【配置中心关联】
 * 页面通过状态仓库读取配置中心；场景开关保存后，相关显示与交互按最新配置更新。
 * -->
<template>
  <div>
    <div class="search-form">
      <div class="search-form-inner">
        <el-input
          v-model="input"
          style="width: 240px; flex-shrink: 0;"
          placeholder="输入设备编号或设备名称"
          :suffix-icon="Search"
          clearable
        />
        <div class="button-wrapper">
          <el-button type="primary" :loading="store.loading" @click="handleSearch">开始查找</el-button>
          <el-button type="success" @click="showAddForm">新增设备</el-button>
        </div>
      </div>
    </div>

    <div class="table-wrapper">
      <el-table
        :data="deviceData"
        style="width: 100%"
        v-if="deviceData.length > 0"
        border
        stripe
        :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: 600 }"
      >
        <el-table-column
          v-for="key in tableColumns"
          :key="key"
          :prop="key"
          :label="key"
          show-overflow-tooltip
          align="center"
          :width="getColumnWidth(key)"
        />
        <el-table-column label="操作" align="center" width="180">
          <template #default="scope">
            <el-button type="primary" @click="showEditForm(scope.row)">修改</el-button>
            <el-button type="danger" @click="handleDelete(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="empty-state">
        {{ store.loading ? '加载中...' : '暂无数据' }}
      </div>
    </div>

    <div class="pagination-wrapper">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="pageSizeOptions"
        :background="true"
        layout="sizes, prev, pager, next"
        :total="store.total || 0"
        @size-change="handlePageSizeChange"
        @current-change="handlePageChange"
      />
    </div>

    <!-- 新增面板 -->
    <div class="update" v-if="showAdd">
      <div class="modal-mask" @click="showAdd = false"></div>
      <el-card class="modal-container">
        <span class="close-btn" @click="showAdd = false">&times;</span>
        <template #header>
          <div class="card-header"><span>新增数据：</span></div>
        </template>

        <div v-for="(labelName, index) in addLabels" :key="index" class="form-row">
          <label :for="index">{{ labelName }}:</label>
          <input :id="index" v-model="formData[labelName]" />
        </div>

        <template #footer>
          <el-button type="success" native-type="button" @click="handleAdd">提交数据</el-button>
        </template>
      </el-card>
    </div>

    <!-- 修改面板 -->
    <div class="update" v-if="showEdit">
      <div class="modal-mask" @click="showEdit = false"></div>
      <el-card class="modal-container">
        <span class="close-btn" @click="showEdit = false">&times;</span>
        <template #header>
          <div class="card-header"><span>修改数据：</span></div>
        </template>

        <div v-for="(labelName, index) in editLabels" :key="index" class="form-row">
          <label :for="index">{{ labelName }}:</label>
          <input :id="index" v-model="editData[labelName]" :disabled="labelName === 'id'" />
        </div>

        <template #footer>
          <el-button type="warning" native-type="button" @click="handleUpdate">提交数据</el-button>
        </template>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { useDeviceStore } from '@/stores/DeviceStore.js'
import { useDisplayStore } from '@/stores/DisplayStore'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSystemConfigStore } from '@/stores/SystemConfigStore'

const store = useDeviceStore()
const displayStore = useDisplayStore()
const systemStore = useSystemConfigStore()
const input = ref('')
const formData = ref({})
const editData = ref({})
const oldId = ref(null)
const addLabels = ['设备名称', '设备编号', '内部编号', '备注']
const editLabels = ['id', '设备名称', '设备编号', '内部编号', '备注']
const showAdd = ref(false)
const showEdit = ref(false)
const currentPage = ref(1)
const pageSize = ref(5)
const pageSizeOptions = computed(() => [...new Set([pageSize.value, 5, 10, 15, 20])].sort((a, b) => a - b))

const handlePageChange = (page) => {
  currentPage.value = page
  fetchData()
}

const handlePageSizeChange = (size) => {
  pageSize.value = size
  currentPage.value = 1
  fetchData()
}

const deviceData = computed(() => store.deviceData)
// 设备管理表格也要接入全局字段显示开关。
const tableColumns = computed(() => {
  const firstItem = deviceData.value[0]
  return firstItem ? Object.keys(firstItem).filter(displayStore.isFieldVisible) : []
})

// 列宽策略跟 TableContainer.vue 保持一致：id 列窄，时间类列固定宽度，其余自适应。
const getColumnWidth = (key) => {
  const lower = String(key).toLowerCase()
  if (lower === 'id' || lower === '序号') return 80
  if (lower.includes('时间') || lower.includes('创立时间') || lower.includes('操作时间') || lower.includes('创建时间')) return 195
  return ''
}

const fetchData = async () => {
  console.log('搜索参数:', { input: input.value, currentPage: currentPage.value, pageSize: pageSize.value })
  store.loading = true
  try {
    await store.fetchDeviceData({ 
      input: input.value, 
      currentPage: currentPage.value, 
      pageSize: pageSize.value,
      searchMode: displayStore.hideNumberFields ? 'deviceName' : 'all'
    })
  } finally {
    store.loading = false
  }
}

const resetForm = (form) => {
  addLabels.forEach(label => form[label] = '')
}

const handleSearch = async () => {
  console.log('开始搜索，输入值:', input.value)
  await fetchData()
}

const showAddForm = () => {
  resetForm(formData.value)
  showAdd.value = true
  showEdit.value = false
}

const handleAdd = async () => {
  if (!validateForm(formData.value)) return

  try {
    const res = await store.handleAdd(formData.value)
    if (res.data.success) {
      ElMessage.success(res.data.message || '添加成功')
      resetForm(formData.value)
      showAdd.value = false
      await fetchData()
    } else {
      ElMessage.error('添加失败：' + (res.data.message || '未知错误'))
    }
  } catch (err) {
    console.error(err)
    ElMessage.error('网络错误，添加失败')
  }
}

const validateForm = (form) => {
  if (!String(form['设备名称'] ?? '').trim()) { ElMessage.warning('设备名称不能为空'); return false }
  if (!String(form['设备编号'] ?? '').trim()) { ElMessage.warning('设备编号不能为空'); return false }
  return true
}

const handleDelete = async (item) => {
  try {
    await ElMessageBox.confirm(
      '确定要删除此设备吗？',
      '提示',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    const res = await store.handleDelete(Number(item.id))
    if (res.data.success) {
      ElMessage.success('删除成功')
      await fetchData()
    } else {
      ElMessage.error('删除失败：' + (res.data.message || '未知错误'))
    }
  } catch (err) {
    if (err !== 'cancel') {
      console.error(err)
      ElMessage.error('删除失败，请重试！')
    }
  }
}

const showEditForm = (item) => {
  showEdit.value = true
  showAdd.value = false
  editData.value = { ...item, id: Number(item.id) }
  oldId.value = Number(item.id)
}

const handleUpdate = async () => {
  if (!validateForm(editData.value)) return

  const updatePayload = {
    ...editData.value,
    oldId: oldId.value,
    '备注': editData.value['备注'] ?? null,
    '设备名称': editData.value['设备名称'] ?? '',
    '设备编号': editData.value['设备编号'] ?? '',
    'id': Number(oldId.value)
  }

  console.log('准备修改的 payload:', updatePayload)

  try {
    const res = await store.handleUpdate(updatePayload)
    console.log('修改响应:', res)
    if (res.data.success) {
      ElMessage.success('修改成功')
      showEdit.value = false
      oldId.value = null
      await fetchData()
      console.log('刷新后的数据:', store.deviceData)
    } else {
      ElMessage.error('修改失败：' + (res.data.message || '未知错误'))
    }
  } catch (err) {
    console.error(err)
    ElMessage.error('网络错误，修改失败')
  }
}

onMounted(async () => {
  const config = await systemStore.load()
  pageSize.value = config.DEFAULT_PAGE_SIZE || 5
  await fetchData()
})
</script>

<style scoped>
.search-form {
  padding-bottom: 24px;
}

.search-form-inner {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: nowrap;
  height: 40px;
}

.button-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.button-wrapper .el-button {
  min-width: 100px;
}

.pagination-wrapper {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}

.form-row {
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.form-row label {
  width: 100px;
  font-weight: 500;
  color: #374151;
  text-align: right;
}

.form-row input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 14px;
  transition: all 0.2s ease;
  background-color: #fafafa;
}

.form-row input:focus {
  outline: none;
  border-color: #374270;
  box-shadow: 0 0 0 3px rgba(55, 66, 112, 0.1);
  background-color: #fff;
}

.form-row input:disabled {
  color: #64748b;
  background-color: #f1f5f9;
  cursor: not-allowed;
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
  font-size: 30px;
}

@media (max-width: 768px) {
  .search-form-inner {
    flex-direction: column;
    align-items: stretch;
    height: auto;
  }

  .search-form-inner .el-input {
    width: 100% !important;
    margin-left: 0 !important;
    margin-bottom: 10px;
  }
}

.modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  z-index: 999;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal-container {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1000;
  max-width: 520px;
  width: 90%;
  background-color: #fff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translate(-50%, -40%);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%);
  }
}

.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  cursor: pointer;
  color: #94a3b8;
  border-radius: 50%;
  transition: all 0.2s ease;
}

.close-btn:hover {
  color: #374270;
  background-color: #f1f5f9;
}

.card-header {
  font-size: 18px;
  font-weight: 600;
  color: #1e293b;
}
</style>
