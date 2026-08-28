<!--
 * 【文件职责】
 * 业务页面，负责组合数据、状态和用户操作，呈现完整功能界面。
 * 【配置中心关联】
 * 页面通过状态仓库读取配置中心；场景开关保存后，相关显示与交互按最新配置更新。
 * -->
<template>
  <div class="error-info-page">
    <div class="error-info-container">
      <div class="search-form">
        <div class="search-form-inner">
          <el-input v-model="keyword" style="width: 240px; flex-shrink: 0;" placeholder="输入设备编号" :suffix-icon="Search"
            clearable />
          <div class="block" style="flex-shrink: 0;">
            <el-date-picker v-model="dateRange" type="datetimerange" start-placeholder="开始时间" end-placeholder="结束时间"
              format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DD HH:mm:ss"
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
        <el-table
          :data="store.errData"
          style="width: 100%"
          v-if="store.errData.length > 0"
          border
          stripe
          :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: 600 }"
        >
          <el-table-column
            v-for="col in headers"
            :key="col"
            :prop="col"
            :label="col"
            show-overflow-tooltip
            align="center"
          />
        </el-table>
        <div v-else class="empty-state">
          {{ loading ? '加载中...' : '暂无错误数据' }}
        </div>
      </div>

      <div class="pagination-wrapper">
        <el-pagination v-model:current-page="currentPage" v-model:page-size="pageSize" :page-sizes="pageSizeOptions"
          :background="true" layout="sizes, prev, pager, next" :total="store.total || 0"
          @size-change="handlePageSizeChange" @current-change="handlePageChange" />
      </div>
    </div>

    <div class="error-info-container safety-container" v-if="showSafetyLog">
      <h3 class="section-title">安全联锁记录</h3>
      <div class="table-wrapper">
        <el-table
          :data="store.safetyData"
          style="width: 100%"
          v-if="store.safetyData.length > 0"
          border
          stripe
          :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: 600 }"
        >
          <el-table-column
            v-for="col in safetyHeaders"
            :key="col"
            :prop="col"
            :label="col"
            show-overflow-tooltip
            align="center"
          />
        </el-table>
        <div v-else class="empty-state">
          {{ store.safetyLoading ? '加载中...' : '暂无安全联锁记录' }}
        </div>
      </div>

      <div class="pagination-wrapper">
        <el-pagination v-model:current-page="safetyCurrentPage" v-model:page-size="safetyPageSize" :page-sizes="pageSizeOptions"
          :background="true" layout="sizes, prev, pager, next" :total="store.safetyTotal || 0"
          @size-change="handleSafetyPageSizeChange" @current-change="handleSafetyPageChange" />
      </div>

      <div class="chart-container" v-if="chartsEnabled">
        <div class="chart-panel">
          <PieChart :data="store.safetyTypeStats" title="安全联锁类型分布" />
        </div>
      </div>
    </div>

    <div class="chart-container" v-if="chartsEnabled">
      <div class="chart-panel">
        <PieChart :data="store.errTypeStats" title="故障类型分布" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Search } from "@element-plus/icons-vue";
import PieChart from "../components/PieChart.vue";
import { ErrorStore } from "../stores/ErrorStore";
import { DisplayStore } from "@/stores/DisplayStore";
import { useSystemConfigStore } from "@/stores/SystemConfigStore";
import { connect, on as wsOn } from "@/utils/websocket";

const store = ErrorStore();
const displayStore = DisplayStore();
const systemStore = useSystemConfigStore();

const currentPage = ref(1);
const pageSize = ref(5);
const keyword = ref("");
const dateRange = ref([]);
const loading = ref(false);
const chartsEnabled = computed(() => systemStore.config.ENABLE_CHARTS !== false);
const pageSizeOptions = computed(() => [...new Set([pageSize.value, 5, 10, 15, 20])].sort((a, b) => a - b));

// 安全联锁记录表格是否显示，由配置中心 SAFETY_INTERLOCK.showOnErrorPage 控制。
const showSafetyLog = computed(() => systemStore.config.SAFETY_INTERLOCK?.showOnErrorPage !== false);
const safetyCurrentPage = ref(1);
const safetyPageSize = ref(5);

// 故障记录是手写表格，也统一过滤 id/编号列。
const headers = computed(() => {
  const data = store.errData;
  return data.length ? Object.keys(data[0]).filter(displayStore.isFieldVisible) : [];
});

const safetyHeaders = computed(() => {
  const data = store.safetyData;
  return data.length ? Object.keys(data[0]).filter(displayStore.isFieldVisible) : [];
});

const getSearchParams = () => ({
  keyword: keyword.value,
  startTime: dateRange.value?.[0] || null,
  endTime: dateRange.value?.[1] || null,
});

const handleSearch = async (page = 1, showLoading = true) => {
  if (showLoading) loading.value = true;
  try {
    const params = getSearchParams();
    // 顶部这一个搜索框同时驱动故障记录表格和下面的安全联锁记录表格，两个表格各自独立分页。
    safetyCurrentPage.value = 1;
    const tasks = [
      store.fetchErrData({
        ...params,
        currentPage: page,
        pageSize: pageSize.value,
      }),
      store.fetchErrTypeStats(params),
    ];
    if (showSafetyLog.value) {
      tasks.push(store.fetchSafetyData({ ...params, currentPage: 1, pageSize: safetyPageSize.value }));
      tasks.push(store.fetchSafetyTypeStats(params));
    }
    await Promise.all(tasks);
  } finally {
    if (showLoading) loading.value = false;
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

const handleSafetyPageChange = (page) => {
  safetyCurrentPage.value = page;
  store.fetchSafetyData({ ...getSearchParams(), currentPage: page, pageSize: safetyPageSize.value });
};

const handleSafetyPageSizeChange = (size) => {
  safetyPageSize.value = size;
  safetyCurrentPage.value = 1;
  store.fetchSafetyData({ ...getSearchParams(), currentPage: 1, pageSize: size });
};

// WebSocket 推送新故障/告警数据时，用当前页码和筛选条件静默刷新（不切换 loading），
// 让故障记录表格和饼图能实时看到最新数据，不用手动刷新页面。
let unsubscribeError = null;

onMounted(async () => {
  await Promise.all([systemStore.load(), displayStore.loadDisplayConfig()]);
  pageSize.value = systemStore.config.DEFAULT_PAGE_SIZE || 5;
  await handleSearch();

  connect();
  unsubscribeError = wsOn("error_data", () => handleSearch(currentPage.value, false));
});

onUnmounted(() => {
  unsubscribeError?.();
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

.safety-container {
  margin-top: 8px;
}

.section-title {
  margin: 0 0 14px;
  color: #0f172a;
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
