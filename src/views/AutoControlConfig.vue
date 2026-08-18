<!--
 * 【文件职责】正常状况联动（自动控制）可视化配置页。
 * 提供总开关、水泵/加热独立开关及相关目标值，保存到配置中心 AUTO_CONTROL。
 * 【配置中心关联】读取/写入 systemConfig.AUTO_CONTROL，保存后立即生效。
 * -->
<template>
  <div class="auto-control-config" v-loading="loading">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="自动控制仅在“自动模式”下运行。目标温度优先取指令中心的“目标温度”，否则使用下方默认值；阈值取指令中心的上下限阈值。"
    />

    <section class="auto-section">
      <div class="section-heading">
        <div>
          <h3>自动控制开关</h3>
          <p>总开关关闭时，水泵和加热的自动控制都不生效。</p>
        </div>
        <el-switch v-model="form.enabled" active-text="启用自动控制" />
      </div>

      <el-table :data="switches" border stripe>
        <el-table-column label="控制对象" width="160">
          <template #default="scope"><strong>{{ scope.row.name }}</strong></template>
        </el-table-column>
        <el-table-column label="启用自动控制" width="160" align="center">
          <template #default="scope">
            <el-switch v-model="form[scope.row.key]" :disabled="!form.enabled" />
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="340">
          <template #default="scope">
            <div class="desc">{{ scope.row.description }}</div>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="auto-section">
      <div class="section-heading">
        <div>
          <h3>目标与阈值参数</h3>
          <p>温差阈值用于“两侧达标后关泵”和“温差过大关加热”的判断。</p>
        </div>
      </div>
      <el-form label-width="160px" class="auto-form">
        <el-form-item label="默认目标温度（℃）">
          <el-input-number v-model="form.targetTemp" :min="0" :step="0.5" :disabled="!form.enabled" />
        </el-form-item>
        <el-form-item label="温差关泵阈值（℃）">
          <el-input-number v-model="form.tempDiffCloseThreshold" :min="0" :step="0.5" :disabled="!form.enabled" />
        </el-form-item>
        <el-form-item label="温差过大阈值（℃）">
          <el-input-number v-model="form.tempDiffOpenThreshold" :min="0" :step="0.5" :disabled="!form.enabled" />
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
  pump: true,
  heater: true,
  targetTemp: 22,
  tempDiffCloseThreshold: 2,
  tempDiffOpenThreshold: 3,
})

const form = reactive(defaultForm())

const switches = [
  { key: 'pump', name: '水泵', description: '开：任一温度低于目标且其他传感器正常；关：两侧达到目标且温差小于阈值 / 保护故障 / 累计流量达目标。' },
  { key: 'heater', name: '加热模块', description: '开：T1 小于目标；关：T1>=目标 / 水泵关闭或流量=0 / 保护故障 / 温差过大。' },
]

async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/system-config')
    const auto = response.data.data.AUTO_CONTROL || defaultForm()
    Object.assign(form, defaultForm(), auto)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '自动控制配置加载失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await api.post('/api/system-config', { AUTO_CONTROL: { ...form } })
    ElMessage.success('自动控制配置已保存并立即生效')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

load()
</script>

<style scoped>
.auto-section { margin-top: 16px; padding: 18px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.section-heading h3 { margin: 0 0 5px; color: #0f172a; }
.section-heading p { margin: 0; color: #64748b; }
.desc { color: #64748b; }
.auto-form { margin-top: 6px; }
.save-bar { display: flex; gap: 10px; margin-top: 16px; }
</style>