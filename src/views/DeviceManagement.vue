<template>
  <div>
    <div class="input">
      <form @submit.prevent>
        <el-input v-model="input" placeholder="输入电车编号id或者设备名称" style="width: 240px" :suffix-icon="Search" />
        <el-button type="primary" :loading="store.loading" @click="handleSearch" class="search-btn">开始查找</el-button>
      </form>
      <el-button type="success" @click="showAddForm" class="add-btn">新增设备</el-button>
    </div>

    <div class="table">
      <table v-if="deviceData.length > 0">
        <thead>
          <tr>
            <th v-for="key in tableColumns" :key="key">{{ key }}</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in deviceData" :key="index">
            <td v-for="key in tableColumns" :key="key">{{ item[key] }}</td>
            <td>
              <el-button type="primary" @click="showEditForm(item)">修改</el-button>
              <el-button type="danger" @click="handleDelete(item)">删除</el-button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty-table">
        {{ store.loading ? '加载中...' : '暂无数据' }}
      </div>
    </div>

    <div class="pagination-wrapper">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[5, 10, 15, 20]"
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

        <div v-for="(labelName, index) in labels" :key="index" class="form-row">
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

        <div v-for="(labelName, index) in labels" :key="index" class="form-row">
          <label :for="index">{{ labelName }}:</label>
          <input :id="index" v-model="editData[labelName]" />
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
import { DeviceStore } from '@/stores/DeviceStore.js'
import { DisplayStore } from '@/stores/DisplayStore'
import { ElMessage, ElMessageBox } from 'element-plus'

const store = DeviceStore()
const displayStore = DisplayStore()
const input = ref('')
const formData = ref({})
const editData = ref({})
const oldId = ref(null)
const labels = ref(['id', '设备名称', '电车编号id', '备注'])
const showAdd = ref(false)
const showEdit = ref(false)
const currentPage = ref(1)
const pageSize = ref(5)

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
// 设备管理是手写表格，也要接入全局字段显示开关。
const tableColumns = computed(() => {
  const firstItem = deviceData.value[0]
  return firstItem ? Object.keys(firstItem).filter(displayStore.isFieldVisible) : []
})

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
  labels.value.forEach(label => form[label] = '')
}

const handleSearch = async () => {
  console.log('开始搜索，输入值:', input.value)
  await fetchData()
}

const showAddForm = () => {
  showAdd.value = true
  showEdit.value = false
}

const handleAdd = async () => {
  if (!validateForm(formData.value)) return

  formData.value['创立时间'] = new Date().toLocaleString('zh-CN', { hour12: false })

  try {
    const res = await store.handleAdd(formData.value)
    if (res.data.success) {
      ElMessage.success('添加成功')
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
  if (!form['id'] || isNaN(Number(form['id']))) { ElMessage.warning('id不能为空且必须为数字'); return false }
  if (!form['设备名称']) { ElMessage.warning('设备名称不能为空'); return false }
  if (!form['电车编号id']) { ElMessage.warning('电车编号id不能为空'); return false }
  if (store.deviceData.some(item => Number(item.id) === Number(form['id']) && form !== editData.value)) { ElMessage.warning('id已存在'); return false }
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
    '电车编号id': editData.value['电车编号id'] ?? '',
    'id': Number(editData.value['id'])
  }

  console.log('准备修改的 payload:', updatePayload)

  try {
    const res = await store.handleUpdate(updatePayload)
    console.log('修改响应:', res)
    if (res.data.success) {
      ElMessage.success('修改成功')
      showEdit.value = false
      oldId.value = null
      await store.fetchDeviceData({ 
        input: '', 
        currentPage: 1, 
        pageSize: pageSize.value 
      })
      console.log('刷新后的数据:', store.deviceData)
    } else {
      ElMessage.error('修改失败：' + (res.data.message || '未知错误'))
    }
  } catch (err) {
    console.error(err)
    ElMessage.error('网络错误，修改失败')
  }
}

onMounted(() => fetchData())
</script>

<style scoped>
.input {
  display: flex;
  position: relative;
  gap: 16px;
  align-items: center;
}

.pagination-wrapper {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}

.search-btn {
  margin-left: 16px;
  background-color: #374270;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 24px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.search-btn:hover {
  background-color: #4a5a91;
  box-shadow: 0 2px 8px rgba(55, 66, 112, 0.3);
}

.add-btn {
  position: absolute;
  right: 0;
  background-color: #10b981;
  border: none;
  border-radius: 6px;
  padding: 8px 20px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.add-btn:hover {
  background-color: #059669;
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
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

.table {
  margin-top: 24px;
  background: white;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.table > table {
  width: 100%;
  border-collapse: collapse;
  text-align: center;
  font-size: 14px;
}

.table th {
  background-color: #f8fafc;
  color: #475569;
  font-weight: 600;
  padding: 14px 16px;
  font-size: 14px;
  border-bottom: 2px solid #e2e8f0;
}

.table td {
  padding: 14px 16px;
  border-bottom: 1px solid #f1f5f9;
  color: #334155;
}

.table tbody tr {
  transition: all 0.2s ease;
}

.table tbody tr:hover {
  background-color: #f8fafc;
}

.table tbody tr:nth-child(even) {
  background-color: #fafbfc;
}

.table td button {
  padding: 6px 14px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s ease;
  margin: 0 4px;
}

.table td button:nth-child(1) {
  color: #374270;
  background-color: #eef2ff;
  border: 1px solid #ddd6fe;
}

.table td button:nth-child(1):hover {
  background-color: #ddd6fe;
}

.table td button:nth-child(2) {
  color: #dc2626;
  background-color: #fef2f2;
  border: 1px solid #fee2e2;
}

.table td button:nth-child(2):hover {
  background-color: #fee2e2;
}

.empty-table {
  text-align: center;
  padding: 60px;
  color: #94a3b8;
  font-size: 16px;
}

.empty-table::before {
  content: '';
  display: block;
  width: 64px;
  height: 64px;
  margin: 0 auto 16px;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 24 24' fill='none' stroke='%23cbd5e1' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z'/%3E%3Cline x1='3' y1='6' x2='21' y2='6'/%3E%3Cpath d='M16 10a4 4 0 0 1-8 0'/%3E%3C/svg%3E") no-repeat center;
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
