<template>
  <div class="error-info-page">
    <div class="error-info-container">
      <div class="search-form">
        <div class="search-form-inner">
          <el-input v-model="keyword" style="width: 240px; flex-shrink: 0;" placeholder="输入设备编号" :suffix-icon="Search"
            clearable />
          <div class="block" style="flex-shrink: 0;">
            <el-date-picker v-model="dateRange" type="datetimerange" start-placeholder="开始时间" end-placeholder="结束时间"
              format="YYYY-MM-DD HH:mm:ss" date-format="YYYY/MM/DD ddd" time-format="A hh:mm:ss"
              style="margin-left: 30px;" :clearable="true" />
          </div>
          <div class="button-wrapper">
            <el-button type="primary" @click="handleSearch(1)" :loading="loading">
              开始查找
            </el-button>
          </div>
        </div>
      </div>
      <div class="table-wrapper">
        <table v-if="store.errData.length > 0">
          <thead>
            <tr>
              <th v-for="col in headers" :key="col">
                {{ col }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, idx) in store.errData" :key="idx">
              <td v-for="col in headers" :key="col">
                {{ row[col] }}
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty-state">
          {{ loading ? '加载中...' : '暂无错误数据' }}
        </div>
      </div>

      <div class="pagination-wrapper">
        <el-pagination v-model:current-page="currentPage" v-model:page-size="pageSize" :page-sizes="[5, 10, 15, 20]"
          :background="true" layout="sizes, prev, pager, next" :total="store.total || 0"
          @size-change="handlePageSizeChange" @current-change="handlePageChange" />
      </div>
    </div>
    <div class="chart-container">
      <div class="chart-panel">
        <PieChart :data="store.errTypeStats" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { Search } from "@element-plus/icons-vue";
import PieChart from "../components/PieChart.vue";
import { ErrorStore } from "../stores/ErrorStore";

const store = ErrorStore();

const currentPage = ref(1);
const pageSize = ref(5);
const keyword = ref("");
const dateRange = ref(null);
const loading = ref(false);

const headers = computed(() => {
  const data = store.errData;
  return data.length ? Object.keys(data[0]) : [];
});

const getSearchParams = () => ({
  keyword: keyword.value,
  startTime: dateRange.value?.[0] || null,
  endTime: dateRange.value?.[1] || null,
});

const handleSearch = async (page = 1) => {
  loading.value = true;
  try {
    const params = getSearchParams();
    await Promise.all([
      store.fetchErrData({
        ...params,
        currentPage: page,
        pageSize: pageSize.value,
      }),
      store.fetchErrTypeStats(params),
    ]);
  } finally {
    loading.value = false;
  }
};

const handlePageChange = (page) => {
  currentPage.value = page;
  handleSearch(page);
};

const handlePageSizeChange = (size) => {
  pageSize.value = size;
  currentPage.value = 1;
  handleSearch(1);
};

onMounted(async () => {
  await handleSearch();
});
</script>

<style scoped>
.error-info-page {
  width: 100%;
  min-height: 100%;
  display: flex !important;
  flex-direction: column !important;
  align-items: stretch;
  gap: 20px;
  box-sizing: border-box;
}
           
.error-info-container {
  width: 100%;
  flex: 0 0 auto;
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

.chart-container {
  display: flex;
  justify-content: center;
  width: 100%;
  min-height: 560px;
  flex: 0 0 auto;
  box-sizing: border-box;
}

.chart-panel {
  width: min(100%, 980px);
  min-height: 560px;
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

  .chart-container {
    min-height: 620px;
  }

  .chart-panel {
    width: 100%;
    min-height: 620px;
  }

  .table-wrapper th,
  .table-wrapper td {
    padding: 8px 12px;
    font-size: 12px;
  }
}
</style>
