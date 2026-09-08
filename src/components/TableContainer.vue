<!--
 * 【文件职责】
 * 可复用界面组件，负责展示数据或组织页面布局。
 * 【配置中心关联】
 * 不持久化配置中心；需要展示场景信息时由父组件或状态仓库传入。
 * -->
<template>
  <div class="table-container">
    <!-- 搜索表单区域 -->
    <div class="search-form">
      <div class="search-form-inner">
        <el-input
          v-model="keyword"
          style="width: 240px; flex-shrink: 0;"
          :placeholder="searchPlaceholder"
          :suffix-icon="Search"
          clearable
        />
        <div class="block" style="flex-shrink: 0;">
          <el-date-picker
            v-model="dateRange"
            type="datetimerange"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
            format="YYYY-MM-DD HH:mm:ss"
            value-format="YYYY-MM-DD HH:mm:ss"
            style="margin-left: 30px;"
            :clearable="true"
          />
        </div>
        <div class="button-wrapper">
          <el-button
            type="primary"
            @click="handleSearch(1)"
            :loading="loading"
          >
            开始查找
          </el-button>
          <!-- 页面扩展操作按钮插槽 -->
          <slot name="actions" />
        </div>
      </div>
    </div>

    <!-- 表格区域（Element Plus el-table 带复选框） -->
    <div class="table-wrapper">
      <el-table
        ref="tableRef"
        :data="data"
        style="width: 100%"
        @selection-change="onSelectionChange"
        v-if="data.length > 0"
        border
        stripe
        :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: 600 }"
      >
        <el-table-column type="selection" width="55" align="center" />
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
import { ref, watch, computed } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { useDisplayStore } from '@/stores/DisplayStore'

const displayStore = useDisplayStore()

const props = defineProps({
  data: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
  total: {
    type: Number,
    default: 0
  },
  pageSize: {
    type: Number,
    default: 5
  },
  // 数据范围筛选值（'实时数据' | '保存数据' | 空），跟设备在线状态无关。
  dataScope: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    default: 'sensor'
  },
  searchPlaceholder: {
    type: String,
    default: '输入关键词搜索'
  }
})

const emit = defineEmits(['search', 'pageChange', 'sizeChange', 'selectionChange'])

const keyword = ref('')
const dateRange = ref([])
const currentPage = ref(1)
const localPageSize = ref(props.pageSize)
const tableRef = ref(null)
const pageSizeOptions = computed(() => [...new Set([props.pageSize, 5, 10, 15, 20])].sort((a, b) => a - b))

// 从数据中自动提取列，再按全局显示开关过滤 id/编号。
const computedColumns = computed(() => {
  if (props.data && props.data.length > 0) {
    const firstItem = props.data[0]
    return Object.keys(firstItem).filter(displayStore.isFieldVisible)
  }
  return []
})

// 根据列名返回合适的列宽度
const getColumnWidth = (key) => {
  const lower = String(key).toLowerCase()
  if (lower === 'id' || lower === '序号') return 80
  if (lower.includes('时间') || lower.includes('创立时间') || lower.includes('操作时间') || lower.includes('创建时间')) return 195
  return ''
}

// 多选回调
const onSelectionChange = (selection) => {
  emit('selectionChange', selection)
}

watch(() => props.pageSize, (newVal) => {
  localPageSize.value = newVal
})

const handleSearch = (page = 1) => {
  currentPage.value = page
  emit('search', {
    keyword: keyword.value,
    startTime: dateRange.value?.[0] || null,
    endTime: dateRange.value?.[1] || null,
    dataScope: props.dataScope,
    type: props.type,
    currentPage: page,
    pageSize: localPageSize.value
  })
}

const handlePageChange = (page) => {
  emit('pageChange', page)
}

const handleSizeChange = (size) => {
  localPageSize.value = size
  emit('sizeChange', size)
}

defineExpose({
  handleSearch,
  tableRef
})
</script>

<style scoped>
.table-container {
  width: 100%;
}

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

  .search-form-inner .el-input,
  .search-form-inner .el-date-picker {
    width: 100% !important;
    margin-left: 0 !important;
    margin-bottom: 10px;
  }
}
</style>
