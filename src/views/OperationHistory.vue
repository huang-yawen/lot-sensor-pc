<!--
 * 【文件职责】
 * 业务页面，负责组合数据、状态和用户操作，呈现完整功能界面。
 * 【配置中心关联】
 * 页面通过状态仓库读取配置中心；场景开关保存后，相关显示与交互按最新配置更新。
 * -->
<template>
  <div>
    <!-- 搜索区域：时间区间 + 指令类型下拉框 -->
    <div class="search-form">
      <div class="search-form-inner">
        <span style="white-space: nowrap;">数据类型：</span>
        <el-select
          v-model="selectedConfigId"
          placeholder="请选择指令类型"
          clearable
          style="width: 200px;"
        >
          <el-option
            v-for="item in configOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <div class="block">
          <el-date-picker
            v-model="dateRange"
            type="datetimerange"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
            format="YYYY-MM-DD HH:mm:ss"
            style="margin-left: 20px;"
            :clearable="true"
          />
        </div>
        <el-button
          type="primary"
          @click="handleSearch(1)"
          :loading="loading"
        >
          开始查找
        </el-button>
      </div>
    </div>

    <!-- 表格区域 -->
    <div class="table-wrapper">
      <el-table
        ref="tableRef"
        :data="data"
        style="width: 100%"
        v-if="data.length > 0"
        border
        stripe
        :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: 600 }"
      >
        <el-table-column
          v-for="key in computedColumns"
          :key="key"
          :prop="key"
          :label="key"
          show-overflow-tooltip
          align="center"
          :width="getColumnWidth(key)"
        />
      </el-table>
      <div v-else class="empty-state">
        {{ loading ? '加载中...' : '暂无数据' }}
      </div>
    </div>

    <!-- 分页器 -->
    <div class="pagination-wrapper">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="localPageSize"
        :page-sizes="pageSizeOptions"
        :background="true"
        layout="sizes, prev, pager, next"
        :total="total"
        @size-change="handleSizeChange"
        @current-change="handlePageChange"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import api from '@/api'
import { useDisplayStore } from '@/stores/DisplayStore'
import { useSystemConfigStore } from '@/stores/SystemConfigStore'

const displayStore = useDisplayStore()
const systemStore = useSystemConfigStore()

const data = ref([])
const total = ref(0)
const loading = ref(false)
const currentPage = ref(1)
const localPageSize = ref(5)
const pageSizeOptions = computed(() => [...new Set([localPageSize.value, 5, 10, 15, 20])].sort((a, b) => a - b))

const dateRange = ref([])
const selectedConfigId = ref(null)
const configOptions = ref([])

// 从数据中自动提取列名
const computedColumns = computed(() => {
  if (data.value && data.value.length > 0) {
    return Object.keys(data.value[0]).filter(displayStore.isFieldVisible)
  }
  return []
})

// 根据列名返回合适的列宽度
const getColumnWidth = (key) => {
  const lower = String(key).toLowerCase()
  if (lower === 'id' || lower === '序号') return 80
  if (lower.includes('时间') || lower.includes('操作时间')) return 195
  return ''
}

// 加载指令配置下拉选项
const fetchConfigOptions = async () => {
  try {
    const res = await api.get('/api/operation-history/configs')
    if (res.data.success) {
      configOptions.value = res.data.data
    }
  } catch (err) {
    console.error('[OperationHistory] 获取指令配置选项失败:', err)
  }
}

const handleSearch = async (page = 1) => {
  currentPage.value = page
  loading.value = true
  try {
    const res = await api.get('/api/operation-history', {
      params: {
        currentPage: page,
        pageSize: localPageSize.value,
        config_id: selectedConfigId.value !== null && selectedConfigId.value !== undefined && selectedConfigId.value !== '' ? selectedConfigId.value : null,
        startTime: dateRange.value?.[0] || null,
        endTime: dateRange.value?.[1] || null
      }
    })
    if (res.data.success) {
      data.value = res.data.data.list
      total.value = res.data.data.total
    }
  } catch (err) {
    console.error('[OperationHistory] 获取数据失败:', err)
  } finally {
    loading.value = false
  }
}

const handlePageChange = (page) => {
  handleSearch(page)
}

const handleSizeChange = (size) => {
  localPageSize.value = size
  handleSearch(1)
}

onMounted(async () => {
  try {
    const config = await systemStore.load()
    localPageSize.value = config.DEFAULT_PAGE_SIZE || 5
  } catch (err) {
    // 取不到就用默认值 5
  }
  await fetchConfigOptions()
  await handleSearch(1)
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

.search-form-inner .el-button {
  min-width: 100px;
}

.pagination-wrapper {
  margin-top: 24px;
  display: flex;
  justify-content: center;
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
</style>
