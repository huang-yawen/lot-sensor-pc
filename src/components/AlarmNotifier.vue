<!--
 * 【文件职责】自定义阈值告警（配置中心"联动控制"页面 ALARM_RULES 里配置的规则）
 * 实时提示器。挂载在 MainLayout.vue 里，监听 WebSocket 的 alarm_triggered 事件——
 * 不管用户停在哪个页面，规则一触发就弹出提示，不需要每个业务页面各自监听。
 *
 * 跟 FaultAlertDialog.vue 是两码事，特意没有做成同款模态弹窗：
 *   FaultAlertDialog 处理的是 5 种系统级硬故障——低频、严重、需要用户看到后手动
 *   点"复位"恢复系统，用模态框排队展示，一次只看一条，逼着用户处理完再关掉。
 *   本组件处理的是用户在"联动控制"页自由配置的普通阈值规则——阈值可能设得比较
 *   敏感、传感器读数也会正常抖动，实际使用中可能几秒钟触发好几条，是"提示"性质、
 *   不需要用户做任何处理，如果也用模态框会疯狂弹窗、把整个操作界面卡死。所以用
 *   Element Plus 的 ElNotification：非阻塞、出现在右上角、几秒后自动消失、
 *   多条同时来了会自动堆叠排队显示，不会互相打断也不会挡住背后的操作。
 * 【配置中心关联】无直接读取；展示内容完全来自 evaluateRules.js 广播的告警事件，
 * 规则本身在配置中心"联动控制"页面的 ALARM_RULES 里维护。
 * -->
<script setup>
import { onMounted, onUnmounted } from 'vue'
import { ElNotification } from 'element-plus'
import { connect, on as wsOn } from '@/utils/websocket'

let unsubscribe = null
let unsubscribeSpike = null
let unsubscribeRelay = null

function handleAlarmTriggered(alarm) {
  ElNotification({
    title: `告警：${alarm.name}`,
    message: alarm.deviceNo ? `${alarm.message}（设备 ${alarm.deviceNo}）` : alarm.message,
    type: 'warning',
    duration: 6000,       // 6 秒后自动消失，不需要用户手动关闭
    position: 'top-right',
  })
}

/**
 * 数据质量板块（SPIKE_FILTER）检测到传感器数值跳变/毛刺时的轻微警告。
 * 性质跟阈值告警一样是"提示、不需要用户处理"——数据已经被拦住不入库，系统会自己
 * 判断这是毛刺还是真实变化，这里只是提醒人工去检查一下传感器接线/干扰，
 * 所以同样用非阻塞的黄色 ElNotification，不做成模态弹窗。
 */
function handleSpikeTriggered(trigger) {
  ElNotification({
    title: '数据异常波动',
    message: trigger.deviceNo ? `${trigger.message}（设备 ${trigger.deviceNo}）` : trigger.message,
    type: 'warning',
    duration: 6000,
    position: 'top-right',
  })
}

/**
 * 数据质量板块规则二（继电器触点粘连/控制失效）的提示，分两级：
 *   level='warning' —— 指令已关但设备还在工作，系统正在自动重发关闭指令尝试恢复。
 *     还有救、不需要用户动手，用 6 秒自动消失的黄色通知。
 *   level='fault'  —— 重发全部无效，判定为硬件故障。必须人工断电检修，所以用红色、
 *     duration=0（不自动消失），逼着用户手动关掉，避免这条关键提示一闪而过被漏看。
 */
function handleRelayStuckTriggered(trigger) {
  const isFault = trigger.level === 'fault'
  ElNotification({
    title: isFault ? '硬件故障：请立即断电检修' : '实际状态与控制指令不符',
    message: trigger.deviceNo ? `${trigger.message}（设备 ${trigger.deviceNo}）` : trigger.message,
    type: isFault ? 'error' : 'warning',
    duration: isFault ? 0 : 6000,
    position: 'top-right',
  })
}

onMounted(() => {
  connect()
  unsubscribe = wsOn('alarm_triggered', handleAlarmTriggered)
  unsubscribeSpike = wsOn('spike_triggered', handleSpikeTriggered)
  unsubscribeRelay = wsOn('relay_stuck_triggered', handleRelayStuckTriggered)
})

onUnmounted(() => {
  unsubscribe?.()
  unsubscribeSpike?.()
  unsubscribeRelay?.()
})
</script>

<template>
  
</template>
