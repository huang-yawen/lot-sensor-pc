<!--
 * 【文件职责】安全联锁触发实时提示器。挂载在 MainLayout.vue 里，监听 WebSocket 的
 * safety_triggered 事件——不管用户停在哪个页面，安全联锁一触发就在右上角提示，
 * 不需要每个业务页面各自监听，组件内部自己监听 WebSocket。
 *
 * 跟 FaultAlertDialog.vue（模态、排队、需手动复位）不同：安全联锁触发时已经把
 * 水泵和加热强制关掉了，是"已动作、通知知悉"的性质，不需要用户处理，所以用
 * Element Plus 的 ElNotification：非阻塞、右上角、可手动关，多条自动堆叠排队。
 * 跟 AlarmNotifier.vue 用法一致，只是 type 用 error（安全联锁比普通阈值告警严重）、
 * 停留时间长一点。
 * 【配置中心关联】无直接读取；展示内容完全来自 safetyInterlock.js 广播的触发事件。
 * -->
<script setup>
import { onMounted, onUnmounted } from 'vue'
import { ElNotification } from 'element-plus'
import { connect, on as wsOn } from '@/utils/websocket'

let unsubscribe = null

function handleSafetyTriggered(trigger) {
  const action = trigger.interlocked ? '已强制关闭水泵和加热' : '已记录，未执行关闭'
  const device = trigger.deviceNo ? `（设备 ${trigger.deviceNo}）` : ''
  ElNotification({
    title: `安全联锁：${trigger.name || '已触发'}`,
    message: `${trigger.detail ? trigger.detail + '，' : ''}${action}${device}`,
    type: 'error',
    duration: 10000, // 停留 10 秒，也可手动关；比阈值告警的 6 秒长
    position: 'top-right',
  })
}

onMounted(() => {
  connect()
  unsubscribe = wsOn('safety_triggered', handleSafetyTriggered)
})

onUnmounted(() => {
  unsubscribe?.()
})
</script>

<template>

</template>
