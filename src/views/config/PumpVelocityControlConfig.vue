<!--
 * 【文件职责】水泵恒流速控制可视化配置页。
 * 提供兜底总开关、算法选择和两套算法各自的参数，保存到配置中心 PUMP_VELOCITY_CONTROL。
 * 【配置中心关联】读取/写入 systemConfig.PUMP_VELOCITY_CONTROL，保存后立即生效。
 * -->
<template>
  <div class="pv-config" v-loading="loading">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="水泵只有开关量、没有变频调速，用两套互斥算法把“开关”逼近“恒定流速”：滞环通断简单不用整定，占空比控制更平滑但要整定 PID。被控量是管内平均流速 v = Q / A（m/s），由管路流量和“计算数据”页的管道横截面积换算。启用后接管水泵，“联动控制”里控制水泵的规则自动让位；故障状态和安全联锁是更高优先级的保护，触发后照样强制关泵。"
    />
    <el-alert
      class="mt10"
      type="warning"
      :closable="false"
      show-icon
      title="两套算法都只在“平均意义”上恒流速：水泵开着是额定流速、关着是 0，瞬时流速始终是脉冲式的。要让用水点感受到连续流速，需要管路下游有缓冲容积（水箱/储液罐/弹性管路）把脉冲抹平——这是开关量执行器的物理限制，软件绕不开。"
    />

    <section class="pv-section">
      <div class="section-heading">
        <div>
          <h3>恒流速控制开关</h3>
          <p>启用后由本模块独占水泵，“联动控制”里的水泵规则不再下发水泵指令。</p>
        </div>
        <el-switch v-model="form.enabled" active-text="启用恒流速控制" />
      </div>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="这个开关和下面的“控制算法”只是“指令配置”页面还没配好那两个算法开关时的兜底默认值。现场一旦配了指令项，实际用不用、用哪套就完全以指令页面的开关为准——要临时切换，请去“指令配置”页面操作（两个都开时占空比优先）。"
      />
      <el-form label-width="180px" class="pv-form mt14">
        <el-form-item label="控制算法（兜底）">
          <el-radio-group v-model="form.mode" :disabled="!form.enabled">
            <el-radio label="hysteresis">滞环通断</el-radio>
            <el-radio label="pid">占空比控制</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="当前目标流速（m/s）">
          <span class="readonly-value">{{ effectiveTargetVelocity }}</span>
          <div class="hint">目标流速是两套算法共用的唯一设定值，不在这里改：现场请到“设备设置/指令配置”页面的“目标流速”调整；指令项没配置时才回退到下面的兜底默认值。</div>
        </el-form-item>
        <el-form-item label="目标流速兜底值（m/s）">
          <el-input-number v-model="form.defaultTargetVelocity" :min="0" :step="0.1" :disabled="!form.enabled" />
          <div class="hint">指令中心的“目标流速”被删除或没配值时，用这个值兜底。</div>
        </el-form-item>
      </el-form>
    </section>

    <section class="pv-section">
      <div class="section-heading">
        <div>
          <h3>水泵保护（两套算法共用）</h3>
          <p>水泵一旦动作必须保持这么久才允许反向动作，把启停频率钉死在安全范围内。</p>
        </div>
      </div>
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="流速几乎没有惯性（不像温度关掉加热还会缓慢下降），少了这两个限制，水泵会在目标值附近高频启停，也就是工业上说的“短循环”，是烧电机的典型原因。这两个值不建议调到几秒以内。"
      />
      <el-form label-width="180px" class="pv-form mt14">
        <el-form-item label="最小开启时长（毫秒）">
          <el-input-number v-model="form.minOnMs" :min="1" :step="1000" :disabled="!form.enabled" />
        </el-form-item>
        <el-form-item label="最小关闭时长（毫秒）">
          <el-input-number v-model="form.minOffMs" :min="1" :step="1000" :disabled="!form.enabled" />
        </el-form-item>
      </el-form>
    </section>

    <section class="pv-section">
      <div class="section-heading">
        <div>
          <h3>算法① 滞环通断参数</h3>
          <p>流速低于“目标 − 回差”开泵，达到目标关泵，中间这段维持现状不动作。</p>
        </div>
      </div>
      <el-form label-width="180px" class="pv-form">
        <el-form-item label="流速滞回带（m/s）">
          <el-input-number v-model="form.hysteresis" :min="0" :step="0.05" :disabled="!form.enabled" />
          <div class="hint">回差越小越贴近目标流速，但水泵启停越频繁；越大越平稳，但流速波动范围越宽。</div>
        </el-form-item>
      </el-form>
    </section>

    <section class="pv-section">
      <div class="section-heading">
        <div>
          <h3>算法② 占空比控制参数</h3>
          <p>u(k) = Kp·e(k) + Ki·Σe(k) + Kd·[e(k)−e(k−1)]，e(k) = 目标流速 − 当前流速；算出的占空比决定一个周期内水泵开多久、关多久。</p>
        </div>
      </div>
      <el-form label-width="180px" class="pv-form">
        <el-form-item label="控制周期（毫秒）">
          <el-input-number v-model="form.windowMs" :min="10000" :step="5000" :disabled="!form.enabled" />
          <div class="hint">例如 30000（30 秒）表示每 30 秒重算一次占空比，占空比 40% 就在这 30 秒内开 12 秒、关 18 秒。实际生效值不会低于 10 秒——水泵启停的水锤冲击和电机启动电流远大于加热器。</div>
        </el-form-item>
        <el-form-item label="比例系数 Kp">
          <el-input-number v-model="form.kp" :min="0" :step="10" :disabled="!form.enabled" />
          <div class="hint">误差单位是 m/s、输出是 0~100%，所以 Kp 的量级比温度 PID 大：误差 0.5 m/s 想换来 50% 的占空比变化，Kp 就取 100 左右。</div>
        </el-form-item>
        <el-form-item label="积分系数 Ki">
          <el-input-number v-model="form.ki" :min="0" :step="0.5" :disabled="!form.enabled" />
        </el-form-item>
        <el-form-item label="微分系数 Kd">
          <el-input-number v-model="form.kd" :min="0" :step="1" :disabled="!form.enabled" />
        </el-form-item>
        <el-form-item label="流速死区（m/s）">
          <el-input-number v-model="form.deadband" :min="0" :step="0.01" :disabled="!form.enabled" />
          <div class="hint">误差绝对值小于这个值时保持上一次占空比不变，避免传感器噪声推着占空比来回跳。</div>
        </el-form-item>
        <el-form-item label="占空比下限（%）">
          <el-input-number v-model="form.dutyMin" :min="0" :max="100" :step="5" :disabled="!form.enabled" />
        </el-form-item>
        <el-form-item label="占空比上限（%）">
          <el-input-number v-model="form.dutyMax" :min="0" :max="100" :step="5" :disabled="!form.enabled" />
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
import { reactive, ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const loading = ref(false)
const saving = ref(false)

const defaultForm = () => ({
  enabled: false,
  mode: 'hysteresis',
  defaultTargetVelocity: 1,
  hysteresis: 0.1,
  minOnMs: 15000,
  minOffMs: 15000,
  windowMs: 30000,
  kp: 100,
  ki: 5,
  kd: 0,
  deadband: 0.02,
  dutyMin: 0,
  dutyMax: 100,
})

const form = reactive(defaultForm())
// 目标流速是两套算法共用的设定值，现场实时值在指令中心，这里只读展示，
// 页面上可编辑的是它的兜底默认值（form.defaultTargetVelocity）。
const commandTargetVelocity = ref(null)
const effectiveTargetVelocity = computed(() =>
  commandTargetVelocity.value != null
    ? `${commandTargetVelocity.value}（来自指令中心）`
    : `${form.defaultTargetVelocity}（兜底默认值，指令中心未配置）`
)

// 指令项按 ref_id/children 组织成树，preffix 可能在任意层级，递归找出 target_velocity
// 的 config_id，再跟 /directRender 返回的 config_id -> value 对上号，拿到现场实际值。
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

async function loadCommandTargetVelocity() {
  try {
    const [treeRes, renderRes] = await Promise.all([
      api.get('/api/directData'),
      api.get('/api/directRender', { params: { d_no: 'null' } }),
    ])
    const configId = findConfigId(treeRes.data?.data, 'target_velocity')
    const hit = (renderRes.data?.data || []).find(item => item.config_id === configId)
    const value = Number(hit?.value)
    commandTargetVelocity.value = Number.isFinite(value) ? value : null
  } catch (error) {
    console.error('[PumpVelocityControlConfig] 读取指令中心目标流速失败:', error)
    commandTargetVelocity.value = null
  }
}

async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/system-config')
    const cfg = response.data.data.PUMP_VELOCITY_CONTROL || defaultForm()
    Object.assign(form, defaultForm(), cfg)
    await loadCommandTargetVelocity()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '恒流速控制配置加载失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await api.post('/api/system-config', { PUMP_VELOCITY_CONTROL: { ...form } })
    ElMessage.success('恒流速控制配置已保存并立即生效')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.readonly-value { font-weight: 600; color: #1f2937; }
.pv-section { margin-top: 16px; padding: 18px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.section-heading h3 { margin: 0 0 5px; color: #0f172a; }
.section-heading p { margin: 0; color: #64748b; }
.pv-form { margin-top: 6px; }
.hint { color: #94a3b8; font-size: 12px; margin-top: 4px; }
.save-bar { display: flex; gap: 10px; margin-top: 16px; }
.mt10 { margin-top: 10px; }
.mt14 { margin-top: 14px; }
</style>
