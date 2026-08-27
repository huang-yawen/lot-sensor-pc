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
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="这个开关只是“指令配置”页面还没配好“自动控制开关”“PID恒温控制”这两个指令项时的兜底默认值。现场一旦配了那两个指令项（本项目已经配好），实际是否运行 PID 就完全以那两个开关为准，切这里不会有效果——要临时开关 PID，请去“指令配置”页面操作。"
      />
    </section>

    <section class="pid-section">
      <div class="section-heading">
        <div>
          <h3>PID 参数</h3>
          <p>u(k) = Kp·e(k) + Ki·Σe(k) + Kd·[e(k)-e(k-1)]，e(k) = 目标温度 - 当前温度（T2 出水，PID 的实际控制目标；T1 进水仅用于前馈和诊断参考）。</p>
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

    <section class="pid-section">
      <div class="section-heading">
        <div>
          <h3>精准控制增强参数</h3>
          <p>指令中心里没有单独配置对应指令项时，这里的值就是实际生效的兜底默认值；指令中心配置了同名指令项则优先用指令中心的。</p>
        </div>
      </div>
      <el-form label-width="180px" class="pid-form">
        <el-form-item label="死区（℃）">
          <el-input-number v-model="form.deadband" :min="0" :step="0.1" :disabled="!form.enabled" />
          <div class="hint">误差绝对值小于这个值时保持上一次占空比不变，避免在目标温度附近来回抖动切换。</div>
        </el-form-item>
        <el-form-item label="微分滤波系数">
          <el-input-number v-model="form.derivativeFilter" :min="0" :max="1" :step="0.1" :disabled="!form.enabled" />
          <div class="hint">0~1，越小滤波越强，能压制传感器噪声被微分项放大；1 表示不滤波。</div>
        </el-form-item>
        <el-form-item label="占空比斜率限制（%/周期）">
          <el-input-number v-model="form.dutyRampLimit" :min="0" :step="1" :disabled="!form.enabled" />
          <div class="hint">占空比每个周期最大变化幅度，防止阶跃跳变；0 表示不限制。</div>
        </el-form-item>
        <el-form-item label="前馈系数">
          <el-input-number v-model="form.kff" :min="0" :step="0.1" :disabled="!form.enabled" />
          <div class="hint">进水温度变化时提前调整占空比、补偿热惯性；0 表示禁用，建议 0.5~2。</div>
        </el-form-item>
      </el-form>
    </section>

    <div class="save-bar">
      <el-button :loading="loading" @click="load">刷新</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存并应用</el-button>
    </div>

    <section class="pid-section">
      <div class="section-heading">
        <div>
          <h3>PID 自整定（继电反馈整定法）</h3>
          <p>开启后暂时接管加热输出，让加热器在"目标温度 ± 回差"之间强制切换，逼出温度振荡，自动算出建议的 Kp/Ki/Kd。跟上方"PID 恒温控制开关"是否启用无关；测试期间"自动控制""分层联动"会自动让位。</p>
        </div>
      </div>
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="自整定期间加热器会真实反复全开/全关，请确认现场有人监护、且已确认接线正常再启动；安全联锁（温度上限、传感器掉线等）全程仍然生效，不会因为在整定就失效。"
      />
      <el-form label-width="180px" class="pid-form" style="margin-top: 14px;">
        <el-form-item label="继电测试高占空比（%）">
          <el-input-number v-model="autoTuneForm.relayHighDuty" :min="0" :max="100" :step="5" :disabled="autoTuneRunning" />
        </el-form-item>
        <el-form-item label="继电测试低占空比（%）">
          <el-input-number v-model="autoTuneForm.relayLowDuty" :min="0" :max="100" :step="5" :disabled="autoTuneRunning" />
        </el-form-item>
        <el-form-item label="温度回差（℃）">
          <el-input-number v-model="autoTuneForm.hysteresis" :min="0.1" :step="0.1" :disabled="autoTuneRunning" />
          <div class="hint">防止在目标温度附近抖动切换，越小切换越频繁。</div>
        </el-form-item>
        <el-form-item label="采集周期数">
          <el-input-number v-model="autoTuneForm.minCycles" :min="2" :step="1" :disabled="autoTuneRunning" />
          <div class="hint">采集到这么多个完整振荡周期后自动计算结果（会额外丢弃第 1 个不稳定周期）。</div>
        </el-form-item>
        <el-form-item label="超时时间（分钟）">
          <el-input-number v-model="autoTuneTimeoutMin" :min="1" :step="1" :disabled="autoTuneRunning" />
          <div class="hint">超时未采集够周期数会自动判定失败并停止。</div>
        </el-form-item>
      </el-form>

      <div class="save-bar">
        <el-button v-if="!autoTuneRunning" type="primary" :loading="autoTuneStarting" @click="startAutoTune">开始自整定</el-button>
        <el-button v-else type="danger" :loading="autoTuneStopping" @click="stopAutoTune">停止自整定</el-button>
      </div>

      <div class="autotune-status" v-if="autoTune.status !== 'idle'">
        <p><strong>状态：</strong>{{ autoTuneStatusLabel }}</p>
        <p v-if="autoTune.status === 'running'"><strong>进度：</strong>{{ autoTune.progress }}/{{ autoTuneForm.minCycles }} 个周期</p>
        <p v-if="autoTune.message"><strong>说明：</strong>{{ autoTune.message }}</p>

        <template v-if="autoTune.status === 'done' && autoTune.result">
          <el-table :data="[autoTune.result]" border style="margin-top: 10px;">
            <el-table-column label="Ku（临界增益）" prop="ku" />
            <el-table-column label="Pu（振荡周期/秒）" prop="pu" />
            <el-table-column label="建议 Kp" prop="kp" />
            <el-table-column label="建议 Ki" prop="ki" />
            <el-table-column label="建议 Kd" prop="kd" />
          </el-table>
          <div class="save-bar">
            <el-button type="primary" :loading="applying" @click="applyResult">应用到指令中心</el-button>
          </div>
          <div class="hint">直接写入指令中心的 Kp/Ki/Kd（跟上面"PID 参数"是同一套系数，指令中心配置优先于这里的兜底值），立即生效。</div>
        </template>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const loading = ref(false)
const saving = ref(false)
const autoTuneStarting = ref(false)
const autoTuneStopping = ref(false)
const applying = ref(false)

const defaultForm = () => ({
  enabled: false,
  kp: 20,
  ki: 0.5,
  kd: 5,
  windowMs: 10000,
  targetTemp: 22,
  deadband: 0.2,
  derivativeFilter: 0.3,
  dutyRampLimit: 15,
  kff: 0,
})

const form = reactive(defaultForm())

const autoTuneForm = reactive({
  relayHighDuty: 100,
  relayLowDuty: 0,
  hysteresis: 0.3,
  minCycles: 4,
})
const autoTuneTimeoutMin = ref(30)
const autoTune = reactive({ status: 'idle', progress: 0, message: '', result: null })
const autoTuneRunning = computed(() => autoTune.status === 'running')

const STATUS_LABELS = { idle: '未开始', running: '进行中', done: '已完成', failed: '失败' }
const autoTuneStatusLabel = computed(() => STATUS_LABELS[autoTune.status] || autoTune.status)

let pollTimer = null
function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(async () => {
    try {
      const response = await api.get('/api/system-config')
      applyAutoTuneState(response.data.data.PID_AUTOTUNE)
    } catch {
      // 轮询失败静默重试，不打断用户
    }
  }, 3000)
}
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function applyAutoTuneState(cfg) {
  if (!cfg) return
  Object.assign(autoTune, {
    status: cfg.status ?? 'idle',
    progress: cfg.progress ?? 0,
    message: cfg.message ?? '',
    result: cfg.result ?? null,
  })
  // 运行中不用远端参数覆盖表单，避免用户正在改下一轮参数时被轮询打断。
  if (!autoTuneRunning.value) {
    if (Number.isFinite(cfg.relayHighDuty)) autoTuneForm.relayHighDuty = cfg.relayHighDuty
    if (Number.isFinite(cfg.relayLowDuty)) autoTuneForm.relayLowDuty = cfg.relayLowDuty
    if (Number.isFinite(cfg.hysteresis)) autoTuneForm.hysteresis = cfg.hysteresis
    if (Number.isFinite(cfg.minCycles)) autoTuneForm.minCycles = cfg.minCycles
    if (Number.isFinite(cfg.timeoutMs)) autoTuneTimeoutMin.value = Math.round(cfg.timeoutMs / 60000)
  }
  if (autoTuneRunning.value) startPolling()
  else stopPolling()
}

async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/system-config')
    const pid = response.data.data.PID_HEATING || defaultForm()
    Object.assign(form, defaultForm(), pid)
    applyAutoTuneState(response.data.data.PID_AUTOTUNE)
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

async function startAutoTune() {
  autoTuneStarting.value = true
  try {
    await api.post('/api/system-config', {
      PID_AUTOTUNE: {
        enabled: true,
        relayHighDuty: autoTuneForm.relayHighDuty,
        relayLowDuty: autoTuneForm.relayLowDuty,
        hysteresis: autoTuneForm.hysteresis,
        minCycles: autoTuneForm.minCycles,
        timeoutMs: autoTuneTimeoutMin.value * 60000,
        status: 'running',
        progress: 0,
        message: '自整定已开始，等待设备上报数据',
        result: null,
      },
    })
    ElMessage.success('自整定已开始')
    await load()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '启动自整定失败')
  } finally {
    autoTuneStarting.value = false
  }
}

async function stopAutoTune() {
  autoTuneStopping.value = true
  try {
    await api.post('/api/system-config', { PID_AUTOTUNE: { enabled: false, status: 'idle', message: '已手动停止' } })
    ElMessage.success('自整定已停止')
    await load()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '停止自整定失败')
  } finally {
    autoTuneStopping.value = false
  }
}

async function applyResult() {
  applying.value = true
  try {
    await api.post('/api/pid-autotune/apply', {})
    ElMessage.success('已写入指令中心（Kp/Ki/Kd），立即生效')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '应用失败')
  } finally {
    applying.value = false
  }
}

onBeforeUnmount(() => stopPolling())

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
.autotune-status { margin-top: 16px; padding-top: 14px; border-top: 1px dashed #e5e7eb; color: #334155; }
.autotune-status p { margin: 4px 0; }
</style>
