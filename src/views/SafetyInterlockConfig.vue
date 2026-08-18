<!--
 * 【文件职责】安全联锁（安全锁联）可视化配置页。
 * 提供总开关和各条件独立开关，保存到配置中心 SAFETY_INTERLOCK。
 * 【配置中心关联】读取/写入 systemConfig.SAFETY_INTERLOCK，保存后立即生效。
 * -->
<template>
  <div class="safety-config" v-loading="loading">
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="安全联锁在自动和手动模式下全程生效：触发任一启用条件都会强制关闭水泵和加热。自动模式按目标自动调温，手动模式人工开关，但即使手动强制开加热，检测到无水流仍会强制关闭加热。"
    />

    <section class="safety-section">
      <div class="section-heading">
        <div>
          <h3>安全联锁开关</h3>
          <p>总开关关闭时，下面所有条件都不生效。阈值来自“指令中心”里配置的上下限阈值。</p>
        </div>
        <el-switch v-model="form.enabled" active-text="启用安全联锁" />
      </div>

      <el-table :data="conditions" border stripe>
        <el-table-column label="条件" min-width="280">
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

    <section class="safety-section">
      <div class="section-heading">
        <div>
          <h3>温差阈值</h3>
          <p>两路温度差的绝对值超过该值时，触发“温差过大”安全联锁。</p>
        </div>
      </div>
      <el-form label-width="140px" class="safety-form">
        <el-form-item label="温差阈值（℃）">
          <el-input-number v-model="form.tempDiffThreshold" :min="0" :step="0.5" :disabled="!form.enabled" />
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
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const loading = ref(false)
const saving = ref(false)

const defaultForm = () => ({
  enabled: false,
  flowLow: true,
  pressureHigh: true,
  tempHigh: true,
  tempDiff: true,
  tempDiffThreshold: 3,
  manualMode: true,
  sensorOffline: true,
  alarmCooldownMs: 30000,
})

const form = reactive(defaultForm())

const conditions = [
  { key: 'flowLow', title: '流量低于下限阈值或流量为 0', description: '瞬时流量为 0、低于指令中心的流量下限阈值，或达到异常最大值。' },
  { key: 'pressureHigh', title: '压力高于上限阈值或压力为 0', description: '压力为 0、高于指令中心的压力上限阈值，或达到异常最大值。' },
  { key: 'tempHigh', title: '任一温度高于上限阈值', description: '进水/出水任一温度高于指令中心的温度上限阈值，或达到异常最大值。' },
  { key: 'tempDiff', title: '温差过大', description: '两路温度差的绝对值超过温差阈值。' },
  { key: 'manualMode', title: '进入手动模式（人工修复）', description: '控制模式从自动切换到手动时，安全关闭一次水泵和加热。' },
  { key: 'sensorOffline', title: '任一传感器数值掉线', description: '设备长时间无数据上报（心跳超时）时判定离线。' },
]

async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/system-config')
    const safety = response.data.data.SAFETY_INTERLOCK || defaultForm()
    Object.assign(form, defaultForm(), safety)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '安全联锁配置加载失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await api.post('/api/system-config', { SAFETY_INTERLOCK: { ...form } })
    ElMessage.success('安全联锁配置已保存并立即生效')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

load()
</script>

<style scoped>
.safety-section { margin-top: 16px; padding: 18px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.section-heading h3 { margin: 0 0 5px; color: #0f172a; }
.section-heading p { margin: 0; color: #64748b; }
.cond-desc { margin-top: 4px; color: #64748b; font-size: 12px; }
.safety-form { margin-top: 6px; }
.save-bar { display: flex; gap: 10px; margin-top: 16px; }
</style>