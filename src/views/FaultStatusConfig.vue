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
      title="故障触发后：①保存故障前快照 ②强制关闭水泵和加热（仅硬件断电，页面显示不变） ③系统状态切到 FAULT ④复位按钮自动拨到开 ⑤锁定指令页面其他操作。用户修复设备后手动把复位按钮拨到关，系统按快照恢复参数和开关、重启执行器。"
    />

    <section class="fault-section">
      <div class="section-heading">
        <div>
          <h3>故障状态开关</h3>
          <p>总开关关闭时，下面所有条件都不生效。阈值来自"指令中心"里配置的上下限阈值。</p>
        </div>
        <el-switch v-model="form.enabled" active-text="启用故障状态保护" />
      </div>

      <el-table :data="conditions" border stripe>
        <el-table-column label="故障" min-width="280">
          <template #default="scope">
            <strong>{{ scope.row.code }} {{ scope.row.title }}</strong>
            <div class="cond-desc">{{ scope.row.description }}</div>
          </template>
        </el-table-column>
        <el-table-column label="优先级" width="80" align="center">
          <template #default="scope">
            <el-tag :type="scope.row.priority <= 2 ? 'danger' : 'warning'" size="small">{{ scope.row.priority }}</el-tag>
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
      <el-form label-width="200px" class="fault-form">
        <el-form-item label="干烧判定持续时间（毫秒）">
          <el-input-number v-model="form.dryBurnDurationMs" :min="1000" :step="500" :disabled="!form.enabled || !form.dryBurn" />
          <div class="hint">加热器开启后，出水温度变化未达到"干烧最小温升"且持续超过此时长，判定为干烧（故障③）。</div>
        </el-form-item>
        <el-form-item label="干烧最小温升（℃）">
          <el-input-number v-model="form.dryBurnMinRiseC" :min="0" :step="0.1" :precision="1" :disabled="!form.enabled || !form.dryBurn" />
          <div class="hint">干烧判定时间内出水温度升幅低于此值即判定为干烧。默认 0.1℃。</div>
        </el-form-item>
        <el-form-item label="告警冷却时间（毫秒）">
          <el-input-number v-model="form.alarmCooldownMs" :min="0" :step="1000" :disabled="!form.enabled" />
          <div class="hint">同一故障（设备+故障ID）在冷却期内不重复触发告警，避免告警风暴。</div>
        </el-form-item>
      </el-form>
    </section>

    <section class="fault-section">
      <div class="section-heading">
        <div>
          <h3>当前故障状态</h3>
        </div>
        <el-button :loading="stateLoading" size="small" @click="loadState">刷新</el-button>
      </div>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="系统状态">
          <el-tag :type="stateData.systemState === 'FAULT' ? 'danger' : 'success'">{{ stateData.systemState === 'FAULT' ? '故障' : '正常' }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="复位按钮">
          <el-tag :type="stateData.resetButton === 'on' ? 'warning' : 'info'">{{ stateData.resetButton === 'on' ? '开' : '关' }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="当前故障">
          <span v-if="stateData.activeFaultId">{{ getFaultName(stateData.activeFaultId) }}</span>
          <span v-else>无</span>
        </el-descriptions-item>
        <el-descriptions-item label="触发时间">
          <span v-if="stateData.faultTriggeredAt">{{ new Date(stateData.faultTriggeredAt).toLocaleString() }}</span>
          <span v-else>-</span>
        </el-descriptions-item>
      </el-descriptions>
      <div style="margin-top: 12px;">
        <el-button type="primary" :loading="resetting" :disabled="stateData.resetButton !== 'on'" @click="doReset">复位（拨到"关"恢复运行）</el-button>
      </div>
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
const stateLoading = ref(false)
const resetting = ref(false)

const defaultForm = () => ({
  enabled: false,
  pipeBlockage: true,
  outletBlockage: true,
  dryBurn: true,
  pumpIdle: true,
  pumpFault: true,
  dryBurnDurationMs: 5000,
  dryBurnMinRiseC: 0.1,
  alarmCooldownMs: 30000,
})

const form = reactive(defaultForm())

const conditions = [
  { key: 'dryBurn', code: '③', priority: 1, title: '干烧', description: '加热器开启后，出水温度连续 dryBurnDurationMs 内升幅未达到 dryBurnMinRiseC。' },
  { key: 'pipeBlockage', code: '①', priority: 2, title: '进水口/管道堵塞', description: '压力传感器读数 < 压力下限 或 > 压力上限。' },
  { key: 'pumpFault', code: '⑤', priority: 3, title: '水泵故障', description: '水泵开启时，进出水温差超过指令中心的温差阈值。' },
  { key: 'pumpIdle', code: '④', priority: 4, title: '水泵空转', description: '水泵开启，但流量传感器读数为 0。' },
  { key: 'outletBlockage', code: '②', priority: 5, title: '出水口堵塞', description: '流量传感器读数 < 流量下限阈值。' },
]

const stateData = reactive({
  systemState: 'NORMAL',
  activeFaultId: null,
  resetButton: 'off',
  faultTriggeredAt: null,
})

function getFaultName(id) {
  const c = conditions.find(c => c.key === id)
  return c ? `${c.code} ${c.title}` : id
}

async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/system-config')
    const fault = response.data.data.FAULT_STATUS || {}
    // 只提取 defaultForm 中定义的字段，忽略持久化文件中残留的旧字段
    const defaults = defaultForm()
    const picked = {}
    for (const key of Object.keys(defaults)) {
      picked[key] = fault[key] !== undefined ? fault[key] : defaults[key]
    }
    Object.assign(form, picked)
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

async function loadState() {
  stateLoading.value = true
  try {
    const response = await api.get('/api/faultStatus/state')
    Object.assign(stateData, response.data.data || {})
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '故障状态查询失败')
  } finally {
    stateLoading.value = false
  }
}

async function doReset() {
  resetting.value = true
  try {
    await api.post('/api/faultStatus/reset')
    ElMessage.success('复位成功，系统已恢复正常运行')
    await loadState()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '复位失败')
  } finally {
    resetting.value = false
  }
}

load()
loadState()
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
