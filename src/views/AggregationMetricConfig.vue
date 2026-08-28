<!--
 * 【文件职责】
 * 业务页面，负责组合数据、状态和用户操作，呈现完整功能界面。
 * 【配置中心关联】
 * 页面通过状态仓库读取配置中心；场景开关保存后，相关显示与交互按最新配置更新。
 * -->
<template>
  <div class="aggregation-config" v-loading="loading">
    <el-alert type="info" :closable="false" show-icon title="累计与滑动指标统一在这里维护。保存后，历史图表页面的独立图表和汇总数据页面（传感器汇总数据/行为汇总数据，取决于该指标的数据来源）内嵌列会按显示位置立即生效；实时数据页面暂不支持内嵌这两类指标。" />

    <!-- ==================== 历史图表页面显示控制 ==================== -->
    <section class="metric-section">
      <div class="section-heading">
        <div>
          <h3>历史图表页面显示控制</h3>
          <p>控制"历史图表"页面上每张图是否展示、每张图最多显示多少个数据点。比赛现场可以按需临时关掉不需要的图，减少页面干扰。</p>
        </div>
        <el-button type="primary" :loading="savingDisplay" @click="saveDisplayConfig">保存</el-button>
      </div>
      <el-form label-width="140px" class="display-form">
        <el-form-item label="每张图最多显示">
          <el-input-number v-model="displayConfig.pointLimit" :min="10" :max="2000" :step="50" />
          <span class="display-hint">个数据点；所选时间范围内数据超过这个数量时，只显示最近的这些点</span>
        </el-form-item>
      </el-form>
      <el-table :data="chartSwitches" border stripe>
        <el-table-column prop="label" label="图表" min-width="180" />
        <el-table-column prop="description" label="说明" min-width="260" />
        <el-table-column label="显示" width="90" align="center">
          <template #default="scope">
            <el-switch v-model="displayConfig[scope.row.key]" />
          </template>
        </el-table-column>
      </el-table>
    </section>

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
            <el-select v-if="dialogType === 'cumulative'" v-model="form.aggregation"><el-option label="累计求和" value="sum" /><el-option label="累计平均" value="avg" /><el-option label="开关持续时长（分钟）" value="on_duration" /></el-select>
            <el-select v-else v-model="form.aggregation"><el-option label="滑动平均" value="avg" /><el-option label="波动幅度（最大-最小）" value="volatility" /><el-option label="相邻变化量" value="rate" /></el-select>
            <div v-if="dialogType === 'cumulative' && form.aggregation === 'on_duration'" class="switch-hint">源字段需为开关型字段（值为 1/0），统计其为 1 期间累计经过的时长；仅支持"仅历史图表页面独立图表"这一显示位置。</div>
          </el-form-item>
          <el-form-item v-if="dialogType === 'window'" label="窗口条数"><el-input-number v-model="form.window_size" :min="2" :max="100" /></el-form-item>
          <el-form-item label="单位"><el-input v-model="form.unit" placeholder="例如：L、℃" /></el-form-item>
          <el-form-item label="小数位"><el-input-number v-model="form.precision" :min="0" :max="6" /></el-form-item>
          <el-form-item label="显示位置">
            <el-select v-model="form.mode"><el-option label="仅历史图表页面独立图表" value="standalone" /><el-option label="仅汇总数据页面内嵌列" value="inline" /><el-option label="历史图表页面 + 汇总数据页面" value="both" /></el-select>
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
const savingDisplay = ref(false)
const cumulative = ref([])
const windows = ref([])
const displayConfig = reactive({
  pointLimit: 300,
  showCumulative: true,
  showTimeWindow: true,
  showAverageChart: true,
  showTempChart: true,
  showFlowPressureChart: true,
  showPidTrackingChart: true,
  showDeviceStateChart: true,
  showDerivedMetricCharts: true,
})
const chartSwitches = [
  { key: 'showCumulative', label: '累计统计', description: '累计流量等持续累加指标的历史趋势图。' },
  { key: 'showTimeWindow', label: '滑动统计', description: '滑动平均、波动幅度、相邻变化量。' },
  { key: 'showAverageChart', label: '平均温度与平均流速', description: '(温度1+温度2)/2、流量÷管道面积算出的平均流速。' },
  { key: 'showTempChart', label: '温度曲线', description: '温度1、温度2 原始读数对比，能直接看出两路温差。' },
  { key: 'showFlowPressureChart', label: '瞬时流量与压力', description: '瞬时流量、压力原始读数，双轴对照。' },
  { key: 'showPidTrackingChart', label: 'PID跟踪对比', description: '目标温度参考线 + 温度2 实际值，直观看恒温控制精度。' },
  { key: 'showDeviceStateChart', label: '设备状态时间线', description: '水泵、加热开关状态阶梯图，展示自动控制的实际动作历史。' },
  { key: 'showDerivedMetricCharts', label: '自定义公式指标', description: '"公式与图表"里勾选了"历史图表"的自定义指标，每条一张图。' },
]
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
const cumulativeAggregationLabel = value => ({ avg: '累计平均', on_duration: '开关持续时长' }[value] || '累计求和')
const modeLabel = value => ({ standalone: '历史图表页面', inline: '汇总数据页面', both: '历史图表页面 + 汇总数据页面' }[value] || value)

async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/system-config')
    cumulative.value = structuredClone(response.data.data.CUMULATIVE_METRICS || [])
    windows.value = structuredClone(response.data.data.TIME_WINDOW_METRICS || [])
    Object.assign(displayConfig, response.data.data.HISTORY_CHARTS || {})
  } catch (error) { ElMessage.error(error.response?.data?.message || '指标配置加载失败') }
  finally { loading.value = false }
}

async function saveDisplayConfig() {
  savingDisplay.value = true
  try {
    await api.post('/api/system-config', { HISTORY_CHARTS: { ...displayConfig } })
    ElMessage.success('已保存并立即生效')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '保存失败，改动未生效')
  } finally {
    savingDisplay.value = false
  }
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
.display-form { margin-bottom: 14px; }
.display-hint { margin-left: 10px; color: #94a3b8; font-size: 12px; }
.save-bar { display: flex; gap: 10px; margin-top: 18px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
.switch-hint { margin-top: 4px; color: #94a3b8; font-size: 12px; }
@media (max-width: 760px) { .form-grid { grid-template-columns: 1fr; } .section-heading { align-items: flex-start; flex-direction: column; } }
</style>
