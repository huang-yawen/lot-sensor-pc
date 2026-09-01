<!--
 * 【文件职责】正常状况联动可视化配置页——合并了原来的"自动控制"（简化版目标温度控制）
 * 和"分层联动"（单一传感器独立控制层 + 多传感器融合联动层）两个页面。CONTROL_MODE
 * 决定同一时刻实际运行哪一套，二者互斥；两套各自的配置表单都保留在页面里，切换单选
 * 只是切换显示哪一块，保存时两套表单数据一起提交，来回切换查看不会丢失另一边的配置。
 * 【配置中心关联】读取/写入 systemConfig.CONTROL_MODE、AUTO_CONTROL、LAYERED_CONTROL、
 * DEFAULT_TARGET_TEMP，保存后立即生效。
 * -->
<template>
  <div class="control-mode-config" v-loading="loading">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="两套联动逻辑都仅在“自动模式”且无安全故障（安全联锁未触发）时运行，同一时刻只有一套在跑。目标温度优先取指令中心的“目标温度”，否则使用下方默认值（与 PID 恒温控制共用同一个默认值）。"
    />

    <section class="control-section">
      <div class="section-heading">
        <div>
          <h3>联动模式</h3>
          <p>选择自动模式下用哪一套逻辑决定水泵、加热的开关。</p>
        </div>
      </div>
      <el-radio-group v-model="controlMode">
        <el-radio value="simple">简化版（按目标温度综合判断）</el-radio>
        <el-radio value="layered">分层联动（严格按单一传感器层+多传感器融合层规则）</el-radio>
      </el-radio-group>
    </section>

    <!-- ==================== 简化版：自动控制 ==================== -->
    <template v-if="controlMode === 'simple'">
      <section class="control-section">
        <div class="section-heading">
          <div>
            <h3>自动控制开关</h3>
            <p>总开关关闭时，水泵和加热的自动控制都不生效。</p>
          </div>
          <el-switch v-model="autoForm.enabled" active-text="启用自动控制" />
        </div>

        <el-table :data="switches" border stripe>
          <el-table-column label="控制对象" width="160">
            <template #default="scope"><strong>{{ scope.row.name }}</strong></template>
          </el-table-column>
          <el-table-column label="启用自动控制" width="160" align="center">
            <template #default="scope">
              <el-switch v-model="autoForm[scope.row.key]" :disabled="!autoForm.enabled" />
            </template>
          </el-table-column>
          <el-table-column label="说明" min-width="340">
            <template #default="scope">
              <div class="desc">{{ scope.row.description }}</div>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <section class="control-section">
        <div class="section-heading">
          <div>
            <h3>目标与阈值参数</h3>
            <p>加热器滞回回差避免在目标温度附近反复抖动；温差阈值用于"温差过大关加热"的判断。</p>
          </div>
        </div>
        <el-form label-width="160px" class="control-form">
          <el-form-item label="默认目标温度（℃）">
            <el-input-number v-model="targetTemp" :min="0" :step="0.5" :disabled="!autoForm.enabled" />
          </el-form-item>
          <el-form-item label="加热器滞回回差（℃）">
            <el-input-number v-model="autoForm.heaterHysteresis" :min="0" :step="0.5" :disabled="!autoForm.enabled" />
            <div class="hint">出水温度低于"目标-回差"才开加热，达到目标就关，中间维持现状不抖动。</div>
          </el-form-item>
          <el-form-item label="温差过大阈值（℃）">
            <el-input-number v-model="autoForm.tempDiffOpenThreshold" :min="0" :step="0.5" :disabled="!autoForm.enabled" />
          </el-form-item>
        </el-form>
      </section>
    </template>

    <!-- ==================== 分层版：分层联动 ==================== -->
    <template v-if="controlMode === 'layered'">
      <section class="control-section">
        <div class="section-heading">
          <div>
            <h3>分层联动开关</h3>
            <p>总开关关闭时，本页下面所有规则都不生效。</p>
          </div>
          <el-switch v-model="layeredForm.enabled" active-text="启用分层联动" />
        </div>
      </section>

      <section class="control-section">
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
              <el-switch v-model="layeredForm[scope.row.key]" :disabled="!layeredForm.enabled" />
            </template>
          </el-table-column>
          <el-table-column label="说明" min-width="360">
            <template #default="scope"><div class="desc">{{ scope.row.description }}</div></template>
          </el-table-column>
        </el-table>
        <el-form label-width="200px" class="control-form">
          <el-form-item label="温度滞回回差（℃）">
            <el-input-number v-model="layeredForm.tempHysteresis" :min="0" :step="0.5" :disabled="!layeredForm.enabled || !layeredForm.tempSingle" />
          </el-form-item>
        </el-form>
      </section>

      <section class="control-section">
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
              <el-switch v-model="layeredForm[scope.row.key]" :disabled="!layeredForm.enabled" />
            </template>
          </el-table-column>
          <el-table-column label="说明" min-width="360">
            <template #default="scope"><div class="desc">{{ scope.row.description }}</div></template>
          </el-table-column>
        </el-table>
        <el-form label-width="200px" class="control-form">
          <el-form-item label="双温度融合层温差阈值（℃）">
            <el-input-number v-model="layeredForm.dualTempDiffThreshold" :min="0" :step="0.5" :disabled="!layeredForm.enabled || !layeredForm.dualTemp" />
            <div class="hint">建议比"安全联锁"标签页里的温差阈值小，否则安全联锁会先触发（触发后整套系统强制关闭，本条不会生效）。</div>
          </el-form-item>
        </el-form>
      </section>
    </template>

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

const autoDefaultForm = () => ({
  enabled: false,
  pump: true,
  heater: true,
  tempDiffOpenThreshold: 3,
  heaterHysteresis: 1,
})

const layeredDefaultForm = () => ({
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

const autoForm = reactive(autoDefaultForm())
const layeredForm = reactive(layeredDefaultForm())
// 默认目标温度是跟 PID 恒温控制共用的顶层配置（DEFAULT_TARGET_TEMP），不属于
// AUTO_CONTROL，单独用一个 ref 管理，不跟着 autoForm 一起整体打包保存。
const targetTemp = ref(22)

const switches = [
  { key: 'pump', name: '水泵', description: '常开逻辑：无保护故障、其他传感器（流量/压力）读数正常就保持运行，不跟温度目标挂钩；触发保护故障时关闭。' },
  { key: 'heater', name: '加热模块', description: '滞回带通断：T2（出水温度）低于"目标-回差"才开，达到目标就关，中间维持现状；水泵关闭或流量=0 / 保护故障 / 温差过大时强制关闭。' },
]

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
    Object.assign(autoForm, autoDefaultForm(), data.AUTO_CONTROL || {})
    Object.assign(layeredForm, layeredDefaultForm(), data.LAYERED_CONTROL || {})
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
      CONTROL_MODE: controlMode.value,
      AUTO_CONTROL: { ...autoForm },
      LAYERED_CONTROL: { ...layeredForm },
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
