<template>
  <div>
    <el-alert type="info" :closable="false" show-icon>
      <template #title>公式由 MySQL 在查询时计算，不修改原始采集数据。支持 +、-、*、/、%、括号及 abs、round、min、max、sqrt、pow。</template>
    </el-alert>
    <el-collapse class="formula-guide">
      <el-collapse-item title="第一次配置公式请先看：所有选项的用途和填写规则" name="help">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="指标名称">页面上显示的中文名称，例如“进出水温差”。可以修改，不参与 SQL 计算。</el-descriptions-item>
          <el-descriptions-item label="指标标识">数据库和接口使用的唯一英文键，只能使用字母、数字和下划线，且不能与 field1～field10 重名。例如 temperature_delta。</el-descriptions-item>
          <el-descriptions-item label="单位 / 小数位">单位会跟在表格数值和图表轴名称后；小数位控制 SQL ROUND 的精度，通常温度取 1～2 位。</el-descriptions-item>
          <el-descriptions-item label="可用字段">按钮来自当前传感字段映射。按钮上的中文帮助识别含义，公式中真正使用的是括号里的 field1～field10。</el-descriptions-item>
          <el-descriptions-item label="计算公式">只允许下方列出的运算符和函数，不允许输入 SELECT、表名或其他 SQL。除数为 0 时返回 NULL，不会中断整次历史查询。</el-descriptions-item>
          <el-descriptions-item label="测试值 / 试算">给每个基础字段填写一组模拟数据，点击“验证并试算”。保存前必须确认结果、单位和现场手算结果一致。</el-descriptions-item>
          <el-descriptions-item label="显示位置">“启用指标”是总开关；实时页、历史页控制数值出现位置；图表控制是否生成 ECharts 系列。</el-descriptions-item>
          <el-descriptions-item label="图表类型">连续变化量通常选择折线图；需要对比离散时刻或不同指标时可选择柱状图。</el-descriptions-item>
          <el-descriptions-item label="左右 Y 轴">量纲或数值范围差异较大的指标应分轴，例如温度放左轴、流量放右轴，避免曲线被压平。</el-descriptions-item>
          <el-descriptions-item label="颜色 / 顺序">颜色控制该系列的线或柱；顺序越小越靠前，用于统一图例和系列排列。</el-descriptions-item>
          <el-descriptions-item label="Y 轴范围">留空表示 ECharts 自动计算。任务书明确要求固定坐标范围时再填写，最小值必须小于最大值。</el-descriptions-item>
          <el-descriptions-item label="保存生效">保存后新的实时和历史查询立即使用。场景包导出时会自动包含这些公式和图表设置。</el-descriptions-item>
        </el-descriptions>
      </el-collapse-item>
    </el-collapse>
    <div class="examples">
      <span>2026水循环示例：</span>
      <code>field2 - field1</code><span>进出水温差(℃)</span>
      <code>(field1 + field2) / 2</code><span>平均温度(℃)</span>
      <code>abs(field2 - field1)</code><span>温差绝对值(℃)</span>
      <code>field3</code><span>循环流量(L/min，直接映射用柱状图)</span>
      <code>max(field2, field1)</code><span>最高温度(℃)</span>
      <code>round(field2 - field1, 1)</code><span>温差四舍五入到1位小数</span>
    </div>
    <div class="toolbar">
      <el-button type="primary" @click="openCreate">新增公式指标</el-button>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-table :data="metrics" v-loading="loading" border stripe>
      <el-table-column prop="metric_name" label="指标名称" min-width="130" />
      <el-table-column prop="metric_key" label="指标标识" min-width="130" />
      <el-table-column prop="formula" label="SQL公式" min-width="230" show-overflow-tooltip />
      <el-table-column prop="unit" label="单位" width="90" />
      <el-table-column prop="precision_digits" label="小数位" width="80" />
      <el-table-column label="显示位置" width="190">
        <template #default="scope">
          <el-tag v-if="scope.row.show_realtime" size="small">实时</el-tag>
          <el-tag v-if="scope.row.show_history" size="small" type="success">历史</el-tag>
          <el-tag v-if="scope.row.show_chart" size="small" type="warning">图表</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="ECharts" width="160">
        <template #default="scope">
          {{ scope.row.chart_type === 'bar' ? '柱状图' : '折线图' }} / {{ scope.row.y_axis === 'right' ? '右轴' : '左轴' }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="85">
        <template #default="scope"><el-tag :type="scope.row.enabled ? 'success' : 'info'">{{ scope.row.enabled ? '启用' : '停用' }}</el-tag></template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="openEdit(scope.row)">编辑</el-button>
          <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑公式指标' : '新增公式指标'" width="820px" :close-on-click-modal="false">
      <el-form label-width="110px">
        <div class="form-grid">
          <el-form-item label="指标名称"><el-input v-model="form.metric_name" placeholder="例如：进出水温差" /></el-form-item>
          <el-form-item label="指标标识"><el-input v-model="form.metric_key" placeholder="例如：temperature_delta" /></el-form-item>
          <el-form-item label="单位"><el-input v-model="form.unit" placeholder="例如：℃、kW" /></el-form-item>
          <el-form-item label="小数位"><el-input-number v-model="form.precision_digits" :min="0" :max="6" /></el-form-item>
        </div>

        <el-form-item label="可用字段">
          <div class="field-buttons">
            <el-button v-for="field in fields" :key="field.db_name" size="small" @click="insertField(field.db_name)">
              {{ field.f_name }}（{{ field.db_name }}）
            </el-button>
            <span v-if="!fields.length" class="field-warning">没有可用字段：请先在场景参数的 metadata.t_sensor_field_mapper 中配置传感字段。</span>
          </div>
        </el-form-item>
        <el-form-item label="计算公式">
          <el-input v-model="form.formula" type="textarea" :rows="3" placeholder="点击上方字段插入，例如：field2 - field1" />
        </el-form-item>

        <el-divider content-position="left">公式测试值</el-divider>
        <div class="test-grid">
          <label v-for="field in fields" :key="field.db_name">
            <span>{{ field.f_name }}（{{ field.db_name }}）</span>
            <el-input-number v-model="testValues[field.db_name]" :controls="false" />
          </label>
        </div>
        <div class="preview-row">
          <el-button :loading="previewing" @click="preview">验证并试算</el-button>
          <span v-if="previewResult">结果：<strong>{{ previewResult.result ?? 'NULL' }}</strong></span>
          <el-tooltip v-if="previewResult?.sql" :content="previewResult.sql" placement="top"><el-tag type="info">查看生成的 SQL</el-tag></el-tooltip>
        </div>

        <el-divider content-position="left">显示与 ECharts</el-divider>
        <div class="switch-row">
          <el-checkbox v-model="form.enabled">启用指标</el-checkbox>
          <el-checkbox v-model="form.show_realtime">实时页</el-checkbox>
          <el-checkbox v-model="form.show_history">历史页</el-checkbox>
          <el-checkbox v-model="form.show_chart">图表</el-checkbox>
        </div>
        <div class="form-grid chart-grid">
          <el-form-item label="图表类型">
            <el-select v-model="form.chart_type"><el-option label="折线图" value="line" /><el-option label="柱状图" value="bar" /></el-select>
          </el-form-item>
          <el-form-item label="Y轴">
            <el-select v-model="form.y_axis"><el-option label="左轴" value="left" /><el-option label="右轴" value="right" /></el-select>
          </el-form-item>
          <el-form-item label="系列颜色"><el-color-picker v-model="form.color" /></el-form-item>
          <el-form-item label="显示顺序"><el-input-number v-model="form.sort_order" :min="0" /></el-form-item>
          <el-form-item label="Y轴最小值"><el-input v-model="form.y_min" clearable placeholder="留空为自动" /></el-form-item>
          <el-form-item label="Y轴最大值"><el-input v-model="form.y_max" clearable placeholder="留空为自动" /></el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存并应用</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const emptyForm = () => ({ id: null, metric_name: '', metric_key: '', formula: '', unit: '', precision_digits: 2, enabled: true, show_realtime: true, show_history: true, show_chart: true, chart_type: 'line', y_axis: 'left', color: '#409EFF', y_min: '', y_max: '', sort_order: 0 })
const metrics = ref([])
const fields = ref([])
const loading = ref(false)
const saving = ref(false)
const previewing = ref(false)
const dialogVisible = ref(false)
const previewResult = ref(null)
const form = reactive(emptyForm())
const testValues = reactive({})

function assignForm(value) {
  Object.assign(form, emptyForm(), value, {
    enabled: Boolean(value?.enabled ?? true), show_realtime: Boolean(value?.show_realtime ?? true),
    show_history: Boolean(value?.show_history ?? true), show_chart: Boolean(value?.show_chart ?? true),
    y_min: value?.y_min ?? '', y_max: value?.y_max ?? '',
  })
  previewResult.value = null
}

async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/derived-metrics')
    metrics.value = response.data.data.metrics || []
    fields.value = response.data.data.fields || []
    for (const field of fields.value) if (!(field.db_name in testValues)) testValues[field.db_name] = 0
  } catch (error) { ElMessage.error(error.response?.data?.message || '公式配置加载失败') }
  finally { loading.value = false }
}

function openCreate() { assignForm(); dialogVisible.value = true }
function openEdit(row) { assignForm(row); dialogVisible.value = true }
function insertField(name) { form.formula = `${form.formula}${form.formula && !/[\s(]$/.test(form.formula) ? ' ' : ''}${name}` }

async function preview() {
  previewing.value = true
  try {
    const response = await api.post('/api/derived-metrics/preview', { metric: form, values: testValues })
    previewResult.value = response.data.data
    ElMessage.success('公式有效')
  } catch (error) { previewResult.value = null; ElMessage.error(error.response?.data?.message || '公式验证失败') }
  finally { previewing.value = false }
}

async function save() {
  saving.value = true
  try {
    await api.post('/api/derived-metrics', form)
    ElMessage.success('公式指标已保存，后续查询立即生效')
    dialogVisible.value = false
    await load()
  } catch (error) { ElMessage.error(error.response?.data?.message || '保存失败') }
  finally { saving.value = false }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定删除公式指标“${row.metric_name}”吗？原始采集数据不会被删除。`, '删除确认', { type: 'warning' })
    await api.delete(`/api/derived-metrics/${row.id}`)
    ElMessage.success('已删除')
    await load()
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error.response?.data?.message || '删除失败') }
}

load()
</script>

<style scoped>
.examples { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 12px 0; color: #64748b; }
.formula-guide { margin-top: 12px; }
.formula-guide :deep(.el-descriptions__label) { width: 135px; }
.examples code { padding: 3px 7px; color: #c7254e; background: #f7f7f9; border-radius: 4px; }
.toolbar { display: flex; gap: 10px; margin: 14px 0; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
.field-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.field-warning { color: #e6a23c; line-height: 32px; }
.test-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.test-grid label { display: grid; gap: 5px; color: #64748b; font-size: 12px; }
.preview-row, .switch-row { display: flex; align-items: center; gap: 16px; margin: 14px 0; }
.chart-grid { margin-top: 14px; }
@media (max-width: 800px) { .form-grid, .test-grid { grid-template-columns: 1fr; } }
</style>
