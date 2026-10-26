<!--
 * 【文件职责】智能判定记录页（菜单「智能判定记录」，路由 /judgment-history）。
 *   展示 t_judgment_record 的分页列表：ID / 设备编号 / 数据类型 / 原数据ID / 判定结论 /
 *   置信度 / 状态 / 错误信息 / 判定时间；支持按设备编号、状态、时间范围筛选。
 *
 * 【接口】GET /api/intelligent/records?page&pageSize&d_no&status&startTime&endTime
 *   （控制器 controllers/intelligent/records.js；查询前会自动建表）
 *
 * 【「状态」下拉里的值是什么意思】（就是落库的 status）
 *   success        手动判定 + 真实判定服务成功
 *   mock           手动判定 + 本地占位判定（服务未启用，结论是本地猜的）
 *   auto           自动判定（后端定时器）成功
 *   auto_mock      自动判定 + 本地占位
 *   realtime       实时判定（每条消息）成功 —— 调用点默认注释，一般看不到
 *   realtime_mock  实时判定 + 本地占位
 *   failed         这一轮失败（超时 / 服务报错 / 响应不是 JSON），原因看「错误信息」列
 *
 * 【「数据类型」列】sensor / behavior / combined —— 区分这条记录是哪条链路判的
 *   （combined 是组合判定，带传感器 + 行为两侧字段；详见 JUDGMENT_GUIDE.md 第 4 节）。
 *
 * 【想看"判定服务到底收到了什么"】本页不展示请求/响应体（列表接口没返回），直接查库：
 *   SELECT data_type, status, conclusion, request_body, response_body
 *   FROM t_judgment_record ORDER BY id DESC LIMIT 5;
 *
 * 【配置中心关联】页面通过状态仓库读取配置中心；显示开关见
 *   INTELLIGENT_JUDGMENT.showHistoryMenu（菜单显隐）、HIDE_ID_FIELDS / HIDE_NUMBER_FIELDS（列显隐）。
 * -->
<template>
  <div>
    <div class="toolbar">
      <el-input v-model="deviceNo" clearable placeholder="设备编号" style="width: 220px" @keyup.enter="load" />
      <el-select v-model="status" clearable placeholder="判定状态" style="width: 160px">
        <el-option label="成功" value="success" />
        <el-option label="本地模拟" value="mock" />
        <el-option label="失败" value="failed" />
        <el-option label="自动判定" value="auto" />
        <el-option label="自动模拟" value="auto_mock" />
        <el-option label="实时判定" value="realtime" />
        <el-option label="实时模拟" value="realtime_mock" />
      </el-select>
      <el-date-picker
        v-model="dateRange"
        type="datetimerange"
        start-placeholder="开始时间"
        end-placeholder="结束时间"
        format="YYYY-MM-DD HH:mm:ss"
        value-format="YYYY-MM-DD HH:mm:ss"
        :clearable="true"
      />
      <el-button type="primary" @click="page = 1; load()">查询</el-button>
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
import { useSystemConfigStore } from '@/stores/useSystemConfigStore'
import { useDisplayStore } from '@/stores/useDisplayStore'

const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const deviceNo = ref('')
const status = ref('')
// 跟"历史数据查询"（TableContainer.vue）同样的时间范围筛选，精确到秒；
// 不选时间就不传 startTime/endTime，后端 /intelligent/records 接口本来就支持
// 这两个参数（见 controllers/intelligent/records.js），只是这个页面之前没接上。
const dateRange = ref([])
const loading = ref(false)
const systemStore = useSystemConfigStore()
const displayStore = useDisplayStore()
const pageSizeOptions = computed(() => [...new Set([pageSize.value, 5, 10, 20, 50])].sort((a, b) => a - b))

async function load() {
  loading.value = true
  try {
    const [startTime, endTime] = dateRange.value || []
    const response = await api.get('/api/intelligent/records', {
      params: { page: page.value, pageSize: pageSize.value, d_no: deviceNo.value, status: status.value, startTime, endTime },
    })
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
