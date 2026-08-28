<!--
 * 【文件职责】“需要计算的数据”显示开关配置页。
 * 提供总开关和各指标独立显示开关，保存到配置中心 COMPUTED_METRICS。
 * 【配置中心关联】读取/写入 systemConfig.COMPUTED_METRICS，保存后立即生效。
 * -->
<template>
  <div class="computed-config" v-loading="loading">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="控制首页“需要计算的数据”板块中各项工程指标的显示。计算所需参数（额定功率、管径、初始水量等）也在这里配置。"
    />

    <section class="cfg-section">
      <div class="section-heading">
        <div>
          <h3>显示开关</h3>
          <p>总开关关闭时，首页不显示“需要计算的数据”板块。</p>
        </div>
        <el-switch v-model="form.enabled" active-text="启用计算数据板块" />
      </div>

      <el-table :data="items" border stripe>
        <el-table-column label="计算指标" min-width="240">
          <template #default="scope"><strong>{{ scope.row.title }}</strong></template>
        </el-table-column>
        <el-table-column label="说明" min-width="300">
          <template #default="scope"><div class="desc">{{ scope.row.description }}</div></template>
        </el-table-column>
        <el-table-column label="显示" width="100" align="center">
          <template #default="scope">
            <el-switch v-model="form[scope.row.key]" :disabled="!form.enabled" />
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="cfg-section">
      <div class="section-heading">
        <div>
          <h3>计算参数</h3>
          <p>用于换热效率、平均流速、液位等指标的计算。</p>
        </div>
      </div>
      <el-form label-width="200px" class="cfg-form">
        <el-form-item label="电加热额定功率（W）">
          <el-input-number v-model="form.heaterRatedPower" :min="0" :step="100" />
        </el-form-item>
        <el-form-item label="水管横截面积（cm²）">
          <el-input-number v-model="form.pipeAreaCm2" :min="0" :step="0.1" />
        </el-form-item>
        <el-form-item label="水箱1初始水量（L）">
          <el-input-number v-model="form.initialWaterTank1" :min="0" :step="0.5" />
        </el-form-item>
        <el-form-item label="水箱2初始水量（L）">
          <el-input-number v-model="form.initialWaterTank2" :min="0" :step="0.5" />
        </el-form-item>
        <el-form-item label="水箱横截面积（cm²）">
          <el-input-number v-model="form.tankAreaCm2" :min="0" :step="10" />
        </el-form-item>
      </el-form>
    </section>

    <div class="save-bar">
      <el-button :loading="loading" @click="load">刷新</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存并应用</el-button>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const loading = ref(false)
const saving = ref(false)

const defaultForm = () => ({
  enabled: true,
  resistanceK: true,
  pressureDropRate: true,
  tempChangeRate: true,
  heatExchangeEfficiency: true,
  eerHeatBalance: true,
  flowPressureCurve: true,
  cumulativeFlow: true,
  averageVelocity: true,
  waterLevel: true,
  averageTempChart: true,
  averageVelocityChart: true,
  heaterRatedPower: 2000,
  pipeAreaCm2: 3.14,
  initialWaterTank1: 5,
  initialWaterTank2: 5,
  tankAreaCm2: 100,
})

const form = reactive(defaultForm())

const items = [
  { key: 'resistanceK', title: '系统阻力系数 K', description: 'K=ΔP/Q²，管路结垢/堵塞黄金指标，持续上升需提示清洗。' },
  { key: 'pressureDropRate', title: '压力陡降速率 V', description: 'V=dP/dt，0.5 秒内骤降判定吸入空气，紧急停泵。' },
  { key: 'tempChangeRate', title: '温度变化率 dT/dt', description: '加热后无上升判定断线/开路，斜率超限判定短路。' },
  { key: 'heatExchangeEfficiency', title: '换热效率', description: 'η=ρ·Cp·Q·ΔT/P_heater，衡量电能利用率。' },
  { key: 'eerHeatBalance', title: '能效比与热平衡', description: 'COP 与换热量/热损失对比。' },
  { key: 'flowPressureCurve', title: '流量-压力特性曲线', description: '线性回归斜率，反映管路特性。' },
  { key: 'cumulativeFlow', title: '累计流量', description: '上一时刻总流量 + 瞬时流量 × 时间。' },
  { key: 'averageVelocity', title: '平均流速', description: 'v = Q / A（瞬时流量除以水管截面积）。' },
  { key: 'waterLevel', title: '液位', description: '基于两水箱初始水量与累计流量推算液位高度。' },
  { key: 'averageTempChart', title: '平均温度趋势图', description: '历史图表页面专用折线图，展示 (T1+T2)/2 随时间变化。' },
  { key: 'averageVelocityChart', title: '平均流速趋势图', description: '历史图表页面专用折线图，展示平均流速随时间变化。' },
]

async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/system-config')
    const cfg = response.data.data.COMPUTED_METRICS || defaultForm()
    Object.assign(form, defaultForm(), cfg)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '计算数据配置加载失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await api.post('/api/system-config', { COMPUTED_METRICS: { ...form } })
    ElMessage.success('计算数据配置已保存并立即生效')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

load()
</script>

<style scoped>
.cfg-section { margin-top: 16px; padding: 18px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.section-heading h3 { margin: 0 0 5px; color: #0f172a; }
.section-heading p { margin: 0; color: #64748b; }
.desc { color: #64748b; font-size: 12px; }
.cfg-form { margin-top: 6px; max-width: 520px; }
.save-bar { display: flex; gap: 10px; margin-top: 16px; }
</style>