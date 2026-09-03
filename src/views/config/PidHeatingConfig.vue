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
      title="加热模块只有开关量、没有功率输出，用“时间比例控制”模拟 PWM：固定一个周期（下方“控制周期”），PID 算出的占空比决定这个周期内加热开多久、关多久，而不是简单全开/全关。只接管加热这一个执行器，水泵仍由“联动控制”决定；加热滞回带通断和 PID 是“指令配置”页面两个各自独立的开关，两个都开时 PID 优先。"
    />

    <section class="pid-section">
      <div class="section-heading">
        <div>
          <h3>PID 恒温控制开关</h3>
          <p>启用后，“联动控制”里的加热滞回带通断规则会自动让位，只由本模块控制加热。</p>
        </div>
        <el-switch v-model="form.enabled" active-text="启用 PID 恒温控制" />
      </div>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="这个开关只是“指令配置”页面还没配好“控制模式”“PID恒温控制”这两个指令项时的兜底默认值。现场一旦配了那两个指令项（本项目已经配好），实际是否运行 PID 就完全以那两个开关为准，切这里不会有效果——要临时开关 PID，请去“指令配置”页面操作。"
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
        <el-form-item label="当前目标温度（℃）">
          <span class="readonly-value">{{ effectiveTargetTemp }}</span>
          <div class="hint">目标温度是加热控制的公共设定值，滞回带通断和 PID 用的是同一个，不在这里改：现场请到“设备设置/指令配置”页面的“目标温度”调整；指令项没配置时才回退到“联动控制”页面的兜底默认值。</div>
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
  kp: 20,
  ki: 0.5,
  kd: 5,
  windowMs: 10000,
  deadband: 0.2,
  derivativeFilter: 0.3,
  dutyRampLimit: 15,
  kff: 0,
})

const form = reactive(defaultForm())
// 目标温度是加热控制的公共设定值（滞回带通断和 PID 共用同一个），不属于 PID_HEATING，
// 本页只读展示不提交：兜底默认值的唯一编辑入口在"联动控制"页，现场调温在"指令配置"页。
const targetTemp = ref(22)          // 配置中心兜底默认值（本页只读展示，不提交）
const commandTargetTemp = ref(null) // 指令中心 target_temperature 的实际值
const effectiveTargetTemp = computed(() =>
  commandTargetTemp.value != null ? `${commandTargetTemp.value}（来自指令中心）` : `${targetTemp.value}（兜底默认值，指令中心未配置）`
)

// 指令项按 ref_id/children 组织成树，preffix 可能在任意层级，递归找出 target_temperature 的 config_id，
// 再跟 /directRender 返回的 config_id -> value 对上号，拿到现场实际生效的目标温度。
function findConfigId(nodes, preffix) {
  for (const node of nodes || []) {
    if (node.preffix === preffix) return node.id
    for (const group of Object.values(node.children || {})) {
      const hit = findConfigId(group, preffix)
      if (hit != null) return hit
    }
  }
  return null
}

async function loadCommandTargetTemp() {
  try {
    const [treeRes, renderRes] = await Promise.all([
      api.get('/api/directData'),
      api.get('/api/directRender', { params: { d_no: 'null' } }),
    ])
    const configId = findConfigId(treeRes.data?.data, 'target_temperature')
    const hit = (renderRes.data?.data || []).find(item => item.config_id === configId)
    const value = Number(hit?.value)
    commandTargetTemp.value = Number.isFinite(value) ? value : null
  } catch (error) {
    console.error('[PidHeatingConfig] 读取指令中心目标温度失败:', error)
    commandTargetTemp.value = null
  }
}


async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/system-config')
    const pid = response.data.data.PID_HEATING || defaultForm()
    Object.assign(form, defaultForm(), pid)
    targetTemp.value = response.data.data.DEFAULT_TARGET_TEMP ?? 22
    await loadCommandTargetTemp()
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
.readonly-value { font-weight: 600; color: #1f2937; }
.pid-section { margin-top: 16px; padding: 18px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.section-heading h3 { margin: 0 0 5px; color: #0f172a; }
.section-heading p { margin: 0; color: #64748b; }
.pid-form { margin-top: 6px; }
.hint { color: #94a3b8; font-size: 12px; margin-top: 4px; }
.save-bar { display: flex; gap: 10px; margin-top: 16px; }
</style>
