<!--
 * 【文件职责】故障状态（硬故障保护）可视化配置页。
 * 提供总开关和各条件独立开关，保存到配置中心 FAULT_STATUS。
 * 【配置中心关联】读取/写入 systemConfig.FAULT_STATUS，保存后立即生效。
 * -->
<template>
  <div class="fault-config" v-loading="loading">
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="与“安全联锁”相互独立、都全程生效，条件可能同时命中（多层防护叠加，不冲突）。触发任一启用条件时：强制关闭水泵和加热，并把控制模式自动切回手动，供人工介入维修。"
    />

    <section class="fault-section">
      <div class="section-heading">
        <div>
          <h3>故障状态开关</h3>
          <p>总开关关闭时，下面所有条件都不生效。阈值来自“指令中心”里配置的上下限阈值。</p>
        </div>
        <el-switch v-model="form.enabled" active-text="启用故障状态保护" />
      </div>

      <el-table :data="conditions" border stripe>
        <el-table-column label="故障" min-width="280">
          <template #default="scope">
            <strong>{{ scope.row.title }}</strong>
            <div class="cond-desc">{{ scope.row.description }}</div>
          </template>
        </el-table-column>
        <el-table-column label="启用" width="110" align="center">
          <template #default="scope">
            <el-switch v-model="form[scope.row.key]" :disabled="!form.enabled" />
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="fault-section">
      <div class="section-heading">
        <div>
          <h3>参数</h3>
        </div>
      </div>
      <el-form label-width="180px" class="fault-form">
        <el-form-item label="水泵故障判定时长（毫秒）">
          <el-input-number v-model="form.pumpFaultDurationMs" :min="0" :step="500" :disabled="!form.enabled || !form.pumpFault" />
          <div class="hint">水泵开启且流量=0、压力=0，需要持续超过这个时长才判定为水泵故障，避免瞬时抖动误判。</div>
        </el-form-item>
        <el-form-item label="告警冷却时间（毫秒）">
          <el-input-number v-model="form.alarmCooldownMs" :min="0" :step="1000" :disabled="!form.enabled" />
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
  enabled: false,
  heaterFault: true,
  pumpFault: true,
  pumpFaultDurationMs: 2000,
  blockage: true,
  leak: true,
  alarmCooldownMs: 30000,
})

const form = reactive(defaultForm())

const conditions = [
  { key: 'heaterFault', title: '加热模块故障（干烧）', description: '水泵和加热均开启时，流量低于指令中心的流量下限阈值。' },
  { key: 'pumpFault', title: '水泵故障', description: '水泵开启时，流量为 0 且压力为 0，且持续超过下方判定时长。' },
  { key: 'blockage', title: '管道堵塞', description: '压力高于指令中心的压力上限阈值，且流量低于流量下限阈值。' },
  { key: 'leak', title: '管道漏水', description: '压力为 0，且（流量低于流量下限阈值 或 流量为 0）。' },
]

async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/system-config')
    const fault = response.data.data.FAULT_STATUS || defaultForm()
    Object.assign(form, defaultForm(), fault)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '故障状态配置加载失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await api.post('/api/system-config', { FAULT_STATUS: { ...form } })
    ElMessage.success('故障状态配置已保存并立即生效')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

load()
</script>

<style scoped>
.fault-section { margin-top: 16px; padding: 18px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.section-heading h3 { margin: 0 0 5px; color: #0f172a; }
.section-heading p { margin: 0; color: #64748b; }
.cond-desc { margin-top: 4px; color: #64748b; font-size: 12px; }
.fault-form { margin-top: 6px; }
.hint { color: #94a3b8; font-size: 12px; margin-top: 4px; }
.save-bar { display: flex; gap: 10px; margin-top: 16px; }
</style>
