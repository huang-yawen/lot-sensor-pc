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
        <el-table-column label="当前阈值（指令中心）" width="170" align="center">
          <template #default="scope">
            <span v-if="scope.row.preffix">{{ thresholdValues[scope.row.preffix] ?? '未在指令中心配置' }}</span>
            <span v-else class="muted">—</span>
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
          <h3>加热开启前置条件</h3>
          <p>跟上方"安全联锁开关"是两套独立机制：这条在你点击"打开加热"那一刻就直接拦截，不受上面总开关是否启用影响，始终按这里的设置生效。跟表格里的"加热开启但水泵未开"互补——那条是加热已经开了才发现没水泵、事后强制关闭；这条是从源头不让你把加热打开。</p>
        </div>
        <el-switch v-model="form.requirePumpBeforeHeater" active-text="打开加热前必须先打开水泵" />
      </div>
    </section>

    <section class="safety-section">
      <div class="section-heading">
        <div>
          <h3>温差阈值</h3>
          <p>两路温度差的绝对值超过该值时，触发“温差过大”安全联锁。指令中心配置了安全联锁专用的“温差阈值”指令项（preffix=safety_temp_diff_threshold，独立指令项，不与联动“加热滞回带通断”③号短路、故障机“水泵故障”共用）就优先用指令中心的，这里只是没配置时的兜底默认值。</p>
        </div>
      </div>
      <el-form label-width="140px" class="safety-form">
        <el-form-item label="指令中心当前值">
          <span>{{ thresholdValues.safety_temp_diff_threshold ?? '未在指令中心配置，以下方兜底值为准' }}</span>
        </el-form-item>
        <el-form-item label="温差阈值（℃，兜底默认值）">
          <el-input-number v-model="form.tempDiffThreshold" :min="0" :step="0.5" :disabled="!form.enabled" />
        </el-form-item>
        <el-form-item label="流量波动阈值（最近N个读数最大值-最小值）">
          <el-input-number v-model="form.flowVolatilityThreshold" :min="0" :step="1" :disabled="!form.enabled" />
        </el-form-item>
        <el-form-item label="流量波动判定窗口（点数）">
          <el-input-number v-model="form.flowVolatilityWindow" :min="2" :step="1" :disabled="!form.enabled" />
          <div class="hint">流量波动阈值判定基于最近这么多个读数的最大值-最小值，默认 10。</div>
        </el-form-item>
        <el-form-item label="告警冷却时间（毫秒）">
          <el-input-number v-model="form.alarmCooldownMs" :min="0" :step="1000" :disabled="!form.enabled" />
        </el-form-item>
        <el-form-item label="异常读数哨兵值">
          <el-input-number v-model="form.abnormalMax" :min="1" :step="1" :disabled="!form.enabled" />
          <div class="hint">传感器读数达到或超过这个值视为掉线/短路异常，默认 9999；现场传感器满量程不是 9999 时改这里。安全联锁和联动控制共用这一个值。</div>
        </el-form-item>
        <el-form-item label="掉线监测周期（毫秒）">
          <el-input-number v-model="form.monitorIntervalMs" :min="1000" :step="1000" :disabled="!form.enabled" />
          <div class="hint">多久检测一次设备是否掉线，默认 5000。修改后需要重启后端才会生效，不是保存即时生效的一类配置。</div>
        </el-form-item>
      </el-form>
    </section>

    <section class="safety-section">
      <div class="section-heading">
        <div>
          <h3>故障记录页面显示</h3>
          <p>只控制“故障记录”页面下方是否显示“安全联锁记录”表格，不影响安全联锁本身是否生效。</p>
        </div>
        <el-switch v-model="form.showOnErrorPage" active-text="显示安全联锁记录表格" />
      </div>
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
  flowVolatility: true,
  flowVolatilityThreshold: 20,
  flowVolatilityWindow: 10,
  manualMode: true,
  sensorOffline: true,
  heaterWithoutPump: true,
  requirePumpBeforeHeater: true,
  alarmCooldownMs: 30000,
  showOnErrorPage: true,
  abnormalMax: 9999,
  monitorIntervalMs: 5000,
})

const form = reactive(defaultForm())

const conditions = [
  { key: 'flowLow', preffix: 'flow_low', title: '流量低于下限阈值或流量为 0', description: '瞬时流量为 0、低于指令中心的流量下限阈值，或达到异常最大值。' },
  { key: 'pressureHigh', preffix: 'pressure_high', title: '压力高于上限阈值或压力为 0', description: '压力为 0、高于指令中心的压力上限阈值，或达到异常最大值。' },
  { key: 'tempHigh', preffix: 'temp_high', title: '任一温度高于上限阈值', description: '进水/出水任一温度高于指令中心的温度上限阈值，或达到异常最大值。' },
  { key: 'tempDiff', preffix: 'safety_temp_diff_threshold', title: '温差过大', description: '两路温度差的绝对值超过温差阈值。' },
  { key: 'flowVolatility', title: '流量剧烈波动（疑似水锤/湍流）', description: '最近 10 个读数里最大值-最小值超过波动阈值，哪怕单次读数正常也会触发。' },
  { key: 'manualMode', title: '进入手动模式（人工修复）', description: '控制模式从自动切换到手动时，安全关闭一次水泵和加热。' },
  { key: 'sensorOffline', title: '任一传感器数值掉线', description: '设备长时间无数据上报（心跳超时）时判定离线。' },
  { key: 'heaterWithoutPump', title: '加热开启但水泵未开', description: '加热器已开启但水泵未开启时触发，防止无水流干烧。仅当水泵、加热开关状态均明确上报时才判断，避免消息里缺行为字段时误触发。（事后检测；配套的事前拦截见下方"加热开启前置条件"）' },
]

// preffix -> 指令中心当前值（只读展示，不在这个页面编辑）。
const thresholdValues = reactive({})

// t_direct_config 是按 ref_id/children 组织的树，preffix 可能挂在任意层级，
// 递归拉平成一份 preffix -> config_id 映射，才能跟 /directRender 返回的
// config_id -> value 对上号。
function flattenConfigIds(nodes, map) {
  for (const node of nodes || []) {
    if (node.preffix) map.set(node.preffix, node.id)
    for (const group of Object.values(node.children || {})) {
      flattenConfigIds(group, map)
    }
  }
}

async function loadThresholds() {
  try {
    const [treeRes, renderRes] = await Promise.all([
      api.get('/api/directData'),
      api.get('/api/directRender', { params: { d_no: 'null' } }),
    ])
    const idByPreffix = new Map()
    flattenConfigIds(treeRes.data?.data, idByPreffix)
    const valueById = new Map((renderRes.data?.data || []).map((item) => [item.config_id, item.value]))
    for (const [preffix, configId] of idByPreffix) {
      if (valueById.has(configId)) thresholdValues[preffix] = valueById.get(configId)
    }
  } catch (error) {
    console.error('[SafetyInterlockConfig] 加载指令中心阈值失败:', error)
  }
}

async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/system-config')
    const safety = response.data.data.SAFETY_INTERLOCK || defaultForm()
    Object.assign(form, defaultForm(), safety)
    await loadThresholds()
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
.muted { color: #c0c4cc; }
.safety-form { margin-top: 6px; }
.hint { color: #94a3b8; font-size: 12px; margin-top: 4px; }
.save-bar { display: flex; gap: 10px; margin-top: 16px; }
</style>