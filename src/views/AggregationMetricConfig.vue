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
        <el-table-column v-if="section.type === 'window'" label="计算" min-width="150">
          <template #default="scope">{{ aggregationLabel(scope.row.aggregation) }}（{{ scope.row.window_size }} 条）</template>
        </el-table-column>
        <el-table-column prop="unit" label="单位" width="95" />
        <el-table-column label="显示位置" width="130"><template #default="scope">{{ modeLabel(scope.row.mode) }}</template></el-table-column>
        <el-table-column label="状态" width="85"><template #default="scope"><el-tag :type="scope.row.enabled ? 'success' : 'info'">{{ scope.row.enabled ? '启用' : '停用' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="145" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="openEdit(section.type, scope.$index)">编辑</el-button>
            <el-button link type="danger" @click="remove(section.type, scope.$index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <div class="save-bar">
      <el-button type="primary" :loading="saving" @click="save">校验并保存全部指标</el-button>
      <el-button @click="load">放弃未保存修改</el-button>
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
          <el-form-item v-if="dialogType === 'window'" label="计算方式">
            <el-select v-model="form.aggregation"><el-option label="滑动平均" value="avg" /><el-option label="波动幅度（最大-最小）" value="volatility" /><el-option label="相邻变化量" value="rate" /></el-select>
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
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" @click="applyDialog">确定</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const loading = ref(false)
const saving = ref(false)
const cumulative = ref([])
const windows = ref([])
const dialogVisible = ref(false)
const dialogType = ref('cumulative')
const editingIndex = ref(-1)
const blank = type => ({ metric_key: '', metric_name: '', source_table: 't_sensor_data', source_field: '', unit: '', enabled: true, mode: 'standalone', precision: 2, chart_type: 'line', color: '#409EFF', ...(type === 'window' ? { aggregation: 'avg', window_size: 5 } : {}) })
const form = reactive(blank('cumulative'))
const sections = computed(() => [
  { type: 'cumulative', title: '累计指标', shortTitle: '累计指标', description: '从第一条匹配数据开始持续累加，适合累计流量、累计能耗和累计运行时长。', rows: cumulative.value },
  { type: 'window', title: '滑动统计指标', shortTitle: '滑动指标', description: '按最近 N 条数据计算平均值、波动幅度或相邻变化量。', rows: windows.value },
])

const rowsFor = type => type === 'cumulative' ? cumulative.value : windows.value
const tableLabel = table => table === 't_behavior_data' ? '运行状态' : '传感数据'
const aggregationLabel = value => ({ avg: '滑动平均', volatility: '波动幅度', rate: '相邻变化量' }[value] || value)
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

function applyDialog() {
  const required = ['metric_name', 'metric_key', 'source_table', 'source_field']
  if (required.some(key => !String(form[key] || '').trim())) return ElMessage.warning('请填写指标名称、标识、数据表和源字段')
  const value = structuredClone(form)
  if (dialogType.value === 'cumulative') {
    delete value.aggregation
    delete value.window_size
  }
  const rows = rowsFor(dialogType.value)
  if (editingIndex.value < 0) rows.push(value)
  else rows.splice(editingIndex.value, 1, value)
  dialogVisible.value = false
}

async function remove(type, index) {
  try {
    await ElMessageBox.confirm(`确定删除“${rowsFor(type)[index].metric_name}”吗？保存前仍可通过重新加载撤销。`, '删除确认', { type: 'warning' })
    rowsFor(type).splice(index, 1)
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error.message || '删除失败') }
}

async function save() {
  saving.value = true
  try {
    await api.post('/api/system-config', { CUMULATIVE_METRICS: cumulative.value, TIME_WINDOW_METRICS: windows.value })
    ElMessage.success('累计与滑动指标已保存并立即生效')
    await load()
  } catch (error) { ElMessage.error(error.response?.data?.message || '保存失败') }
  finally { saving.value = false }
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
