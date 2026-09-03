<!--
 * 【文件职责】配置中心与远程联调总页面。
 * 集中编辑场景参数、MQTT、字段映射、控制项、告警、派生指标和智能判定，并提供导入导出。
 * 【配置中心关联】通过 /api/system-config 读写后端配置中心；“本地比赛/远程联调”开关使用
 * runtimeEndpoint 同时切换 HTTP、WebSocket、MQTT 地址，只有后端确认 MQTT 配置保存成功才重载页面。
 * -->
<template>
  <div class="config-center">
    <el-alert type="info" :closable="false" show-icon>
      <template #title>这里是唯一的赛场配置入口：页面名称、设备模式、MQTT、字段映射、控制项、告警、智能判定、SQL 公式和 ECharts 均集中在此。</template>
    </el-alert>

    <el-card shadow="never" class="connection-card">
      <div class="connection-row">
        <div>
          <div class="connection-title">运行连接模式</div>
          <div class="connection-description">
            {{ connectionMode === CONNECTION_MODES.LOCAL
              ? '本地模式：前端连接当前电脑的后端'
              : '远程模式：前端连接公网服务器' }}
          </div>
          <div class="connection-address"><span>API</span><code>{{ connectionEndpoint }}</code></div>
          <div class="connection-address"><span>WebSocket</span><code>{{ webSocketEndpoint }}/ws</code></div>
          <div class="connection-address"><span>MQTT</span><code>{{ mqttEndpoint }}</code></div>
        </div>
        <el-switch
          v-model="connectionMode"
          :active-value="CONNECTION_MODES.REMOTE"
          :inactive-value="CONNECTION_MODES.LOCAL"
          active-text="远程联调"
          inactive-text="本地比赛"
          size="large"
          :loading="switchingMode"
          @change="changeConnectionMode"
        />
      </div>
      <el-alert
        class="connection-tip"
        type="warning"
        :closable="false"
        show-icon
        title="此开关会同时切换 HTTP API、WebSocket 和 MQTT Broker。后端确认 MQTT 配置已持久化后，页面才会重载。"
      />
    </el-card>

    <el-tabs v-model="activeTab" class="center-tabs">
      <el-tab-pane label="赛场配置向导" name="guide">
        <el-steps :active="0" align-center class="steps">
          <el-step title="1. 导出备份" description="先保存当前可用场景包" />
          <el-step title="2. 核对任务书" description="整理字段、主题、控制值和页面要求" />
          <el-step title="3. 修改场景参数" description="改标题、协议、映射、告警和判定" />
          <el-step title="4. 配置公式图表" description="建立 SQL 指标并设置 ECharts" />
          <el-step title="5. 逐项验证" description="先试算，再查历史，最后实机控制" />
        </el-steps>

        <el-row :gutter="16" class="guide-cards">
          <el-col v-for="item in quickGuide" :key="item.title" :xs="24" :md="12">
            <el-card shadow="never" class="guide-card">
              <template #header><strong>{{ item.title }}</strong></template>
              <p>{{ item.description }}</p>
              <ul><li v-for="line in item.items" :key="line">{{ line }}</li></ul>
              <el-button type="primary" plain @click="activeTab = item.tab">进入配置</el-button>
            </el-card>
          </el-col>
        </el-row>

        <el-alert type="warning" :closable="false" show-icon title="安全提醒：第一次接入现场设备时保持自动联锁关闭。先核对 MQTT 控制主题、字段名以及 open/close 或 on/off，再进行水泵、加热和阀门测试。" />
      </el-tab-pane>

      <el-tab-pane label="场景参数与场景包" name="scene">
        <el-alert type="success" :closable="false" show-icon title="下面的 JSON 只放没有独立配置页面的字段（场景名称、MQTT、字段映射、告警规则等）。安全联锁、联动控制、PID恒温、故障状态、定量停机、计算数据、智能判定、累计与滑动统计、公式与图表、指令映射这些模块请到各自标签页改，这里不重复暴露。导出/导入的场景包仍然是完整配置，备份恢复不受影响。" />
        <el-collapse class="guide">
      <el-collapse-item title="第一次使用请先看：配置保存和生效规则" name="start">
        <ul>
          <li>先点击“导出场景包”留一份可恢复备份，再修改下方 JSON。</li>
          <li><code>config</code> 是系统运行配置；<code>metadata</code> 是数据库字段映射和控制项。两部分会一起导入。</li>
          <li>布尔值必须写成 <code>true/false</code>，不能写成字符串；时间间隔和超时统一使用毫秒。</li>
          <li>保存后页面配置立即生效；只有 MQTT 地址、账号、QoS 或主题变化时才会自动重连。</li>
          <li>配置文件持久化在 <code>backend/server/data/system-config.json</code>，重启后不会丢失。</li>
          <li>导入 <code>metadata</code> 会整体替换对应的元数据表，请勿删除仍需使用的行；数据库事务失败时会自动回滚。</li>
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
        <el-input ref="jsonEditor" v-model="text" type="textarea" :autosize="{ minRows: 24, maxRows: 40 }" spellcheck="false" placeholder="场景 JSON" />
      </el-tab-pane>

      <el-tab-pane label="指令映射" name="mapping">
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          title="MQTT 字段是硬件控制 JSON 的属性名。修改前请与硬件协议核对，保存后新指令立即生效。开关类指令填了“开/关指令 JSON”会原样下发，不再走 MQTT 字段拼装。"
        />
        <div class="mapping-toolbar">
          <div>
            <strong>下发主题：</strong><code>{{ currentControlTopic }}</code>
            <span class="mapping-hint">开关值会按 CONTROL_VALUE_MAP 转换</span>
          </div>
          <div>
            <el-button @click="load">重新加载</el-button>
            <el-button type="primary" :loading="mappingSaving" @click="saveDirectMappings">保存指令映射</el-button>
          </div>
        </div>
        <el-table :data="directMappings" border stripe row-key="id" class="mapping-table">
          <el-table-column prop="id" label="ID" width="64" fixed />
          <el-table-column label="页面名称" min-width="150">
            <template #default="scope"><el-input v-model="scope.row.t_name" /></template>
          </el-table-column>
          <el-table-column label="控件类型" width="135">
            <template #default="scope">
              <el-select v-model="scope.row.f_type">
                <el-option v-for="item in controlTypes" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="MQTT 字段" min-width="180">
            <template #default="scope">
              <el-input v-model="scope.row.preffix" placeholder="例如 pump" clearable />
            </template>
          </el-table-column>
          <el-table-column label="选项 / 默认值" min-width="210">
            <template #default="scope"><el-input v-model="scope.row.f_value" placeholder="例如 关:off|开:on" clearable /></template>
          </el-table-column>
          <el-table-column label="开(on)指令 JSON" min-width="240">
            <template #default="scope">
              <el-input
                v-if="String(scope.row.f_type) === '1'"
                v-model="scope.row.wire_on_payload"
                type="textarea"
                :autosize="{ minRows: 1, maxRows: 4 }"
                placeholder='不填则用 { MQTT字段: 开的值 }，例如 {"mb":"010600010001","sn":1,"ack":0,"crc":1,"uart":0}'
                clearable
              />
            </template>
          </el-table-column>
          <el-table-column label="关(off)指令 JSON" min-width="240">
            <template #default="scope">
              <el-input
                v-if="String(scope.row.f_type) === '1'"
                v-model="scope.row.wire_off_payload"
                type="textarea"
                :autosize="{ minRows: 1, maxRows: 4 }"
                placeholder='不填则用 { MQTT字段: 关的值 }，例如 {"mb":"010600010000","sn":1,"ack":0,"crc":1,"uart":0}'
                clearable
              />
            </template>
          </el-table-column>
          <el-table-column label="显示条件" min-width="145">
            <template #default="scope">
              <span v-if="scope.row.ref_id === null || scope.row.ref_id === ''">顶层</span>
              <code v-else>{{ scope.row.ref_id }} = {{ scope.row.ref_value }}</code>
            </template>
          </el-table-column>
          <el-table-column label="下发 JSON 预览" min-width="260">
            <template #default="scope"><code class="payload-preview">{{ mappingPreview(scope.row) }}</code></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="公式与图表" name="formula">
        <el-alert type="info" :closable="false" show-icon title="这是配置功能，不是数据展示页。公式保存后，系统会在实时、历史和 ECharts 查询中自动使用，无需修改 Vue 或 Node.js 代码。" />
        <DerivedMetricConfig class="embedded-config" />
      </el-tab-pane>

      <el-tab-pane label="累计与滑动统计" name="aggregation">
        <AggregationMetricConfig class="embedded-config" />
      </el-tab-pane>

      <el-tab-pane label="安全联锁" name="safety">
        <el-alert type="info" :closable="false" show-icon title="安全锁联：触发任一启用条件时自动关闭水泵和加热。可逐条开关控制逻辑。" />
        <SafetyInterlockConfig class="embedded-config" />
      </el-tab-pane>

      <el-tab-pane label="联动控制" name="controlmode">
        <el-alert type="info" :closable="false" show-icon title="正常状况联动：自动模式下按目标温度或分层规则自动启停水泵和加热，两套逻辑二选一，可在页面里直接切换。" />
        <ControlModeConfig class="embedded-config" />
      </el-tab-pane>

      <el-tab-pane label="故障状态" name="fault">
        <el-alert type="warning" :closable="false" show-icon title="加热模块故障（干烧）/水泵故障/管道堵塞/管道漏水：触发任一启用条件时关闭水泵和加热，自动切回手动模式供人工修复。与“安全联锁”相互独立、都全程生效。" />
        <FaultStatusConfig class="embedded-config" />
      </el-tab-pane>

      <el-tab-pane label="定量停机" name="quantity">
        <el-alert type="info" :closable="false" show-icon title="定量停机：累计流量达到设定值后关闭水泵和加热，完成定量换热。" />
        <QuantityShutdownConfig class="embedded-config" />
      </el-tab-pane>

      <el-tab-pane label="计算数据" name="computed">
        <el-alert type="info" :closable="false" show-icon title="需要计算的数据：控制首页工程指标板块的显示与计算参数。" />
        <ComputedMetricsConfig class="embedded-config" />
      </el-tab-pane>

      <el-tab-pane label="PID恒温" name="pid">
        <el-alert type="info" :closable="false" show-icon title="PID 恒温控制：加热只有开关量，用时间比例控制模拟 PWM 占空比。只接管加热，与“自动控制”“分层联动”里的加热下发互斥。" />
        <PidHeatingConfig class="embedded-config" />
      </el-tab-pane>

      <el-tab-pane label="恒流速控制" name="pumpvelocity">
        <el-alert type="info" :closable="false" show-icon title="水泵恒流速控制：水泵只有开关量，用滞环通断或占空比控制把开关逼近恒定流速。只接管水泵，与“联动控制”里的水泵下发互斥。" />
        <PumpVelocityControlConfig class="embedded-config" />
      </el-tab-pane>

      <el-tab-pane label="智能判定" name="judgment">
        <el-alert type="info" :closable="false" show-icon title="配置怎么把选中的历史数据发给现场判定服务、怎么解析返回结果。请求体格式（json/form-data）、请求方法（GET/POST）、响应格式（json/text）、同步/异步任务模式都能在这里切换，赛场拿到接口文档后改配置即可，不用改代码。" />
        <IntelligentJudgmentConfig class="embedded-config" />
      </el-tab-pane>

      <el-tab-pane label="完整字段说明" name="reference">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="这里只列没有独立配置页面、需要在“场景参数与场景包”里改 JSON 的字段。安全联锁、联动控制、PID恒温、故障状态、定量停机、计算数据、智能判定、累计与滑动统计、公式与图表、指令映射这些模块有各自的标签页，参数说明就写在对应页面上，不在这里重复一遍。"
        />
        <div class="reference-toolbar">
          <el-input v-model="helpKeyword" clearable placeholder="搜索配置名、中文用途、示例或注意事项，例如：operation、主题、超时" />
          <span>共 {{ filteredHelp.length }} 项；点击“定位”可跳到场景 JSON。</span>
        </div>
        <el-table :data="filteredHelp" border stripe row-key="key">
          <el-table-column prop="group" label="分类" width="120" />
          <el-table-column prop="key" label="配置项" min-width="210"><template #default="scope"><code>{{ scope.row.key }}</code></template></el-table-column>
          <el-table-column prop="description" label="用途和填写方法" min-width="300" />
          <el-table-column prop="example" label="示例" min-width="190" />
          <el-table-column prop="notice" label="生效范围 / 注意事项" min-width="280" />
          <el-table-column label="操作" width="80" fixed="right"><template #default="scope"><el-button link type="primary" @click="locateConfig(scope.row.key)">定位</el-button></template></el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'
import { useSystemConfigStore } from '@/stores/SystemConfigStore'
import DerivedMetricConfig from '@/views/config/DerivedMetricConfig.vue'
import AggregationMetricConfig from '@/views/config/AggregationMetricConfig.vue'
import SafetyInterlockConfig from '@/views/config/SafetyInterlockConfig.vue'
import ControlModeConfig from '@/views/config/ControlModeConfig.vue'
import FaultStatusConfig from '@/views/config/FaultStatusConfig.vue'
import QuantityShutdownConfig from '@/views/config/QuantityShutdownConfig.vue'
import ComputedMetricsConfig from '@/views/config/ComputedMetricsConfig.vue'
import PidHeatingConfig from '@/views/config/PidHeatingConfig.vue'
import PumpVelocityControlConfig from '@/views/config/PumpVelocityControlConfig.vue'
import IntelligentJudgmentConfig from '@/views/config/IntelligentJudgmentConfig.vue'
import {
  CONNECTION_MODES,
  getApiBaseUrl,
  getConnectionMode,
  getWebSocketBaseUrl,
  setConnectionMode,
} from '@/utils/runtimeEndpoint'

const text = ref('')
// 编辑框里只放"没有独立配置页面"的字段；完整场景包另存一份，导出/导入/保存时用它兜底，
// 避免整包导入时把没显示出来的模块重置成出厂默认值（importConfig 是以 defaultConfig 为底合并的）。
const fullScene = ref(null)

// 这些配置项各自有独立配置标签页，编辑框里不再重复暴露（改它们请去对应标签页）
const PAGE_OWNED_CONFIG_KEYS = [
  'SAFETY_INTERLOCK',
  'LINKAGE_RULES', 'DEFAULT_TARGET_TEMP',
  'FAULT_STATUS', 'QUANTITY_SHUTDOWN',
  'COMPUTED_METRICS', 'SWITCH_DURATION_DISPLAY',
  'PID_HEATING',
  'PUMP_VELOCITY_CONTROL',
  'INTELLIGENT_JUDGMENT',
  'CUMULATIVE_METRICS', 'TIME_WINDOW_METRICS', 'HISTORY_CHARTS',
]
// t_direct_config 在"指令映射"页编辑，t_derived_metric 在"公式与图表"页编辑
const PAGE_OWNED_METADATA_TABLES = ['t_direct_config', 't_derived_metric']

/** 从完整场景包里剔掉"有独立配置页面"的部分，得到编辑框里显示的精简场景。 */
function toEditableScene(scene) {
  const config = { ...(scene?.config || {}) }
  for (const key of PAGE_OWNED_CONFIG_KEYS) delete config[key]
  const metadata = { ...(scene?.metadata || {}) }
  for (const table of PAGE_OWNED_METADATA_TABLES) delete metadata[table]
  return { config, metadata }
}

/** 把编辑框里的精简场景合并回完整场景包，保证提交给后端的始终是完整配置。 */
function mergeEditableIntoFull(editable) {
  const full = JSON.parse(JSON.stringify(fullScene.value || {}))
  full.config = { ...(full.config || {}), ...(editable?.config || {}) }
  full.metadata = { ...(full.metadata || {}), ...(editable?.metadata || {}) }
  return full
}
const saving = ref(false)
const fileInput = ref(null)
const jsonEditor = ref(null)
const helpKeyword = ref('')
const directMappings = ref([])
const mappingSaving = ref(false)
const route = useRoute()
const router = useRouter()
const validTabs = ['guide', 'scene', 'mapping', 'formula', 'aggregation', 'safety', 'controlmode', 'fault', 'quantity', 'computed', 'pid', 'pumpvelocity', 'judgment', 'reference']
const activeTab = ref(validTabs.includes(route.query.tab) ? route.query.tab : 'guide')
const systemStore = useSystemConfigStore()
const connectionMode = ref(getConnectionMode())
const switchingMode = ref(false)
const connectionEndpoint = computed(() => getApiBaseUrl(connectionMode.value))
const webSocketEndpoint = computed(() => getWebSocketBaseUrl(connectionMode.value))
// MQTT 地址不受本地/远程开关影响，直接展示配置中心里真正生效的 MQTT_URL。
const mqttEndpoint = computed(() => systemStore.config.MQTT_URL || '（未加载）')
const currentControlTopic = computed(() => parseSafe()?.config?.MQTT_TOPICS?.control || 'control')
const controlTypes = [
  { value: '1', label: '开关' },
  { value: '2', label: '数字输入' },
  { value: '3', label: '滑块' },
  { value: '4', label: '时间' },
]

async function changeConnectionMode(nextMode) {
  const previousMode = nextMode === CONNECTION_MODES.LOCAL
    ? CONNECTION_MODES.REMOTE
    : CONNECTION_MODES.LOCAL
  const targetName = nextMode === CONNECTION_MODES.LOCAL ? '本地比赛' : '远程联调'

  try {
    switchingMode.value = true
    await ElMessageBox.confirm(
      `将切换到“${targetName}”：API 使用 ${getApiBaseUrl(nextMode)}。MQTT 地址不受此开关影响，如需修改请到下方“MQTT 与设备字段”里改 MQTT_URL。`,
      '切换运行模式',
      { type: 'warning', confirmButtonText: '确认切换', cancelButtonText: '取消' }
    )
    // 纯本地操作，不依赖网络，不会失败——本地/远程开关只管前端去哪里请求 API 和
    // WebSocket，不再顺带联动 MQTT_URL，避免两处都能设置地址、却只有一处真正生效。
    setConnectionMode(nextMode)
    ElMessage.success(`已切换到${targetName}，正在重新连接`)
    window.setTimeout(() => window.location.reload(), 350)
  } catch (error) {
    connectionMode.value = previousMode
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error.message || '连接模式切换失败')
    }
  } finally {
    switchingMode.value = false
  }
}

const quickGuide = [
  { title: '基础页面与运行参数', tab: 'scene', description: '决定系统叫什么、显示哪些页面、单设备还是多设备，以及刷新、分页和离线时间。', items: ['SYSTEM_TITLE 与 TERMINOLOGY 控制页面文字', '功能开关控制图表和操作历史；智能判定、告警联锁各自的显示/启用开关分别在对应标签页配置', '时间参数统一使用毫秒'] },
  { title: 'MQTT 与设备字段', tab: 'scene', description: '系统固定使用 MQTT，但现场 Broker、主题和上报 JSON 字段仍可能变化。', items: ['核对 Broker、QoS 和五类主题', '配置设备编号、时间字段候选名', '统一 open/close 与 on/off 控制值'] },
  { title: '字段、控制、告警与判定', tab: 'scene', description: '这些内容随任务书变化最大，都包含在同一个场景包的 config 和 metadata 中。', items: ['传感字段和运行状态映射', '按钮、开关、滑块等控制项', '本地告警、联锁和 HTTP 智能判定'] },
  { title: 'SQL 公式与 ECharts', tab: 'formula', description: '用可视化表单建立派生指标，查询时由 MySQL 计算，再自动加入实时、历史和图表。', items: ['支持公式验证和测试值试算', '配置单位、精度和显示页面', '配置折线/柱状、左右轴、颜色和范围'] },
  { title: '累计与滑动统计', tab: 'aggregation', description: '用统一表单配置累计值、滑动平均、波动幅度和相邻变化量；同一页面底部还能控制"历史图表"页面每张图的显示与否和最大数据点数。', items: ['可选择传感数据或运行状态字段', '可仅在历史图表页面、仅在汇总数据页面或两处显示', '累计聚合方式支持 sum/avg/on_duration（开关持续时长累计，如水泵/加热运行时长）'] },
  { title: '安全联锁', tab: 'safety', description: '触发任一安全条件时自动关闭水泵和加热，保护设备和管道。', items: ['流量、压力、温度、温差等条件独立开关', '自动模式执行联锁，手动模式仅记录告警', '传感器掉线、进入手动模式等安全保护'] },
  { title: '联动控制', tab: 'controlmode', description: '自动模式下用一套统一的规则库自动启停水泵和加热，规则清单里的规则各自独立开关，可以任意组合勾选，不再局限于固定套路。加热用哪套控制算法是例外，不在这份清单里。', items: ['水泵常开是最基础的推荐规则；温度/流量/压力单层，以及双温度、温度+流量、压力+流量、温度+压力四条融合规则均可独立勾选', '加热滞回带通断 / PID 恒温是“设备设置/指令配置”页面两个各自独立的开关，两个都开时 PID 优先；现场只想留一种，直接在数据库删掉另一个的指令项，不影响系统运行', '同一执行器本轮如有多条规则结论矛盾，“关”优先于“开”（fail-safe）'] },
  { title: '故障状态', tab: 'fault', description: '干烧/管道堵塞/水泵故障/水泵空转/出水口堵塞共 5 种硬故障，触发后保存故障前快照、强制关闭水泵和加热、复位按钮自动拨到"开"并锁定指令页面其他所有开关和参数。', items: ['5 种硬故障各自独立开关，同时触发时按优先级只显示最高的一个', '人工修复设备后把复位按钮拨回"关"，系统按快照恢复全部开关和参数（含目标温度、Kp/Ki/Kd、各类阈值）、按快照重启执行器', '与“安全联锁”相互独立、都全程生效'] },
  { title: '定量停机', tab: 'quantity', description: '累计流量达到设定值后自动停机，完成定量换热。', items: ['设定定量值（如 500L）', '达到目标关闭水泵和加热', '总流量仅做停机判定'] },
  { title: '需要计算的数据', tab: 'computed', description: '阻力系数、流速、换热效率、液位等工程指标，在首页专用板块展示；同一页面底部还能开关首页"水泵/加热累计运行时长、本次已运行时长"的显示。', items: ['系统阻力系数 K、压力陡降速率、温度变化率', '换热效率、能效比、流量-压力曲线', '累计流量、平均流速、平均温度（图表见历史图表页面）'] },
  { title: 'PID恒温', tab: 'pid', description: '加热模块只有开关量、没有功率输出，用时间比例控制模拟 PWM 占空比实现连续调温。', items: ['Kp/Ki/Kd 三个系数可调', '固定周期内按占空比开关加热，而不是简单全开/全关', '只接管加热，与“联动控制”的加热下发互斥'] },
  { title: '智能判定', tab: 'judgment', description: '把选中的历史数据发给现场判定服务、解析并落库判定结果，接口形态每年可能不同，这里做成配置项现场直接改。', items: ['请求体 json/form-data、请求方法 GET/POST 可切换', '响应 json（点路径取值）/text（正则提取）可切换', '同步直接返回结果 / 异步先提交任务再轮询，可切换'] },
]

const configHelp = [
  { group: '场景页面', key: 'CONFIG_VERSION', description: '场景包结构版本，由系统维护。', example: '2', notice: '只用于兼容升级，不要手动修改。' },
  { group: '场景页面', key: 'SCENE_TAG', description: '本次赛题或场景的短名称，也用于导出文件名。', example: '2026水循环系统', notice: '建议每套赛题使用不同名称，便于恢复。' },
  { group: '场景页面', key: 'SCENE_DESCRIPTION', description: '写明传感器、执行器和核心功能，供交接人员快速理解。', example: '双温度、流量、压力监测', notice: '只作说明，不影响业务逻辑。' },
  { group: '场景页面', key: 'SYSTEM_TITLE', description: '系统主标题和浏览器页签标题。', example: '水循环智能监控系统', notice: '保存后刷新页面即可看到。' },
  { group: '场景页面', key: 'DEVICE_LABEL', description: '设备的通用中文称呼。', example: '水循环控制器', notice: '用于页面文字，不是设备编号字段。' },
  { group: '设备显示', key: 'SINGLE_DEVICE_MODE', description: 'true 为单设备自动选择；false 为多设备并允许按编号选择。', example: 'true', notice: '现场只有一套实物时建议 true。' },
  { group: '设备显示', key: 'HIDE_ID_FIELDS', description: '是否隐藏数据库自增主键 id。', example: 'true', notice: '只影响显示，不影响查询和存储。' },
  { group: '设备显示', key: 'HIDE_NUMBER_FIELDS', description: '是否隐藏设备编号列。', example: 'false', notice: '多设备场景通常保持 false。' },
  { group: '设备显示', key: 'HIDE_DEVICE_SELECTOR', description: '是否强制隐藏设备选择器。', example: 'false', notice: '开启后多设备也无法在页面选择设备。' },
  { group: '设备显示', key: 'SHOW_SECONDS', description: '时间格式是否显示秒。true 时显示为 "2026/07/20 11:51:03"，false 时显示为 "2026/07/20 11:51"。', example: 'true', notice: '保存后立即生效，影响所有页面的时间显示。' },
  { group: '功能开关', key: 'OPERATION_HISTORY_MODE', description: '操作历史来源：both 两种都记；software_only 仅软件；device_only 仅底层；off 关闭。', example: 'both', notice: '你当前需求应使用 both。' },
  { group: '功能开关', key: 'ENABLE_CHARTS', description: '是否显示实时和历史 ECharts 图表。', example: 'true', notice: '重点考 ECharts 时保持开启。' },
  { group: '刷新分页', key: 'DEFAULT_PAGE_SIZE', description: '历史列表默认每页条数，范围 1-100。', example: '10', notice: '只影响默认分页大小。' },
  { group: '刷新分页', key: 'REALTIME_REFRESH_INTERVAL', description: '实时数据刷新间隔，单位毫秒；0 表示关闭自动刷新。', example: '3000', notice: '过小会增加数据库和网络负担。' },
  { group: '刷新分页', key: 'HEARTBEAT_TIMEOUT', description: '多久未收到心跳即判定设备离线，单位毫秒。', example: '10000', notice: '必须不小于 1000，通常取心跳周期的 2-3 倍。' },
  { group: '刷新分页', key: 'HEARTBEAT_MODE', description: '心跳判定模式：receive=收到 receive 主题数据就算在线（自动上报）；topic=只认专门的心跳主题。二选一，互斥。', example: 'receive', notice: '只能是 receive 或 topic。' },
  { group: 'MQTT', key: 'MQTT_URL', description: 'MQTT Broker 完整地址，包含协议、IP 和端口。', example: 'mqtt://192.168.1.10:1883', notice: '改变后后端自动重连；TLS 使用 mqtts://。' },
  { group: 'MQTT', key: 'MQTT_USERNAME / MQTT_PASSWORD', description: 'Broker 登录账号和密码，无认证时填写空字符串。', example: '""', notice: '导出场景包会包含密码，注意保管。' },
  { group: 'MQTT', key: 'MQTT_QOS', description: '消息服务质量：0 最多一次、1 至少一次、2 仅一次。', example: '1', notice: '必须与现场要求匹配，通常使用 1。' },
  { group: 'MQTT', key: 'MQTT_TOPICS', description: 'sensor、behavior、heartbeat、control 四类主题。', example: 'sensor_data / control', notice: '键名不能改，值必须与底层程序完全一致。' },
  { group: '上报协议', key: 'DEVICE_ID_FIELDS', description: '数据包中设备编号的候选属性名，按从左到右匹配。', example: '["VID","deviceId","d_no"]', notice: '大小写不敏感；至少保留一个。' },
  { group: '上报协议', key: 'TIME_FIELDS', description: '采集时间的候选属性名；均不存在时使用服务器时间。', example: '["Time","timestamp"]', notice: '建议底层上报 YYYY-MM-DD HH:mm:ss。' },
  { group: '上报协议', key: 'HEARTBEAT_DEVICE_FIELDS', description: 'JSON 心跳包中的设备编号候选名。', example: '["VID","deviceId"]', notice: '纯文本心跳同样支持。' },
  { group: '上报协议', key: 'SENSOR_FIELD_MAP', description: '业务语义（temp1/temp2/flow/pressure）到 t_sensor_data 物理字段（field1~field10）的映射，自动控制、安全联锁、故障判断、分层联动都靠它认字段。', example: '{"temp1":"field1","temp2":"field2","flow":"field3","pressure":"field4"}', notice: 'key 是代码里固定读取的业务语义，不能改名；value 必须跟 t_sensor_field_mapper 表里实际配置的 db_name 保持一致。' },
  { group: '控制协议', key: 'CONTROL_VALUE_MAP', description: '软件标准状态到设备真实控制值的映射。', example: '{"on":"open","off":"close"}', notice: '水泵无响应时优先检查此项和控制主题。' },
  { group: '页面术语', key: 'TERMINOLOGY', description: '修改传感器、运行状态、设备、告警和智能判定的页面称呼。', example: 'sensor: 水循环数据', notice: '不改变数据库和 MQTT 字段。' },
  { group: '告警联锁', key: 'ALARM_RULES.enabled / autoInterlockEnabled', description: 'enabled 是否由服务端根据 rules 计算告警（不影响设备主动上报告警）；autoInterlockEnabled 告警触发后是否自动执行规则里的联锁动作，默认 false，开启前必须实机安全测试。', example: 'true / false', notice: '危险项：接线和协议未确认前，autoInterlockEnabled 必须保持 false。' },
  { group: '告警联锁', key: 'ALARM_RULES.rules', description: '规则列表。推荐用 source_table+source_field（field1~field10）认字段，物理名由字段映射表动态解析，改了物理名不用同步改规则（仍兼容旧写法：field 里直接写候选别名数组）；operator 支持 > >= < <= == !=；require 是前置条件（例如只有水泵开启时才判断流量过低）；action 是联锁下发的字段和值，值会经 CONTROL_VALUE_MAP 转换；cooldownMs 是该规则的告警冷却时间。', example: 'flow < 0.5 且水泵开启时关闭 heater', notice: 'action 仅在 autoInterlockEnabled=true 时执行。' },
  { group: '数据库映射', key: 'metadata.t_sensor_field_mapper', description: '传感数据中文名、field1-field10、MQTT 属性名（p_name）、单位和显示开关。p_name 可用竖线写多个别名，例如 Tin|inlet_temperature|temp_in，按顺序匹配上报报文。', example: 'field1 = 进水温度 = Tin', notice: '赛题换字段时重点修改；导入 metadata 会整体替换这张表，别删掉仍在用的行。' },
  { group: '数据库映射', key: 'metadata.t_behavior_field_mapper', description: '水泵、加热、阀门等运行状态字段映射，p_name 同样支持竖线多别名。可选的 value_map 把数据库原始值换成展示文案（JSON 对象，例如 {"0":"关","1":"开"}），只改显示不改存储值，不配置就原样显示。', example: 'field1 = 水泵 = pump', notice: '属性名要与设备状态上报一致；导入 metadata 会整体替换这张表。' },
  { group: '数据库映射', key: 'field1 (进水温度)', description: '进水口温度传感器，MQTT属性名建议 Tin 或 inlet_temperature，单位 \u2103。', example: 'Tin', notice: '请确认现场实际属性名。' },
  { group: '数据库映射', key: 'field2 (出水温度)', description: '出水口温度传感器，MQTT属性名建议 Tout 或 outlet_temperature，单位 \u2103。', example: 'Tout', notice: '与进水温度分属不同位置。' },
  { group: '数据库映射', key: 'field3 (循环流量)', description: '流量传感器，MQTT属性名建议 Flow 或 flow_rate，单位 L/min。', example: 'Flow', notice: '可能有累计值需求。' },
  { group: '数据库映射', key: 'field4 (管路压力)', description: '压力传感器，MQTT属性名建议 Pressure 或 pressure，单位 kPa。', example: 'Pressure', notice: '管路过压需告警。' },
  { group: '数据库映射', key: 'behavior field2 (水泵)', description: '水泵状态，MQTT属性名建议 pump，取值约定 1=开/0=关。', example: 'pump', notice: '确认与CONTROL_VALUE_MAP一致；field1是控制模式，不是水泵。' },
  { group: '数据库映射', key: 'behavior field3 (加热模块)', description: '加热模块状态，MQTT属性名建议 heater，取值约定 1=开/0=关。', example: 'heater', notice: '水泵未开时禁止加热。' },
  { group: '告警联锁', key: 'ALARM_RULES 温度过高', description: '出水温度 > 80\u2103 告警，可选联锁关闭加热。', example: 't_sensor_data.field2, >, 80', notice: '联锁前必须 autoInterlockEnabled=false。' },
  { group: '告警联锁', key: 'ALARM_RULES 流量过低', description: '水泵开启时流量 < 0.5 L/min 告警。', example: 'require: t_behavior_data.field2 values: [open]', notice: '水泵未开时不触发。' },
  { group: '告警联锁', key: 'ALARM_RULES 压力过高', description: '管路压力 > 500 kPa 告警，可选联锁关闭水泵。', example: 't_sensor_data.field4, >, 500', notice: '防止管路破裂。' },
]

const filteredHelp = computed(() => {
  const keyword = helpKeyword.value.trim().toLowerCase()
  if (!keyword) return configHelp
  return configHelp.filter(item => Object.values(item).some(value => String(value).toLowerCase().includes(keyword)))
})

watch(activeTab, tab => {
  const query = tab === 'guide' ? {} : { tab }
  router.replace({ path: '/scene-config', query }).catch(() => {})
})

async function load() {
  const response = await api.get('/api/system-config/export')
  const scene = response.data.data
  fullScene.value = scene
  text.value = JSON.stringify(toEditableScene(scene), null, 2)
  directMappings.value = JSON.parse(JSON.stringify(scene.metadata?.t_direct_config || []))
}

function parseSafe() {
  try { return JSON.parse(text.value) } catch { return null }
}

function mappingPreview(row) {
  if (String(row.f_type) === '1') {
    const onRaw = String(row.wire_on_payload || '').trim()
    if (onRaw) return `开: ${onRaw}`
  }
  const key = String(row.preffix || '').trim() || '未配置字段'
  let value = '值'
  if (String(row.f_type) === '1') {
    const options = String(row.f_value || '').split('|').map(item => item.split(':')[1]).filter(Boolean)
    const pageValue = options[1] || options[0] || 'on'
    value = parseSafe()?.config?.CONTROL_VALUE_MAP?.[pageValue] ?? pageValue
  } else if (String(row.f_type) === '4') {
    value = '08:00:00'
  } else if (String(row.f_type) === '2' || String(row.f_type) === '3') {
    value = row.min ?? '0'
  }
  return JSON.stringify({ [key]: String(value) })
}

async function saveDirectMappings() {
  try {
    const prefixes = new Set()
    for (const row of directMappings.value) {
      row.t_name = String(row.t_name || '').trim()
      row.preffix = String(row.preffix || '').trim()
      row.topic = row.topic || 'control'
      if (!row.t_name) throw new Error(`ID ${row.id} 的页面名称不能为空`)
      if (!row.preffix) throw new Error(`指令“${row.t_name}”的 MQTT 字段不能为空`)
      if (prefixes.has(row.preffix)) throw new Error(`MQTT 字段重复：${row.preffix}`)
      prefixes.add(row.preffix)
      for (const field of ['wire_on_payload', 'wire_off_payload']) {
        const raw = String(row[field] || '').trim()
        if (!raw) continue
        try {
          const parsed = JSON.parse(raw)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object')
        } catch {
          throw new Error(`指令“${row.t_name}”的${field === 'wire_on_payload' ? '开(on)' : '关(off)'}指令 JSON 格式不对`)
        }
      }
    }
    await ElMessageBox.confirm('保存后新的 MQTT 字段映射立即用于指令下发，是否继续？', '保存指令映射', { type: 'warning' })
    mappingSaving.value = true
    const scene = mergeEditableIntoFull(parse())
    if (!scene.metadata) scene.metadata = {}
    scene.metadata.t_direct_config = JSON.parse(JSON.stringify(directMappings.value))
    const response = await api.post('/api/system-config/import', scene)
    ElMessage.success(response.data.message || '指令映射已保存')
    await load()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error.response?.data?.message || error.message || '指令映射保存失败')
  } finally {
    mappingSaving.value = false
  }
}

function parse() {
  try { return JSON.parse(text.value) } catch (error) { throw new Error(`JSON 格式错误：${error.message}`) }
}

async function save() {
  try {
    const scene = mergeEditableIntoFull(parse())
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
    const scene = mergeEditableIntoFull(parse())
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
    const scene = JSON.parse(content)
    fullScene.value = scene
    text.value = JSON.stringify(toEditableScene(scene), null, 2)
    ElMessage.success('场景文件已载入（编辑框只显示无独立配置页面的部分，其余照常导入），请检查后点击\u201c校验并应用\u201d')
  } catch (error) { ElMessage.error(`文件不是有效 JSON：${error.message}`) }
  event.target.value = ''
}

async function locateConfig(key) {
  activeTab.value = 'scene'
  await nextTick()
  const rootKey = key.replace(/^metadata\./, '').split(/[ ./]/)[0]
  const textarea = jsonEditor.value?.textarea
  const index = text.value.indexOf(`"${rootKey}"`)
  if (!textarea || index < 0) {
    ElMessage.info('该项属于数据库元数据，请在 JSON 的 metadata 区域中查看，或使用对应的可视化配置页。')
    return
  }
  textarea.focus()
  textarea.setSelectionRange(index, index + rootKey.length + 2)
  const before = text.value.slice(0, index)
  textarea.scrollTop = Math.max(0, before.split('\n').length * 18 - 180)
  ElMessage.success(`已定位到 ${rootKey}`)
}

onMounted(() => load().catch(error => ElMessage.error(error.response?.data?.message || '场景加载失败')))
</script>

<style scoped>
.config-center { min-width: 0; }
.connection-card { margin-top: 14px; }
.connection-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.connection-title { color: #1f2937; font-size: 17px; font-weight: 600; margin-bottom: 6px; }
.connection-description { color: #64748b; margin-bottom: 7px; }
.connection-address { display: flex; align-items: baseline; gap: 8px; margin-top: 5px; }
.connection-address span { color: #64748b; min-width: 76px; }
.connection-row code { color: #2563eb; word-break: break-all; }
.connection-tip { margin-top: 14px; }
.center-tabs { margin-top: 14px; }
.steps { margin: 24px 0 28px; }
.guide-cards { margin-bottom: 16px; }
.guide-card { margin-bottom: 16px; min-height: 238px; }
.guide-card p { color: #475569; line-height: 1.7; }
.guide-card ul { min-height: 78px; padding-left: 20px; color: #64748b; line-height: 1.8; }
.guide { margin-top: 12px; }
.guide ul { margin: 4px 0; padding-left: 24px; line-height: 1.9; }
.guide code { color: #c7254e; background: #f7f7f9; padding: 1px 4px; border-radius: 3px; }
.toolbar { display: flex; gap: 10px; margin: 16px 0; flex-wrap: wrap; }
.hidden { display: none; }
.embedded-config { margin-top: 14px; }
.mapping-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 16px 0; }
.mapping-toolbar code { color: #2563eb; }
.mapping-hint { color: #64748b; margin-left: 16px; }
.mapping-table :deep(.el-input), .mapping-table :deep(.el-select) { width: 100%; }
.payload-preview { color: #047857; white-space: normal; word-break: break-all; }
.reference-toolbar { display: flex; align-items: center; gap: 16px; margin-bottom: 14px; color: #64748b; }
.reference-toolbar .el-input { max-width: 620px; }
.reference-toolbar code, :deep(.el-table code) { color: #c7254e; }
:deep(textarea) { font-family: Consolas, Monaco, monospace; font-size: 13px; }
@media (max-width: 900px) {
  .connection-row, .reference-toolbar, .mapping-toolbar { align-items: stretch; flex-direction: column; }
}
</style>
