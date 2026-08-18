<!--
 * 【文件职责】PID 恒温控制（时间比例控制）可视化配置页。
 * 提供总开关和 PID 参数，保存到配置中心 PID_HEATING。
 * 【配置中心关联】读取/写入 systemConfig.PID_HEATING，保存后立即生效。
 * -->
<template>
  <div class="pid-config" v-loading="loading">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="加热模块只有开关量、没有功率输出，用“时间比例控制”模拟 PWM：固定一个周期（下方“控制周期”），PID 算出的占空比决定这个周期内加热开多久、关多久，而不是简单全开/全关。只接管加热这一个执行器，水泵仍由“自动控制”或“分层联动”决定，二者互斥。"
    />

    <section class="pid-section">
      <div class="section-heading">
        <div>
          <h3>PID 恒温控制开关</h3>
          <p>启用后，“自动控制”“分层联动”里的加热下发都会自动让位，只由本模块控制加热。</p>
        </div>
        <el-switch v-model="form.enabled" active-text="启用 PID 恒温控制" />
      </div>
    </section>

    <section class="pid-section">
      <div class="section-heading">
        <div>
          <h3>PID 参数</h3>
          <p>u(k) = Kp·e(k) + Ki·Σe(k) + Kd·[e(k)-e(k-1)]，e(k) = 目标温度 - 当前温度（T1 进水）。</p>
        </div>
      </div>
      <el-form label-width="180px" class="pid-form">
        <el-form-item label="比例系数 Kp">
          <el-input-number v-model="form.kp" :min="0" :step="1" :disabled="!form.enabled" />
        </el-form-item>
        <el-form-item label="积分系数 Ki">
          <el-input-number v-model="form.ki" :min="0" :step="0.1" :disabled="!form.enabled" />
        </el-form-item>
        <el-form-item label="微分系数 Kd">
          <el-input-number v-model="form.kd" :min="0" :step="1" :disabled="!form.enabled" />
        </el-form-item>
        <el-form-item label="默认目标温度（℃）">
          <el-input-number v-model="form.targetTemp" :min="0" :step="0.5" :disabled="!form.enabled" />
          <div class="hint">优先取指令中心的“目标温度”，未配置时用这个默认值。</div>
        </el-form-item>
        <el-form-item label="控制周期（毫秒）">
          <el-input-number v-model="form.windowMs" :min="1000" :step="1000" :disabled="!form.enabled" />
          <div class="hint">时间比例控制的周期长度，例如 10000（10 秒）表示每 10 秒重新计算一次占空比，占空比 60% 就在这 10 秒内开 6 秒、关 4 秒。</div>
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
  kp: 20,
  ki: 0.5,
  kd: 5,
  windowMs: 10000,
  targetTemp: 22,
})

const form = reactive(defaultForm())

async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/system-config')
    const pid = response.data.data.PID_HEATING || defaultForm()
    Object.assign(form, defaultForm(), pid)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || 'PID 恒温控制配置加载失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await api.post('/api/system-config', { PID_HEATING: { ...form } })
    ElMessage.success('PID 恒温控制配置已保存并立即生效')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

load()
</script>

<style scoped>
.pid-section { margin-top: 16px; padding: 18px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.section-heading h3 { margin: 0 0 5px; color: #0f172a; }
.section-heading p { margin: 0; color: #64748b; }
.pid-form { margin-top: 6px; }
.hint { color: #94a3b8; font-size: 12px; margin-top: 4px; }
.save-bar { display: flex; gap: 10px; margin-top: 16px; }
</style>
