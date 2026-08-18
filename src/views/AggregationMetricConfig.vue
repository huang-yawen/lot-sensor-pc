<!--
 * 【文件职责】
 * 业务页面，负责组合数据、状态和用户操作，呈现完整功能界面。
 * 【配置中心关联】
 * 页面通过状态仓库读取配置中心；场景开关保存后，相关显示与交互按最新配置更新。
 * -->
<template>
  <div class="aggregation-config" v-loading="loading">
    <el-alert type="info" :closable="false" show-icon title="累计与滑动指标统一在这里维护。保存后，首页独立图表和历史页内嵌列会按显示位置立即生效。" />

    <section v-for="section in sections" :key="section.type" class="metric-section">
      <div class="section-heading">
        <div>
          <h3>{{ section.title }}</h3>
          <p>{{ section.description }}</p>
        </div>
        <el-button type="primary" plain @click="openCreate(section.type)">新增{{ section.shortTitle }}</el-button>
      </div>
      <el-table :data="section.rows" border stripe row-key="metric_key">
        <el-table-column prop="metric_name" label="指标名称" min-width="150" />
        <el-table-column prop="metric_key" label="指标标识" min-width="150" />
        <el-table-column label="来源" min-width="180">
          <template #default="scope">{{ tableLabel(scope.row.source_table) }} / {{ scope.row.source_field }}</template>
        </el-table-column>
        <el-table-column label="计算" min-width="170">
          <template #default="scope">
            <template v-if="section.type === 'window'">{{ aggregationLabel(scope.row.aggregation) }}（{{ scope.row.window_size }} 条）</template>
            <template v-else>{{ cumulativeAggregationLabel(scope.row.aggregation) }}</template>
          </template>
        </el-table-column>
        <el-table-column prop="unit" label="单位" width="95" />
        <el-table-column label="显示位置" width="130"><template #default="scope">{{ modeLabel(scope.row.mode) }}</template></el-table-column>
        <el-table-column label="启用" width="85">
          <template #default="scope">
            <el-switch v-model="scope.row.enabled" :loading="toggling" @change="toggleEnabled(section.type, scope.$index)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="145" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="openEdit(section.type, scope.$index)">编辑</el-button>
            <el-button link type="danger" @click="remove(section.type, scope.$index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <div class="save-bar">
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingIndex < 0 ? `新增${dialogType === 'cumulative' ? '累计' : '滑动'}指标` : '编辑指标'" width="760px" :close-on-click-modal="false">
      <el-form label-width="105px">
        <div class="form-grid">
          <el-form-item label="指标名称"><el-input v-model="form.metric_name" placeholder="例如：累计流量" /></el-form-item>
          <el-form-item label="指标标识"><el-input v-model="form.metric_key" placeholder="例如：cumulative_flow" /></el-form-item>
          <el-form-item label="数据表">
            <el-select v-model="form.source_table"><el-option label="传感数据" value="t_sensor_data" /><el-option label="运行状态" value="t_behavior_data" /></el-select>
          </el-form-item>
          <el-form-item label="源字段"><el-input v-model="form.source_field" placeholder="例如：field3" /></el-form-item>
          <el-form-item label="计算方式">
            <el-select v-if="dialogType === 'cumulative'" v-model="form.aggregation"><el-option label="累计求和" value="sum" /><el-option label="累计平均" value="avg" /></el-select>
            <el-select v-else v-model="form.aggregation"><el-option label="滑动平均" value="avg" /><el-option label="波动幅度（最大-最小）" value="volatility" /><el-option label="相邻变化量" value="rate" /></el-select>
          </el-form-item>
          <el-form-item v-if="dialogType === 'window'" label="窗口条数"><el-input-number v-model="form.window_size" :min="2" :max="100" /></el-form-item>
          <el-form-item label="单位"><el-input v-model="form.unit" placeholder="例如：L、℃" /></el-form-item>
          <el-form-item label="小数位"><el-input-number v-model="form.precision" :min="0" :max="6" /></el-form-item>
          <el-form-item label="显示位置">
            <el-select v-model="form.mode"><el-option label="仅首页独立图表" value="standalone" /><el-option label="仅历史页" value="inline" /><el-option label="首页和历史页" value="both" /></el-select>
          </el-form-item>
          <el-form-item label="图表类型"><el-select v-model="form.chart_type"><el-option label="折线图" value="line" /><el-option label="柱状图" value="bar" /></el-select></el-form-item>
          <el-form-item label="系列颜色"><el-color-picker v-model="form.color" /></el-form-item>
          <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
        </div>
      </el-form>
      <el-alert type="warning" :closable="false" title="源字段必须是所选数据表中的数值字段；启用前请先确认数据库确实存在该列。" />
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="applyDialog">确定</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const loading = ref(false)
const saving = ref(false)
const toggling = ref(false)
const cumulative = ref([])
const windows = ref([])
const dialogVisible = ref(false)
const dialogType = ref('cumulative')
const editingIndex = ref(-1)
const blank = type => ({ metric_key: '', metric_name: '', source_table: 't_sensor_data', source_field: '', unit: '', enabled: true, mode: 'standalone', precision: 2, chart_type: 'line', color: '#409EFF', ...(type === 'window' ? { aggregation: 'avg', window_size: 5 } : { aggregation: 'sum' }) })
const form = reactive(blank('cumulative'))
const sections = computed(() => [
  { type: 'cumulative', title: '累计指标', shortTitle: '累计指标', description: '从第一条匹配数据开始持续累加，适合累计流量、累计能耗和累计运行时长。', rows: cumulative.value },
  { type: 'window', title: '滑动统计指标', shortTitle: '滑动指标', description: '按最近 N 条数据计算平均值、波动幅度或相邻变化量。', rows: windows.value },
])

const rowsFor = type => type === 'cumulative' ? cumulative.value : windows.value
const tableLabel = table => table === 't_behavior_data' ? '运行状态' : '传感数据'
const aggregationLabel = value => ({ avg: '滑动平均', volatility: '波动幅度', rate: '相邻变化量' }[value] || value)
const cumulativeAggregationLabel = value => (value === 'avg' ? '累计平均' : '累计求和')
const modeLabel = value => ({ standalone: '首页', inline: '历史页', both: '首页 + 历史页' }[value] || value)

async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/system-config')
    cumulative.value = structuredClone(response.data.data.CUMULATIVE_METRICS || [])
    windows.value = structuredClone(response.data.data.TIME_WINDOW_METRICS || [])
  } catch (error) { ElMessage.error(error.response?.data?.message || '指标配置加载失败') }
  finally { loading.value = false }
}

function openCreate(type) {
  dialogType.value = type
  editingIndex.value = -1
  Object.assign(form, blank(type))
  dialogVisible.value = true
}

function openEdit(type, index) {
  dialogType.value = type
  editingIndex.value = index
  Object.assign(form, blank(type), structuredClone(rowsFor(type)[index]))
  dialogVisible.value = true
}

// 每次增/改/删都立即调后端持久化，不再要求另外点一个容易漏点的“保存”按钮；
// 保存失败会把本地表格回滚回操作前的状态，避免界面显示“已配置”但其实没保存成功的假象。
async function persist() {
  saving.value = true
  try {
    await api.post('/api/system-config', { CUMULATIVE_METRICS: cumulative.value, TIME_WINDOW_METRICS: windows.value })
    ElMessage.success('已保存并立即生效')
    await load()
    return true
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '保存失败，改动未生效')
    return false
  } finally {
    saving.value = false
  }
}

async function applyDialog() {
  const required = ['metric_name', 'metric_key', 'source_table', 'source_field']
  if (required.some(key => !String(form[key] || '').trim())) return ElMessage.warning('请填写指标名称、标识、数据表和源字段')
  const value = structuredClone(form)
  if (dialogType.value === 'cumulative') {
    delete value.window_size
  }
  const rows = rowsFor(dialogType.value)
  const before = structuredClone(rows)
  if (editingIndex.value < 0) rows.push(value)
  else rows.splice(editingIndex.value, 1, value)

  const ok = await persist()
  if (ok) {
    dialogVisible.value = false
  } else {
    rows.splice(0, rows.length, ...before)
  }
}

async function remove(type, index) {
  try {
    await ElMessageBox.confirm(`确定删除“${rowsFor(type)[index].metric_name}”吗？`, '删除确认', { type: 'warning' })
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error.message || '删除失败')
    return
  }
  const rows = rowsFor(type)
  const before = structuredClone(rows)
  rows.splice(index, 1)
  const ok = await persist()
  if (!ok) rows.splice(0, rows.length, ...before)
}

// 列表里的启用开关直接切换并立即保存，失败时回滚，避免“看起来已启用但实际没保存”。
async function toggleEnabled(type, index) {
  const rows = rowsFor(type)
  const previous = rows[index].enabled
  toggling.value = true
  try {
    const ok = await persist()
    if (!ok) rows[index].enabled = previous
  } finally {
    toggling.value = false
  }
}

load()
</script>

<style scoped>
.metric-section { margin-top: 18px; padding: 18px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.section-heading h3 { margin: 0 0 5px; color: #0f172a; }
.section-heading p { margin: 0; color: #64748b; }
.save-bar { display: flex; gap: 10px; margin-top: 18px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
@media (max-width: 760px) { .form-grid { grid-template-columns: 1fr; } .section-heading { align-items: flex-start; flex-direction: column; } }
</style>
