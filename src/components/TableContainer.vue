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
            date-format="YYYY/MM/DD ddd"
            time-format="A hh:mm:ss"
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
        </div>
      </div>
    </div>

    <!-- 表格区域 -->
    <div class="table-wrapper">
      <table v-if="data.length > 0">
        <thead>
          <tr>
            <th v-for="key in computedColumns" :key="key">
              {{ key }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, rowIndex) in data" :key="rowIndex">
            <td v-for="key in computedColumns" :key="key">
              {{ item[key] }}
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty-state">
        {{ loading ? '加载中...' : '暂无数据' }}
      </div>
    </div>

    <!-- 分页器 -->
    <div class="pagination-wrapper">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="localPageSize"
        :page-sizes="[5, 10, 15, 20]"
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
import { DisplayStore } from '@/stores/DisplayStore'

const displayStore = DisplayStore()

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
  online: {
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

const emit = defineEmits(['search', 'pageChange', 'sizeChange'])

const keyword = ref('')
const dateRange = ref(null)
const currentPage = ref(1)
const localPageSize = ref(props.pageSize)

// 从数据中自动提取列
const computedColumns = computed(() => {
  if (props.data && props.data.length > 0) {
    const firstItem = props.data[0]
    return Object.keys(firstItem).filter(displayStore.isFieldVisible)
  }
  return []
})

watch(() => props.pageSize, (newVal) => {
  localPageSize.value = newVal
})

const handleSearch = (page = 1) => {
  currentPage.value = page
  emit('search', {
    keyword: keyword.value,
    startTime: dateRange.value?.[0] || null,
    endTime: dateRange.value?.[1] || null,
    online: props.online,
    type: props.type,
    currentPage: page,
    pageSize: localPageSize.value
  })
}

const handlePageChange = (page) => {
  emit('pageChange', page)
  handleSearch(page)
}

const handleSizeChange = (size) => {
  localPageSize.value = size
  emit('sizeChange', size)
  handleSearch(1)
}

defineExpose({
  handleSearch
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
  width: 100px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.button-wrapper .el-button {
  width: 100%;
  min-width: 100px;
}

.pagination-wrapper {
  margin-left: 0;
  margin-top: 24px;
  display: flex;
  justify-content: center;
}

.table-wrapper {
  background: white;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
  overflow: auto;
}

.table-wrapper table {
  width: 100%;
  text-align: center;
  border-collapse: collapse;
  font-size: 14px;
}

.table-wrapper th {
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  color: #475569;
  font-weight: 600;
  padding: 14px 16px;
  border-bottom: 2px solid #e2e8f0;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.table-wrapper td {
  padding: 14px 16px;
  border-bottom: 1px solid #f1f5f9;
  color: #334155;
}

.table-wrapper tbody tr {
  transition: background-color 0.2s ease;
}

.table-wrapper tbody tr:hover {
  background-color: #f8fafc;
}

.table-wrapper tbody tr:hover td {
  color: #1e293b;
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

  .table-wrapper th,
  .table-wrapper td {
    padding: 8px 12px;
    font-size: 12px;
  }
}
</style>
