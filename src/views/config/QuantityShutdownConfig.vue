<!--
 * 【文件职责】定量停机（定量换热）可视化配置页。
 * 提供定量停机总开关和定量值，保存到配置中心 QUANTITY_SHUTDOWN。
 * 【配置中心关联】读取/写入 systemConfig.QUANTITY_SHUTDOWN，保存后立即生效。
 * -->
<template>
  <div class="qty-config" v-loading="loading">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="自动模式下持续累计流量，达到定量值时关闭加热和水泵，整套系统自动停机，完成定量换热。总流量仅做停机判定，不参与实时调节。"
    />

    <section class="qty-section">
      <div class="section-heading">
        <div>
          <h3>定量停机开关</h3>
          <p>总开关关闭时，系统不会因累计流量触发自动停机。</p>
        </div>
        <el-switch v-model="form.enabled" active-text="启用定量停机" />
      </div>

      <el-form label-width="180px" class="qty-form">
        <el-form-item label="定量值（L）">
          <el-input-number v-model="form.totalFlowTarget" :min="0" :step="10" :disabled="!form.enabled" />
        </el-form-item>
      </el-form>
    </section>

    <section class="qty-section" v-if="progress">
      <div class="section-heading">
        <div>
          <h3>本轮实时进度</h3>
          <p>数据来自 WebSocket 实时推送（跟随传感器消息）；定量停机关闭、或设备离线还没收到推送时不显示。</p>
        </div>
      </div>
      <div class="qty-progress">
        <el-progress :percentage="progressPercentage" :status="progress.reached ? 'success' : undefined" />
        <div class="qty-progress-text">
          已累计 {{ progress.accumulated }} L / 目标 {{ progress.target }} L
          <span v-if="progress.reached">（已达标，本轮已自动停机）</span>
        </div>
      </div>
    </section>

    <div class="save-bar">
      <el-button :loading="loading" @click="load">刷新</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存并应用</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'
import { connect, on as wsOn } from '@/utils/websocket'

const loading = ref(false)
const saving = ref(false)

// ==================== 本轮实时进度（WebSocket 推送） ====================
// evaluateQuantityShutdown() 的结果挂在 sensor_data 推送的 payload._quantityShutdown
// 上（combinedRealtimeHandler.js / sensorRealtimeHandler.js 都会调用它并挂载），
// 开关关闭或目标值无效时不会有这个字段，progress 保持 null，页面显示"暂无数据"。
const progress = ref(null)
const progressPercentage = computed(() => {
  if (!progress.value || !progress.value.target) return 0
  return Math.min(100, Math.round((progress.value.accumulated / progress.value.target) * 100))
})
let unsubscribeProgress = null

onMounted(() => {
  connect()
  unsubscribeProgress = wsOn('sensor_data', (payload) => {
    if (payload && payload._quantityShutdown) progress.value = payload._quantityShutdown
  })
})

onUnmounted(() => {
  unsubscribeProgress?.()
})

const defaultForm = () => ({
  enabled: false,
  totalFlowTarget: 500,
})

const form = reactive(defaultForm())

async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/system-config')
    const qty = response.data.data.QUANTITY_SHUTDOWN || defaultForm()
    Object.assign(form, defaultForm(), qty)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '定量停机配置加载失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await api.post('/api/system-config', { QUANTITY_SHUTDOWN: { ...form } })
    ElMessage.success('定量停机配置已保存并立即生效')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

load()
</script>

<style scoped>
.qty-section { margin-top: 16px; padding: 18px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.section-heading h3 { margin: 0 0 5px; color: #0f172a; }
.section-heading p { margin: 0; color: #64748b; }
.qty-form { margin-top: 6px; }
.qty-progress { max-width: 520px; }
.qty-progress-text { margin-top: 8px; color: #64748b; font-size: 14px; }
.save-bar { display: flex; gap: 10px; margin-top: 16px; }
</style>