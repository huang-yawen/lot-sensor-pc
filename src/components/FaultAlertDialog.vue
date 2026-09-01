<!--
 * 【文件职责】全局故障告警弹窗。挂载在 MainLayout.vue 里，监听 WebSocket 的
 * fault_triggered 事件——不管用户停在哪个页面，后端一触发新故障就弹出提示，
 * 不需要每个业务页面各自监听。短时间内连续触发多个故障时排队依次展示，
 * 不互相覆盖（跟原来 ElMessageBox.alert 的排队行为保持一致）。
 * 【配置中心关联】无直接读取；展示内容完全来自 faultStatus.js 广播的故障事件。
 * -->
<template>
  <el-dialog
    v-model="visible"
    width="380px"
    :close-on-click-modal="false"
    class="fault-alert-dialog"
    @close="handleClose"
  >
    <template #header>
      <div class="dialog-head">
        <span class="status-dot"></span>
        <span class="dialog-title">检测到新故障</span>
      </div>
    </template>
    <div class="fault-body" v-if="current">
      <div class="fault-name-row">
        <span class="fault-name">{{ current.name }}</span>
        <span class="fault-code">{{ current.code }}</span>
      </div>
      <p class="fault-detail">{{ current.detail }}</p>
      <div class="fault-meta">
        <span>{{ formattedTime }}</span>
        <span v-if="current.deviceNo">设备 {{ current.deviceNo }}</span>
      </div>
    </div>
    <template #footer>
      <el-button class="confirm-btn" @click="handleClose">知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { connect, on as wsOn } from '@/utils/websocket'

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

const handleFaultTriggered = (trigger) => {
  queue.push({ ...trigger, receivedAt: new Date() })
  if (!visible.value) showNext()
}

const handleClose = () => {
  visible.value = false
  // 等关闭动画结束再弹下一条，避免旧弹窗还没收起新弹窗就顶上来。
  nextTick(() => setTimeout(showNext, 200))
}

let unsubscribe = null
onMounted(() => {
  connect()
  unsubscribe = wsOn('fault_triggered', handleFaultTriggered)
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
  background: #ef4444;
  flex-shrink: 0;
}

.dialog-title {
  font-size: 14px;
  font-weight: 500;
  color: #71717a;
}

.fault-body {
  padding: 2px 0 4px;
}

.fault-name-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}

.fault-name {
  font-size: 18px;
  font-weight: 600;
  color: #18181b;
  letter-spacing: -0.01em;
}

.fault-code {
  font-size: 12px;
  color: #a1a1aa;
  background: #f4f4f5;
  border-radius: 4px;
  padding: 1px 6px;
}

.fault-detail {
  font-size: 13px;
  line-height: 1.6;
  color: #52525b;
  margin: 0 0 14px;
}

.fault-meta {
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
.fault-alert-dialog {
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 12px 28px rgba(0, 0, 0, 0.1);
}
.fault-alert-dialog .el-dialog__header {
  padding: 18px 20px 14px;
  margin: 0;
  border-bottom: 1px solid #f4f4f5;
}
.fault-alert-dialog .el-dialog__body {
  padding: 18px 20px;
}
.fault-alert-dialog .el-dialog__footer {
  padding: 0 20px 18px;
  display: flex;
  justify-content: flex-end;
}
</style>
