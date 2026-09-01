<!--
 * 【文件职责】正常状况联动可视化配置页——统一规则库，9 条规则逐条独立勾选，
 * 可以任意组合，不再是"简化版/分层联动二选一"。原来两套互斥逻辑（自动控制/
 * 分层联动）已经合并成一份规则清单，赛场上要什么组合直接勾，不用改代码。
 * 【配置中心关联】读取/写入 systemConfig.LINKAGE_RULES、DEFAULT_TARGET_TEMP，
 * 保存后立即生效。
 * -->
<template>
  <div class="control-mode-config" v-loading="loading">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="所有规则仅在“自动模式”且无安全故障（安全联锁未触发）、无硬故障锁定时运行。目标温度优先取指令中心的“目标温度”，否则使用下方默认值（与 PID 恒温控制共用同一个默认值）。同一执行器（水泵/加热）本轮如有多条规则结论矛盾，“关”优先于“开”（fail-safe）。"
    />

    <section class="control-section">
      <div class="section-heading">
        <div>
          <h3>联动总开关</h3>
          <p>总开关关闭时，下面所有规则都不生效。</p>
        </div>
        <el-switch v-model="form.enabled" active-text="启用联动控制" />
      </div>
    </section>

    <section class="control-section">
      <div class="section-heading">
        <div>
          <h3>规则清单</h3>
          <p>逐条勾选启用，可以任意组合。“影响执行器”一列标注这条规则会参与决策哪个执行器。</p>
        </div>
      </div>
      <el-table :data="rules" border stripe>
        <el-table-column label="规则" width="140">
          <template #default="scope"><strong>{{ scope.row.name }}</strong></template>
        </el-table-column>
        <el-table-column label="启用" width="90" align="center">
          <template #default="scope">
            <el-switch v-model="form[scope.row.key]" :disabled="!form.enabled" />
          </template>
        </el-table-column>
        <el-table-column label="影响执行器" width="120">
          <template #default="scope">{{ scope.row.targets }}</template>
        </el-table-column>
        <el-table-column label="说明" min-width="360">
          <template #default="scope"><div class="desc">{{ scope.row.description }}</div></template>
        </el-table-column>
      </el-table>
    </section>

    <section class="control-section">
      <div class="section-heading">
        <div>
          <h3>参数</h3>
          <p>各条规则用到的数值参数，只有对应规则勾选时才会生效。</p>
        </div>
      </div>
      <el-form label-width="200px" class="control-form">
        <el-form-item label="默认目标温度（℃）">
          <el-input-number v-model="targetTemp" :min="0" :step="0.5" :disabled="!form.enabled" />
        </el-form-item>
        <el-form-item label="加热滞回带回差（℃）">
          <el-input-number v-model="form.heaterHysteresisValue" :min="0" :step="0.5" :disabled="!form.enabled || !form.heaterHysteresis" />
          <div class="hint">出水温度低于"目标-回差"才开加热，达到目标就关，中间维持现状不抖动。（heaterHysteresis 规则用）</div>
        </el-form-item>
        <el-form-item label="温差过大阈值（℃）">
          <el-input-number v-model="form.tempDiffOpenThreshold" :min="0" :step="0.5" :disabled="!form.enabled || !form.heaterHysteresis" />
          <div class="hint">进出水温差超过此值判定异常，关闭加热。（heaterHysteresis 规则用）</div>
        </el-form-item>
        <el-form-item label="温度单层滞回回差（℃）">
          <el-input-number v-model="form.tempSingleHysteresis" :min="0" :step="0.5" :disabled="!form.enabled || !form.tempSingle" />
        </el-form-item>
        <el-form-item label="双温度融合温差阈值（℃）">
          <el-input-number v-model="form.dualTempDiffThreshold" :min="0" :step="0.5" :disabled="!form.enabled || !form.dualTemp" />
          <div class="hint">建议比"安全联锁"标签页里的温差阈值小，否则安全联锁会先触发（触发后整套系统强制关闭，本条不会生效）。</div>
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
  pumpAlwaysOn: true,
  heaterHysteresis: true,
  heaterHysteresisValue: 1,
  tempDiffOpenThreshold: 3,
  flowSingle: false,
  pressureSingle: false,
  tempSingle: false,
  tempSingleHysteresis: 1,
  dualTemp: false,
  dualTempDiffThreshold: 2,
  tempFlow: false,
  pressureFlow: false,
  tempPressure: false,
})

const form = reactive(defaultForm())
// 默认目标温度是跟 PID 恒温控制共用的顶层配置（DEFAULT_TARGET_TEMP），不属于
// LINKAGE_RULES，单独用一个 ref 管理，不跟着 form 一起整体打包保存。
const targetTemp = ref(22)

const rules = [
  { key: 'pumpAlwaysOn', name: '水泵常开', targets: '水泵', description: '无故障、其他传感器（流量/压力）读数正常就保持运行，不跟温度目标挂钩；触发保护故障时关闭。工业上推荐常开——水泵关闭会导致出水温度因死水滞留而失真。' },
  { key: 'heaterHysteresis', name: '加热滞回带', targets: '加热', description: '出水温度低于"目标-回差"才开，达到目标就关，中间维持现状；水泵关闭或流量=0 / 保护故障 / 温差过大时强制关闭。推荐搭配水泵常开一起用。' },
  { key: 'flowSingle', name: '流量单层', targets: '水泵', description: '流量在下上限阈值之间或低于下限->打开水泵；高于上限->关闭水泵保护。' },
  { key: 'pressureSingle', name: '压力单层', targets: '水泵/加热', description: '压力低于下限阈值->打开水泵；高于上限阈值->关闭水泵、关闭加热。' },
  { key: 'tempSingle', name: '温度单层', targets: '加热', description: '任一温度低于目标温度或温度下限->打开加热；高于目标温度或温度上限->关闭加热；按上方回差滞回防抖动。' },
  { key: 'dualTemp', name: '双温度融合', targets: '水泵', description: '两路温度差超过下方阈值->打开水泵。' },
  { key: 'tempFlow', name: '温度+流量融合', targets: '水泵/加热', description: '任一温度高于上限且流量正常->关闭加热；任一温度低于上限且流量低于下限->打开加热、打开水泵。' },
  { key: 'pressureFlow', name: '压力+流量融合', targets: '水泵', description: '压力高于上限且流量低于下限->关闭水泵；压力低于下限且流量正常->打开水泵；压力高于上限且流量高于上限->关闭水泵。' },
  { key: 'tempPressure', name: '温度+压力融合', targets: '水泵/加热', description: '压力高于上限且加热温度持续上升->关闭加热；压力低于下限且温度低于下限->先打开水泵，水泵开启后再打开加热。' },
]

async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/system-config')
    const data = response.data.data
    Object.assign(form, defaultForm(), data.LINKAGE_RULES || {})
    targetTemp.value = data.DEFAULT_TARGET_TEMP ?? 22
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '联动配置加载失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await api.post('/api/system-config', {
      LINKAGE_RULES: { ...form },
      DEFAULT_TARGET_TEMP: targetTemp.value,
    })
    ElMessage.success('联动配置已保存并立即生效')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

load()
</script>

<style scoped>
.control-section { margin-top: 16px; padding: 18px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.section-heading h3 { margin: 0 0 5px; color: #0f172a; }
.section-heading p { margin: 0; color: #64748b; }
.desc { color: #64748b; }
.control-form { margin-top: 12px; }
.hint { color: #94a3b8; font-size: 12px; margin-top: 4px; }
.save-bar { display: flex; gap: 10px; margin-top: 16px; }
</style>
