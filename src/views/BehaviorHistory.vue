<template>
  <div>
    <TableContainer
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
    />
    <div class="chartContainer">
      <LineBarCharts :data="data" :pageSize="pageSize" />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { PaginationStore } from '@/stores/PaginationStore.js'
import TableContainer from '@/components/TableContainer.vue'
import LineBarCharts from '@/components/LineBarCharts.vue'

const store = PaginationStore()

const online = '保存数据'

const data = computed(() => store.paginationData || [])
const loading = computed(() => store.loading || false)
const total = computed(() => store.total || 0)
const pageSize = computed(() => store.pageSize || 5)

const handleSearch = async (params) => {
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
    keyword: '',
    startTime: null,
    endTime: null,
    online: online
  })
}

const handleSizeChange = (size) => {
  store.pageSize = size
  handleSearch({
    type: 'behavior',
    currentPage: 1,
    pageSize: size,
    keyword: '',
    startTime: null,
    endTime: null,
    online: online
  })
}

onMounted(async () => {
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
</style>
