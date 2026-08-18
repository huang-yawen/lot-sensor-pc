<!--
 * 【文件职责】分层联动（单一传感器独立控制层 + 多传感器融合联动层）可视化配置页。
 * 提供总开关、每条规则独立开关及相关阈值参数，保存到配置中心 LAYERED_CONTROL；
 * CONTROL_MODE 决定自动模式下用这套分层规则还是“自动控制”标签页里的简化版目标温控制，二者互斥。
 * 【配置中心关联】读取/写入 systemConfig.CONTROL_MODE、LAYERED_CONTROL，保存后立即生效。
 * -->
<template>
  <div class="layered-control-config" v-loading="loading">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="仅在“自动模式”且无安全故障（安全联锁未触发）时运行。优先级：安全联锁 > 三、多传感器融合联动层 > 二、单一传感器独立控制层；同一执行器本轮如有规则结论矛盾，“关闭”优先于“打开”。"
    />

    <section class="layered-section">
      <div class="section-heading">
        <div>
          <h3>联动模式</h3>
          <p>与“自动控制”标签页互斥，同一时刻只有一套在跑。</p>
        </div>
      </div>
      <el-radio-group v-model="controlMode">
        <el-radio value="simple">简化版（自动控制标签页，按目标温度综合判断）</el-radio>
        <el-radio value="layered">分层联动（本页，严格按单一传感器层+多传感器融合层规则）</el-radio>
      </el-radio-group>
    </section>

    <section class="layered-section">
      <div class="section-heading">
        <div>
          <h3>分层联动开关</h3>
          <p>总开关关闭时，本页下面所有规则都不生效。</p>
        </div>
        <el-switch v-model="form.enabled" active-text="启用分层联动" />
      </div>
    </section>

    <section class="layered-section">
      <div class="section-heading">
        <div>
          <h3>二、单一传感器独立控制层</h3>
          <p>前提是无安全故障。</p>
        </div>
      </div>
      <el-table :data="singleRules" border stripe>
        <el-table-column label="规则" width="120">
          <template #default="scope"><strong>{{ scope.row.name }}</strong></template>
        </el-table-column>
        <el-table-column label="启用" width="100" align="center">
          <template #default="scope">
            <el-switch v-model="form[scope.row.key]" :disabled="!form.enabled" />
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="360">
          <template #default="scope"><div class="desc">{{ scope.row.description }}</div></template>
        </el-table-column>
      </el-table>
      <el-form label-width="200px" class="layered-form">
        <el-form-item label="温度滞回回差（℃）">
          <el-input-number v-model="form.tempHysteresis" :min="0" :step="0.5" :disabled="!form.enabled || !form.tempSingle" />
        </el-form-item>
      </el-form>
    </section>

    <section class="layered-section">
      <div class="section-heading">
        <div>
          <h3>三、多传感器融合联动层</h3>
          <p>结论优先于上面的单一传感器层。</p>
        </div>
      </div>
      <el-table :data="fusionRules" border stripe>
        <el-table-column label="规则" width="140">
          <template #default="scope"><strong>{{ scope.row.name }}</strong></template>
        </el-table-column>
        <el-table-column label="启用" width="100" align="center">
          <template #default="scope">
            <el-switch v-model="form[scope.row.key]" :disabled="!form.enabled" />
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="360">
          <template #default="scope"><div class="desc">{{ scope.row.description }}</div></template>
        </el-table-column>
      </el-table>
      <el-form label-width="200px" class="layered-form">
        <el-form-item label="双温度融合层温差阈值（℃）">
          <el-input-number v-model="form.dualTempDiffThreshold" :min="0" :step="0.5" :disabled="!form.enabled || !form.dualTemp" />
          <div class="hint">建议比“安全联锁”标签页里的温差阈值小，否则安全联锁会先触发（触发后整套系统强制关闭，本条不会生效）。</div>
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
const controlMode = ref('simple')

const defaultForm = () => ({
  enabled: false,
  tempSingle: true,
  tempHysteresis: 1,
  flowSingle: true,
  pressureSingle: true,
  dualTemp: true,
  dualTempDiffThreshold: 2,
  tempFlow: true,
  pressureFlow: true,
  tempPressure: true,
})

const form = reactive(defaultForm())

const singleRules = [
  { key: 'tempSingle', name: '温度', description: '任一温度低于目标温度或温度下限->打开加热；高于目标温度或温度上限->关闭加热；按下方回差滞回防抖动。' },
  { key: 'flowSingle', name: '流量', description: '流量在下上限阈值之间->打开水泵；低于下限或高于上限->关闭水泵。' },
  { key: 'pressureSingle', name: '压力', description: '压力低于下限阈值->打开水泵；高于上限阈值->关闭水泵、关闭加热。' },
]

const fusionRules = [
  { key: 'dualTemp', name: '双温度', description: '两路温度差超过下方阈值->打开水泵。' },
  { key: 'tempFlow', name: '温度+流量', description: '任一温度高于上限且流量正常->关闭加热；任一温度低于上限且流量低于下限->打开加热、打开水泵。' },
  { key: 'pressureFlow', name: '压力+流量', description: '压力高于上限且流量低于下限->关闭水泵；压力低于下限且流量正常->打开水泵；压力高于上限且流量高于上限->关闭水泵。' },
  { key: 'tempPressure', name: '温度+压力', description: '压力高于上限且加热温度持续上升->关闭加热；压力低于下限且温度低于下限->先打开水泵，水泵开启后再打开加热。' },
]

async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/system-config')
    const data = response.data.data
    controlMode.value = data.CONTROL_MODE === 'layered' ? 'layered' : 'simple'
    Object.assign(form, defaultForm(), data.LAYERED_CONTROL || {})
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '分层联动配置加载失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await api.post('/api/system-config', { CONTROL_MODE: controlMode.value, LAYERED_CONTROL: { ...form } })
    ElMessage.success('分层联动配置已保存并立即生效')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

load()
</script>

<style scoped>
.layered-section { margin-top: 16px; padding: 18px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.section-heading h3 { margin: 0 0 5px; color: #0f172a; }
.section-heading p { margin: 0; color: #64748b; }
.desc { color: #64748b; }
.layered-form { margin-top: 12px; }
.hint { color: #94a3b8; font-size: 12px; margin-top: 4px; }
.save-bar { display: flex; gap: 10px; margin-top: 16px; }
</style>
