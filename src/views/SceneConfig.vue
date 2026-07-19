<template>
  <div>
    <el-alert type="info" :closable="false" show-icon>
      <template #title>场景包同时包含页面术语、MQTT、协议字段、告警/判定配置和数据库字段映射，保存前会整体校验。</template>
    </el-alert>
    <el-collapse class="guide">
      <el-collapse-item title="第一次使用请先看：配置保存和生效规则" name="start">
        <ul>
          <li>先点击“导出场景包”留一份可恢复备份，再修改下方 JSON。</li>
          <li><code>config</code> 是系统运行配置；<code>metadata</code> 是数据库字段映射和控制项。两部分会一起导入。</li>
          <li>布尔值必须写成 <code>true/false</code>，不能写成字符串；时间间隔和超时统一使用毫秒。</li>
          <li>保存后页面配置立即生效；只有 MQTT 地址、账号、QoS 或主题变化时才会自动重连。</li>
          <li>配置文件持久化在 <code>backend/server/data/system-config.json</code>，重启后不会丢失。</li>
        </ul>
      </el-collapse-item>
      <el-collapse-item title="常用字段说明：页面、设备与 MQTT" name="basic">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="SCENE_TAG / SYSTEM_TITLE">场景包名称，以及左侧导航和浏览器页签标题。</el-descriptions-item>
          <el-descriptions-item label="SINGLE_DEVICE_MODE">true 为单设备并自动选第一台；false 为多设备，可按设备编号控制。</el-descriptions-item>
          <el-descriptions-item label="MQTT_URL">格式如 mqtt://192.168.1.10:1883；需要 TLS 时使用 mqtts://。</el-descriptions-item>
          <el-descriptions-item label="MQTT_QOS">只能填 0、1、2；比赛现场通常使用 1。</el-descriptions-item>
          <el-descriptions-item label="MQTT_TOPICS">sensor=传感量，behavior=运行状态，alarm=主动告警，heartbeat=心跳，control=控制下发。</el-descriptions-item>
          <el-descriptions-item label="DEVICE_ID_FIELDS / TIME_FIELDS">上报 JSON 中设备编号和时间的候选属性名，系统按从左到右的顺序查找。</el-descriptions-item>
          <el-descriptions-item label="CONTROL_VALUE_MAP">页面值到设备值的转换，例如 on→open、off→close；设备使用 on/off 时可映射为自身。</el-descriptions-item>
          <el-descriptions-item label="OPERATION_HISTORY_MODE">both=软件和底层都记录；software_only=只记录软件；device_only=只记录底层；off=关闭记录。</el-descriptions-item>
        </el-descriptions>
      </el-collapse-item>
      <el-collapse-item title="智能判定配置说明" name="judgment">
        <ul>
          <li><code>enabled=true</code> 才会请求现场 HTTP 服务；<code>mockWhenDisabled</code> 只用于无服务时的占位演示。</li>
          <li><code>requestMode=batch</code> 表示多条数据一次提交；<code>single</code> 表示逐条请求。</li>
          <li v-pre>请求模板支持 <code>{{records}}</code>、<code>{{record}}</code>、<code>{{ids}}</code> 和 <code>{{record.field1}}</code>。</li>
          <li><code>resultPath</code> 是响应结果的点路径。例如响应为 <code>{"data":{"results":[]}}</code> 时填写 <code>data.results</code>。</li>
          <li><code>conclusionPath</code> 和 <code>confidencePath</code> 分别指定单条结果中的结论与置信度字段。</li>
        </ul>
      </el-collapse-item>
      <el-collapse-item title="告警与自动联锁说明（重要）" name="alarm">
        <ul>
          <li><code>ALARM_RULES.field</code> 可写多个现场字段别名；<code>operator</code> 支持 &gt;、&gt;=、&lt;、&lt;=、==、!=。</li>
          <li><code>require</code> 是前置条件，例如只有水泵开启时才判断流量过低。</li>
          <li><code>action</code> 是联锁下发字段和值，值仍会经过 <code>CONTROL_VALUE_MAP</code> 转换。</li>
          <li><strong>ENABLE_AUTO_INTERLOCK 默认必须保持 false。</strong>确认接线、电平、主题和开关值后，才能在有人监护的情况下测试开启。</li>
        </ul>
      </el-collapse-item>
      <el-collapse-item title="metadata 数据库元数据说明" name="metadata">
        <ul>
          <li><code>t_sensor_field_mapper</code>：传感量中文名、数据库 field1～field10、上报属性名、单位和显示开关。</li>
          <li><code>t_behavior_field_mapper</code>：水泵、加热、阀门等运行状态的字段映射。</li>
          <li><code>t_direct_config</code>：控制项名称、控件类型、范围、控制 JSON 属性名 <code>preffix</code> 等。</li>
          <li><code>p_name</code> 可用竖线写多个别名，例如 <code>Tin|inlet_temperature|temp_in</code>。</li>
          <li>导入 metadata 会整体替换对应元数据表，请勿删除仍需使用的行；数据库事务失败时会自动回滚。</li>
        </ul>
      </el-collapse-item>
    </el-collapse>
    <div class="toolbar">
      <el-button type="primary" :loading="saving" @click="save">校验并应用</el-button>
      <el-button @click="load">重新加载</el-button>
      <el-button @click="download">导出场景包</el-button>
      <el-button @click="fileInput?.click()">导入文件</el-button>
      <input ref="fileInput" class="hidden" type="file" accept="application/json,.json" @change="readFile" />
    </div>
    <el-input v-model="text" type="textarea" :autosize="{ minRows: 24, maxRows: 36 }" spellcheck="false" placeholder="场景 JSON" />
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'
import { useSystemConfigStore } from '@/stores/SystemConfigStore'

const text = ref('')
const saving = ref(false)
const fileInput = ref(null)
const systemStore = useSystemConfigStore()

async function load() {
  const response = await api.get('/api/system-config/export')
  text.value = JSON.stringify(response.data.data, null, 2)
}

function parse() {
  try { return JSON.parse(text.value) } catch (error) { throw new Error(`JSON 格式错误：${error.message}`) }
}

async function save() {
  try {
    const scene = parse()
    await ElMessageBox.confirm('应用后 MQTT 可能自动重连，是否继续？', '应用场景', { type: 'warning' })
    saving.value = true
    const response = await api.post('/api/system-config/import', scene)
    ElMessage.success(response.data.message)
    await systemStore.load(true)
    await load()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error.response?.data?.message || error.message || '场景应用失败')
  } finally { saving.value = false }
}

function download() {
  try {
    const scene = parse()
    const blob = new Blob([`${JSON.stringify(scene, null, 2)}\n`], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${scene.config?.SCENE_TAG || 'scene'}.json`
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) { ElMessage.error(error.message) }
}

async function readFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const content = await file.text()
    JSON.parse(content)
    text.value = content
    ElMessage.success('场景文件已载入，请检查后点击“校验并应用”')
  } catch (error) { ElMessage.error(`文件不是有效 JSON：${error.message}`) }
  event.target.value = ''
}

onMounted(() => load().catch(error => ElMessage.error(error.response?.data?.message || '场景加载失败')))
</script>

<style scoped>
.guide { margin-top: 12px; }
.guide ul { margin: 4px 0; padding-left: 24px; line-height: 1.9; }
.guide code { color: #c7254e; background: #f7f7f9; padding: 1px 4px; border-radius: 3px; }
.toolbar { display: flex; gap: 10px; margin: 16px 0; flex-wrap: wrap; }
.hidden { display: none; }
:deep(textarea) { font-family: Consolas, Monaco, monospace; font-size: 13px; }
</style>
