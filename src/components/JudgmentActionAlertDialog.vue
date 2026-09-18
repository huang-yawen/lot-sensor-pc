<!--
 * 【文件职责】智能判定联动告警弹窗。挂载在 MainLayout.vue 里，监听 WebSocket 的
 *   judgment_action_triggered 事件——智能判定服务判定出"干烧/漏水"等异常并执行了
 *   联动动作后弹出提示，不需要每个业务页面各自监听。
 *   模仿 FaultAlertDialog 的模态排队展示：一次只看一条，处理完再弹下一条。
 *
 * 【复位功能】config.js 的 requireReset=true 时，弹窗底部用"复位"按钮（调
 *   POST /api/judgmentAction/reset 解除后端锁定，像普通故障那样需要人工复位）；
 *   false 时用"知道了"按钮（触发即结束，无需复位）。
 * -->
<template>
  <el-dialog
    v-model="visible"
    width="380px"
    :close-on-click-modal="false"
    class="judgment-action-dialog"
    @close="handleClose"
  >
    <template #header>
      <div class="dialog-head">
        <span class="status-dot"></span>
        <span class="dialog-title">智能判定触发联动</span>
      </div>
    </template>
    <div class="action-body" v-if="current">
      <div class="action-name-row">
        <span class="action-name">{{ current.name }}</span>
        <span class="action-code">{{ current.id }}</span>
      </div>
      <p class="action-detail">{{ current.detail }}</p>
      <div class="action-meta">
        <span>{{ formattedTime }}</span>
        <span v-if="current.deviceNo">设备 {{ current.deviceNo }}</span>
      </div>
    </div>
    <template #footer>
      <el-button v-if="requireReset" class="confirm-btn" @click="handleReset">复位</el-button>
      <el-button v-else class="confirm-btn" @click="handleClose">知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { connect, on as wsOn } from '@/utils/websocket'
import api from '@/api'
import { useSystemConfigStore } from '@/stores/useSystemConfigStore'

const systemStore = useSystemConfigStore()
// 是否启用复位功能：从后端配置 JUDGMENT_ACTION.requireReset 读，决定弹窗按钮是"复位"还是"知道了"。
const requireReset = ref(false)

const visible = ref(false)
const current = ref(null)
const queue = []

const formattedTime = computed(() => {
  if (!current.value?.receivedAt) return ''
  const d = current.value.receivedAt
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})

const showNext = () => {
  if (queue.length === 0) {
    current.value = null
    return
  }
  current.value = queue.shift()
  visible.value = true
}

const handleJudgmentAction = (trigger) => {
  queue.push({ ...trigger, receivedAt: new Date() })
  if (!visible.value) showNext()
}

const handleClose = () => {
  visible.value = false
  // 等关闭动画结束再弹下一条，避免旧弹窗还没收起新弹窗就顶上来。
  nextTick(() => setTimeout(showNext, 200))
}

const handleReset = async () => {
  try {
    const dNo = current.value?.deviceNo || null
    await api.post('/api/judgmentAction/reset', { d_no: dNo })
    ElMessage.success('复位成功')
  } catch (err) {
    ElMessage.error(err.response?.data?.message || '复位失败')
  }
  handleClose()
}

let unsubscribe = null
onMounted(async () => {
  connect()
  unsubscribe = wsOn('judgment_action_triggered', handleJudgmentAction)
  try {
    const config = await systemStore.load()
    requireReset.value = config.JUDGMENT_ACTION?.requireReset === true
  } catch (err) {
    // 读不到配置就按"不需要复位"处理，不影响弹窗本身。
  }
})
onUnmounted(() => {
  unsubscribe?.()
})
</script>

<style scoped>
.dialog-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f59e0b;
  flex-shrink: 0;
}

.dialog-title {
  font-size: 14px;
  font-weight: 500;
  color: #71717a;
}

.action-body {
  padding: 2px 0 4px;
}

.action-name-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}

.action-name {
  font-size: 18px;
  font-weight: 600;
  color: #18181b;
  letter-spacing: -0.01em;
}

.action-code {
  font-size: 12px;
  color: #a1a1aa;
  background: #f4f4f5;
  border-radius: 4px;
  padding: 1px 6px;
}

.action-detail {
  font-size: 13px;
  line-height: 1.6;
  color: #52525b;
  margin: 0 0 14px;
}

.action-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #a1a1aa;
  padding-top: 12px;
  border-top: 1px solid #f4f4f5;
}

.confirm-btn {
  border-radius: 6px;
  padding: 8px 20px;
  background-color: #374270;
  border-color: #374270;
  color: #fff;
}

.confirm-btn:hover {
  background-color: #4a5a91;
  border-color: #4a5a91;
}
</style>

<style>
/* el-dialog 的 header/footer 结构在组件外层，scoped 样式穿不进去，单独一个非 scoped 块。 */
.judgment-action-dialog {
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 12px 28px rgba(0, 0, 0, 0.1);
}
.judgment-action-dialog .el-dialog__header {
  padding: 18px 20px 14px;
  margin: 0;
  border-bottom: 1px solid #f4f4f5;
}
.judgment-action-dialog .el-dialog__body {
  padding: 18px 20px;
}
.judgment-action-dialog .el-dialog__footer {
  padding: 0 20px 18px;
  display: flex;
  justify-content: flex-end;
}
</style>
