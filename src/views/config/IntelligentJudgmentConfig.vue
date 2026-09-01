<!--
 * 【文件职责】智能判定（HTTP 适配器）可视化配置页。
 * 现场判定服务的接口形态每年可能不一样（JSON/表单请求体、GET/POST、JSON/纯文本
 * 响应、同步直接返回/异步先提交再轮询），这里把这几个维度都做成配置项，赛场现场
 * 拿到接口文档后改配置就能适配，不需要现场改代码重新部署。
 * 【配置中心关联】读取/写入 systemConfig.INTELLIGENT_JUDGMENT，保存后立即生效。
 * -->
<template>
  <div class="judgment-config" v-loading="loading">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="选中传感器/行为历史记录后点“智能判定”，会按下面的配置把数据发给现场判定服务、解析结果并落库。改完配置直接“保存并应用”，不用重启后端。"
    />

    <section class="judgment-section">
      <div class="section-heading">
        <div>
          <h3>基础设置</h3>
          <p>关闭总开关时，是否允许用一个确定性的本地占位判定顶上（不真的请求服务）。</p>
        </div>
        <el-switch v-model="form.enabled" active-text="启用真实判定服务" />
      </div>
      <el-form label-width="160px" class="judgment-form">
        <el-form-item label="服务未启用时">
          <el-switch v-model="form.mockWhenDisabled" active-text="允许本地占位判定" inactive-text="直接报错" />
          <div class="hint">占位判定规则很简单（数值超过±10000 判定为异常），只用于联调界面，正式比赛演示前必须把上面的“启用真实判定服务”打开。</div>
        </el-form-item>
        <el-form-item label="服务地址">
          <el-input v-model="form.url" placeholder="http://127.0.0.1:5000/judgment" />
          <div class="hint">如果判定服务跑在另一台电脑上，127.0.0.1 要改成那台电脑的局域网 IP。</div>
        </el-form-item>
        <el-form-item label="请求方法">
          <el-select v-model="form.method" style="width: 160px">
            <el-option label="POST" value="POST" />
            <el-option label="GET" value="GET" />
            <el-option label="PUT" value="PUT" />
          </el-select>
          <div class="hint">选 GET 时，下面“请求体模板”渲染出的内容会拼接成 URL 查询参数，不再放请求体里。</div>
        </el-form-item>
        <el-form-item label="超时时间">
          <el-input-number v-model="form.timeoutMs" :min="1000" :step="1000" />
          <span class="unit">毫秒（每一次单独 HTTP 请求的超时，异步轮询的总超时见下面“异步模式”）</span>
        </el-form-item>
      </el-form>
    </section>

    <section class="judgment-section">
      <div class="section-heading">
        <div>
          <h3>请求设置</h3>
          <p>怎么把选中的数据发给判定服务。</p>
        </div>
      </div>
      <el-form label-width="160px" class="judgment-form">
        <el-form-item label="判定模式">
          <el-radio-group v-model="form.requestMode">
            <el-radio value="batch">batch：勾选的多条数据一次提交</el-radio>
            <el-radio value="single">single：每条数据分别请求一次再汇总</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="请求体格式">
          <el-radio-group v-model="form.bodyFormat">
            <el-radio value="json">json（application/json）</el-radio>
            <el-radio value="form-data">form-data（multipart，比如要传文件）</el-radio>
          </el-radio-group>
          <div class="hint" v-if="form.bodyFormat === 'form-data'">form-data 模式下，下面模板里的每个顶层字段会变成一个表单字段；下面“请求头”里就算写了 Content-Type 也会被忽略，交给系统自动生成正确的 multipart 边界串。</div>
        </el-form-item>
        <el-form-item label="请求头">
          <el-input v-model="headersText" type="textarea" :rows="3" placeholder='{"Content-Type": "application/json"}' />
          <div class="hint">JSON 对象。需要 Token 就加一行，比如 "Authorization": "Bearer xxx"。</div>
        </el-form-item>
        <el-form-item label="请求体模板">
          <el-input v-model="requestTemplateText" type="textarea" :rows="4" placeholder='{"data": "{{records}}"}' />
          <div class="hint" v-pre>
            可用占位符：<code>{{records}}</code> 全部选中数据数组、<code>{{record}}</code> 当前/第一条数据、
            <code>{{ids}}</code> 原数据 ID 数组，也可以取具体字段如 <code>{{record.field1}}</code>。
            占位符独占整个字符串时保留原始类型（数组/对象），嵌在字符串里则按文本拼接。
          </div>
        </el-form-item>
      </el-form>
    </section>

    <section class="judgment-section">
      <div class="section-heading">
        <div>
          <h3>响应解析</h3>
          <p>怎么从判定服务的响应里读出结论和置信度。</p>
        </div>
      </div>
      <el-form label-width="160px" class="judgment-form">
        <el-form-item label="响应格式">
          <el-radio-group v-model="form.responseFormat">
            <el-radio value="json">json（规范的 JSON 响应，用点路径取值）</el-radio>
            <el-radio value="text">text（纯文字/非 JSON 响应，用正则提取）</el-radio>
          </el-radio-group>
        </el-form-item>

        <template v-if="form.responseFormat === 'json'">
          <el-form-item label="结果列表路径">
            <el-input v-model="form.resultPath" placeholder="data.results" />
            <div class="hint">从响应里取“结果数组/对象”的点路径，比如响应是 {"data":{"results":[]}} 就填 data.results；留空表示直接用整个响应体。</div>
          </el-form-item>
          <el-form-item label="结论字段路径">
            <el-input v-model="form.conclusionPath" placeholder="result" />
          </el-form-item>
          <el-form-item label="置信度字段路径">
            <el-input v-model="form.confidencePath" placeholder="confidence" />
          </el-form-item>
        </template>

        <template v-else>
          <el-form-item label="结论正则">
            <el-input v-model="form.conclusionRegex" placeholder="检测结果：(\S+?)，" />
            <div class="hint">取第 1 个捕获组。比如响应文本是“检测结果：异常，置信度0.87”，填 <code>检测结果：(\S+?)，</code> 能取出“异常”。</div>
          </el-form-item>
          <el-form-item label="置信度正则">
            <el-input v-model="form.confidenceRegex" placeholder="置信度([\d.]+)" />
            <div class="hint">同上例，填 <code>置信度([\d.]+)</code> 能取出 0.87。</div>
          </el-form-item>
        </template>
      </el-form>
    </section>

    <section class="judgment-section">
      <div class="section-heading">
        <div>
          <h3>异步模式</h3>
          <p>现场服务处理较慢时的常见设计：第一次请求只是“提交任务”，要另外轮询才能拿到真正结果。</p>
        </div>
        <el-switch v-model="form.asyncMode" active-text="按异步任务处理" />
      </div>

      <el-form v-if="form.asyncMode" label-width="160px" class="judgment-form">
        <el-form-item label="任务ID字段路径">
          <el-input v-model="form.asyncJobIdPath" placeholder="job_id" />
          <div class="hint">从“提交任务”这次响应里取任务 ID 的点路径，比如响应 {"job_id":"abc"} 填 job_id。</div>
        </el-form-item>
        <el-form-item label="轮询查询地址">
          <el-input v-model="form.asyncPollUrl" placeholder="http://127.0.0.1:5000/result/{{jobId}}" />
          <div class="hint" v-pre>用 <code>{{jobId}}</code> 占位符代入上面取到的任务 ID。</div>
        </el-form-item>
        <el-form-item label="轮询方法">
          <el-select v-model="form.asyncPollMethod" style="width: 160px">
            <el-option label="GET" value="GET" />
            <el-option label="POST" value="POST" />
          </el-select>
        </el-form-item>
        <el-form-item label="轮询间隔">
          <el-input-number v-model="form.asyncPollIntervalMs" :min="100" :step="100" />
          <span class="unit">毫秒</span>
        </el-form-item>
        <el-form-item label="最长等待时间">
          <el-input-number v-model="form.asyncMaxWaitMs" :min="1000" :step="1000" />
          <span class="unit">毫秒（从提交任务算起，超过这个时间还没等到“完成”状态就判定超时失败）</span>
        </el-form-item>
        <el-form-item label="状态字段路径">
          <el-input v-model="form.asyncStatusPath" placeholder="status" />
        </el-form-item>
        <el-form-item label="“已完成”状态值">
          <el-input v-model="asyncDoneStatusValuesText" placeholder="done,success,completed" />
          <div class="hint">逗号分隔，状态值命中其中任意一个就停止轮询、开始解析结果。</div>
        </el-form-item>
        <el-form-item label="“已失败”状态值">
          <el-input v-model="asyncFailedStatusValuesText" placeholder="failed,error" />
          <div class="hint">逗号分隔，状态值命中其中任意一个就停止轮询并记录失败，不会一直轮询到超时。</div>
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
  mockWhenDisabled: true,
  url: 'http://127.0.0.1:5000/judgment',
  method: 'POST',
  timeoutMs: 10000,
  headers: { 'Content-Type': 'application/json' },
  requestMode: 'batch',
  bodyFormat: 'json',
  requestTemplate: { data: '{{records}}' },
  responseFormat: 'json',
  resultPath: 'data.results',
  conclusionPath: 'result',
  confidencePath: 'confidence',
  conclusionRegex: '',
  confidenceRegex: '',
  asyncMode: false,
  asyncJobIdPath: 'job_id',
  asyncPollUrl: '',
  asyncPollMethod: 'GET',
  asyncPollIntervalMs: 1000,
  asyncMaxWaitMs: 30000,
  asyncStatusPath: 'status',
  asyncDoneStatusValues: ['done', 'success', 'completed'],
  asyncFailedStatusValues: ['failed', 'error'],
})

const form = reactive(defaultForm())

// headers/requestTemplate 是内容自由的 JSON 对象，页面上用文本框直接编辑 JSON 字符串
// 比逐字段拼表单更灵活；这里用 computed 做 对象<->文本 的双向转换，文本格式不对时
// 不覆盖 form 里已有的值（避免输入到一半就把已保存的合法配置冲掉）。
function makeJsonTextProxy(key) {
  return computed({
    get: () => JSON.stringify(form[key], null, 2),
    set: (text) => {
      try {
        const parsed = JSON.parse(text)
        form[key] = parsed
      } catch {
        // 解析失败先不动 form[key]，用户可能还没输完；点“保存”前提示会再校验一次。
      }
    },
  })
}
const headersText = makeJsonTextProxy('headers')
const requestTemplateText = makeJsonTextProxy('requestTemplate')

// asyncDoneStatusValues/asyncFailedStatusValues 是字符串数组，用逗号分隔的单行文本编辑更直观。
function makeCsvTextProxy(key) {
  return computed({
    get: () => (form[key] || []).join(','),
    set: (text) => {
      form[key] = text.split(',').map(s => s.trim()).filter(Boolean)
    },
  })
}
const asyncDoneStatusValuesText = makeCsvTextProxy('asyncDoneStatusValues')
const asyncFailedStatusValuesText = makeCsvTextProxy('asyncFailedStatusValues')

async function load() {
  loading.value = true
  try {
    const response = await api.get('/api/system-config')
    const judgment = response.data.data.INTELLIGENT_JUDGMENT || {}
    // 只提取 defaultForm 中定义的字段，忽略持久化文件中可能残留的旧字段。
    const defaults = defaultForm()
    const picked = {}
    for (const key of Object.keys(defaults)) {
      picked[key] = judgment[key] !== undefined ? judgment[key] : defaults[key]
    }
    Object.assign(form, picked)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '智能判定配置加载失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  // headers/requestTemplate 文本框如果当前正好是非法 JSON，makeJsonTextProxy 的 setter
  // 不会更新 form，这里保存前再校验一次，避免把输入到一半的半成品当成"保存成功"。
  try {
    JSON.parse(headersText.value)
    JSON.parse(requestTemplateText.value)
  } catch {
    ElMessage.error('“请求头”或“请求体模板”不是合法 JSON，请检查后再保存')
    return
  }
  saving.value = true
  try {
    await api.post('/api/system-config', { INTELLIGENT_JUDGMENT: { ...form } })
    ElMessage.success('智能判定配置已保存并立即生效')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

load()
</script>

<style scoped>
.judgment-section { margin-top: 16px; padding: 18px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.section-heading h3 { margin: 0 0 5px; color: #0f172a; }
.section-heading p { margin: 0; color: #64748b; }
.judgment-form { margin-top: 6px; }
.judgment-form :deep(textarea) { font-family: 'Consolas', 'Menlo', monospace; font-size: 13px; }
.hint { color: #94a3b8; font-size: 12px; margin-top: 4px; line-height: 1.6; }
.hint code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; color: #334155; }
.unit { margin-left: 8px; color: #64748b; font-size: 13px; }
.save-bar { display: flex; gap: 10px; margin-top: 16px; }
</style>
