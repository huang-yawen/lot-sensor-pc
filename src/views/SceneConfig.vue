<template>
  <div class="config-center">
    <el-alert type="info" :closable="false" show-icon>
      <template #title>这里是唯一的赛场配置入口：页面名称、设备模式、MQTT、字段映射、控制项、告警、智能判定、SQL 公式和 ECharts 均集中在此。</template>
    </el-alert>

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
        <el-alert type="success" :closable="false" show-icon title="此处保存系统全部基础参数及数据库元数据。修改前先导出；不清楚某个字段时，可到“完整字段说明”搜索字段名。" />
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
          <li><code>t_derived_metric</code>：SQL 公式指标及 ECharts 样式；建议优先使用“公式与图表”可视化页面修改。</li>
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
        <el-input ref="jsonEditor" v-model="text" type="textarea" :autosize="{ minRows: 24, maxRows: 40 }" spellcheck="false" placeholder="场景 JSON" />
      </el-tab-pane>

      <el-tab-pane label="公式与图表" name="formula">
        <el-alert type="info" :closable="false" show-icon title="这是配置功能，不是数据展示页。公式保存后，系统会在实时、历史和 ECharts 查询中自动使用，无需修改 Vue 或 Node.js 代码。" />
        <DerivedMetricConfig class="embedded-config" />
      </el-tab-pane>

      <el-tab-pane label="累计与滑动统计" name="aggregation">
        <AggregationMetricConfig class="embedded-config" />
      </el-tab-pane>

      <el-tab-pane label="完整字段说明" name="reference">
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
import DerivedMetricConfig from '@/views/DerivedMetricConfig.vue'
import AggregationMetricConfig from '@/views/AggregationMetricConfig.vue'

const text = ref('')
const saving = ref(false)
const fileInput = ref(null)
const jsonEditor = ref(null)
const helpKeyword = ref('')
const route = useRoute()
const router = useRouter()
const validTabs = ['guide', 'scene', 'formula', 'aggregation', 'reference']
const activeTab = ref(validTabs.includes(route.query.tab) ? route.query.tab : 'guide')
const systemStore = useSystemConfigStore()

const quickGuide = [
  { title: '基础页面与运行参数', tab: 'scene', description: '决定系统叫什么、显示哪些页面、单设备还是多设备，以及刷新、分页和离线时间。', items: ['SYSTEM_TITLE 与 TERMINOLOGY 控制页面文字', '功能开关控制判定、图表和操作历史', '时间参数统一使用毫秒'] },
  { title: 'MQTT 与设备字段', tab: 'scene', description: '系统固定使用 MQTT，但现场 Broker、主题和上报 JSON 字段仍可能变化。', items: ['核对 Broker、QoS 和五类主题', '配置设备编号、时间字段候选名', '统一 open/close 与 on/off 控制值'] },
  { title: '字段、控制、告警与判定', tab: 'scene', description: '这些内容随任务书变化最大，都包含在同一个场景包的 config 和 metadata 中。', items: ['传感字段和运行状态映射', '按钮、开关、滑块等控制项', '本地告警、联锁和 HTTP 智能判定'] },
  { title: 'SQL 公式与 ECharts', tab: 'formula', description: '用可视化表单建立派生指标，查询时由 MySQL 计算，再自动加入实时、历史和图表。', items: ['支持公式验证和测试值试算', '配置单位、精度和显示页面', '配置折线/柱状、左右轴、颜色和范围'] },
  { title: '累计与滑动统计', tab: 'aggregation', description: '用统一表单配置累计值、滑动平均、波动幅度和相邻变化量。', items: ['可选择传感数据或运行状态字段', '可仅在首页、仅在历史页或两处显示', '保存时统一校验字段、精度、窗口和图表参数'] },
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
  { group: '功能开关', key: 'ENABLE_SENSOR_RECOGNIZE', description: '传感器历史页是否显示智能判定按钮。', example: 'true', notice: '仅控制入口显示。' },
  { group: '功能开关', key: 'ENABLE_BEHAVIOR_RECOGNIZE', description: '运行状态历史页是否显示智能判定按钮。', example: 'true', notice: '题目不要求时可关闭。' },
  { group: '功能开关', key: 'ENABLE_JUDGMENT_HISTORY', description: '是否显示智能判定记录菜单。', example: 'true', notice: '若评分要求记录查询必须开启。' },
  { group: '功能开关', key: 'OPERATION_HISTORY_MODE', description: '操作历史来源：both 两种都记；software_only 仅软件；device_only 仅底层；off 关闭。', example: 'both', notice: '你当前需求应使用 both。' },
  { group: '功能开关', key: 'ENABLE_CHARTS', description: '是否显示实时和历史 ECharts 图表。', example: 'true', notice: '重点考 ECharts 时保持开启。' },
  { group: '功能开关', key: 'ENABLE_LOCAL_ALARM', description: '是否由服务端根据规则计算告警。', example: 'true', notice: '不影响设备主动上报告警。' },
  { group: '功能开关', key: 'ENABLE_AUTO_INTERLOCK', description: '告警触发后是否自动执行控制动作。', example: 'false', notice: '危险项；实机协议和接线确认前必须为 false。' },
  { group: '统计指标', key: 'CUMULATIVE_METRICS', description: '从第一条匹配数据开始累计数值字段。', example: 'field3 → 累计流量', notice: '建议在“累计与滑动统计”页可视化修改。' },
  { group: '统计指标', key: 'TIME_WINDOW_METRICS', description: '按最近 N 条计算滑动平均、波动幅度或相邻变化量。', example: 'field2 / 5 条 / avg', notice: '建议在“累计与滑动统计”页可视化修改。' },
  { group: '刷新分页', key: 'DEFAULT_PAGE_SIZE', description: '历史列表默认每页条数，范围 1-100。', example: '10', notice: '只影响默认分页大小。' },
  { group: '刷新分页', key: 'REALTIME_REFRESH_INTERVAL', description: '实时数据刷新间隔，单位毫秒；0 表示关闭自动刷新。', example: '3000', notice: '过小会增加数据库和网络负担。' },
  { group: '刷新分页', key: 'HEARTBEAT_TIMEOUT', description: '多久未收到心跳即判定设备离线，单位毫秒。', example: '10000', notice: '必须不小于 1000，通常取心跳周期的 2-3 倍。' },
  { group: 'MQTT', key: 'MQTT_URL', description: 'MQTT Broker 完整地址，包含协议、IP 和端口。', example: 'mqtt://192.168.1.10:1883', notice: '改变后后端自动重连；TLS 使用 mqtts://。' },
  { group: 'MQTT', key: 'MQTT_USERNAME / MQTT_PASSWORD', description: 'Broker 登录账号和密码，无认证时填写空字符串。', example: '""', notice: '导出场景包会包含密码，注意保管。' },
  { group: 'MQTT', key: 'MQTT_QOS', description: '消息服务质量：0 最多一次、1 至少一次、2 仅一次。', example: '1', notice: '必须与现场要求匹配，通常使用 1。' },
  { group: 'MQTT', key: 'MQTT_TOPICS', description: 'sensor、behavior、alarm、heartbeat、control 五类主题。', example: 'sensor_data / control', notice: '键名不能改，值必须与底层程序完全一致。' },
  { group: '上报协议', key: 'DEVICE_ID_FIELDS', description: '数据包中设备编号的候选属性名，按从左到右匹配。', example: '["VID","deviceId","d_no"]', notice: '大小写不敏感；至少保留一个。' },
  { group: '上报协议', key: 'TIME_FIELDS', description: '采集时间的候选属性名；均不存在时使用服务器时间。', example: '["Time","timestamp"]', notice: '建议底层上报 YYYY-MM-DD HH:mm:ss。' },
  { group: '上报协议', key: 'HEARTBEAT_DEVICE_FIELDS', description: 'JSON 心跳包中的设备编号候选名。', example: '["VID","deviceId"]', notice: '纯文本心跳同样支持。' },
  { group: '控制协议', key: 'CONTROL_VALUE_MAP', description: '软件标准状态到设备真实控制值的映射。', example: '{"on":"open","off":"close"}', notice: '水泵无响应时优先检查此项和控制主题。' },
  { group: '告警', key: 'ALARM_FIELD_MAP', description: '设备主动告警字段到页面中文名称的映射。', example: 'pressure_warn: 压力', notice: '左侧必须是现场 JSON 真实属性名。' },
  { group: '页面术语', key: 'TERMINOLOGY', description: '修改传感器、运行状态、设备、告警和智能判定的页面称呼。', example: 'sensor: 水循环数据', notice: '不改变数据库和 MQTT 字段。' },
  { group: '智能判定', key: 'INTELLIGENT_JUDGMENT.enabled', description: '是否调用现场 HTTP 智能判定服务。', example: 'true', notice: '正式比赛调用接口时开启。' },
  { group: '智能判定', key: 'INTELLIGENT_JUDGMENT.url / method / timeoutMs', description: '服务地址、HTTP 方法和超时时间。', example: 'POST / 10000', notice: '服务在其他电脑时不能使用 127.0.0.1。' },
  { group: '智能判定', key: 'INTELLIGENT_JUDGMENT.headers', description: 'HTTP 请求头，可配置 Content-Type 或 Authorization。', example: '{"Content-Type":"application/json"}', notice: 'Token 等敏感信息会进入场景包。' },
  { group: '智能判定', key: 'INTELLIGENT_JUDGMENT.requestMode / requestTemplate', description: '选择单条或批量请求，并用占位符组织现场要求的请求体。', example: '{"data":"{{records}}"}', notice: '支持 records、record、ids 和 record.field1 等。' },
  { group: '智能判定', key: 'INTELLIGENT_JUDGMENT.resultPath / conclusionPath / confidencePath', description: '用点路径从响应中提取结果数组、结论和置信度。', example: 'data.results / result / confidence', notice: '按现场响应 JSON 层级填写。' },
  { group: '告警联锁', key: 'ALARM_RULES', description: '配置字段、比较符、阈值、前置条件、冷却时间及可选联锁动作。', example: 'flow < 0.5 时关闭 heater', notice: 'action 仅在自动联锁开启时执行。' },
  { group: '数据库映射', key: 'metadata.t_sensor_field_mapper', description: '传感数据中文名、field1-field10、MQTT 属性名、单位和显示开关。', example: 'field1 = 进水温度 = Tin', notice: '赛题换字段时重点修改。' },
  { group: '数据库映射', key: 'metadata.t_behavior_field_mapper', description: '水泵、加热、阀门等运行状态字段映射。', example: 'field1 = 水泵 = pump', notice: '属性名要与设备状态上报一致。' },
  { group: '数据库映射', key: 'metadata.t_direct_config', description: '控制项名称、控件类型、范围、下发字段和值。', example: '水泵开关 / switch / pump', notice: '保存后决定\u201c指令配置\u201d页面生成哪些控件。' },
  { group: 'SQL与图表', key: 'metadata.t_derived_metric', description: '派生指标公式、单位、精度和 ECharts 样式。', example: 'field2-field1 = 温差', notice: '建议在\u201c公式与图表\u201d页可视化编辑。' },
  { group: '数据库映射', key: 'field1 (进水温度)', description: '进水口温度传感器，MQTT属性名建议 Tin 或 inlet_temperature，单位 \u2103。', example: 'Tin', notice: '请确认现场实际属性名。' },
  { group: '数据库映射', key: 'field2 (出水温度)', description: '出水口温度传感器，MQTT属性名建议 Tout 或 outlet_temperature，单位 \u2103。', example: 'Tout', notice: '与进水温度分属不同位置。' },
  { group: '数据库映射', key: 'field3 (循环流量)', description: '流量传感器，MQTT属性名建议 Flow 或 flow_rate，单位 L/min。', example: 'Flow', notice: '可能有累计值需求。' },
  { group: '数据库映射', key: 'field4 (管路压力)', description: '压力传感器，MQTT属性名建议 Pressure 或 pressure，单位 kPa。', example: 'Pressure', notice: '管路过压需告警。' },
  { group: '数据库映射', key: 'behavior field1 (水泵)', description: '水泵状态，MQTT属性名建议 pump。', example: 'pump', notice: '确认与CONTROL_VALUE_MAP一致。' },
  { group: '数据库映射', key: 'behavior field2 (加热模块)', description: '加热模块状态，MQTT属性名建议 heater。', example: 'heater', notice: '水泵未开时禁止加热。' },
  { group: '数据库映射', key: 'd_config 水泵开关', description: '控件类型 switch，下发属性 pump，值 on/off。', example: 'preffix: pump', notice: '经CONTROL_VALUE_MAP转换为设备真实值。' },
  { group: '数据库映射', key: 'd_config 加热开关', description: '控件类型 switch，下发属性 heater，值 on/off。', example: 'preffix: heater', notice: '联锁时自动关闭。' },
  { group: 'SQL与图表', key: 't_derived_metric 温差', description: '进出水温差 = field2 - field1，精度1位。', example: 'delta_temp / 温差 / field2 - field1', notice: '折线图左轴展示。' },
  { group: 'SQL与图表', key: 't_derived_metric 平均温度', description: '平均温度 = (field1 + field2) / 2，精度1位。', example: 'avg_temp / 平均温度 / (field1+field2)/2', notice: '折线图左轴展示。' },
  { group: '告警联锁', key: 'ALARM_RULES 温度过高', description: '出水温度 > 80\u2103 告警，可选联锁关闭加热。', example: 'field: Tout, >, 80', notice: '联锁前必须ENABLE_AUTO_INTERLOCK=false。' },
  { group: '告警联锁', key: 'ALARM_RULES 流量过低', description: '水泵开启时流量 < 0.5 L/min 告警。', example: 'require: pump values: [open]', notice: '水泵未开时不触发。' },
  { group: '告警联锁', key: 'ALARM_RULES 压力过高', description: '管路压力 > 500 kPa 告警，可选联锁关闭水泵。', example: 'field: Pressure, >, 500', notice: '防止管路破裂。' },
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
    ElMessage.success('场景文件已载入，请检查后点击\u201c校验并应用\u201d')
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
.reference-toolbar { display: flex; align-items: center; gap: 16px; margin-bottom: 14px; color: #64748b; }
.reference-toolbar .el-input { max-width: 620px; }
.reference-toolbar code, :deep(.el-table code) { color: #c7254e; }
:deep(textarea) { font-family: Consolas, Monaco, monospace; font-size: 13px; }
@media (max-width: 900px) { .reference-toolbar { align-items: stretch; flex-direction: column; } }
</style>
