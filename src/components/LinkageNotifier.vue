<!--
 * 【文件职责】正常状况联动实时提示器。挂载在 MainLayout.vue 里，监听 WebSocket 的
 * linkage_triggered 事件——不管用户停在哪个页面，联动一下发开关就在右上角提示，
 * 不需要每个业务页面各自监听，组件内部自己监听 WebSocket。
 *
 * 三个提示组件的分工（都挂在 MainLayout，各监听各的事件，互不干扰）：
 *   FaultAlertDialog.vue   硬故障 —— 模态、排队、必须手动复位才能继续操作
 *   SafetyAlertNotifier.vue 安全联锁 —— 红色通知、停 10 秒（异常处置，已强制关设备）
 *   AlarmNotifier.vue      阈值告警/数据质量 —— 黄色通知、停 6 秒
 *   本组件               正常联动 —— 蓝色 info、停 4.5 秒
 * 本组件级别最低，因为它不是"出事了"，而是"系统按规则正常调节了一下"，用户知道
 * 一声就行，不该跟真正的异常长得一样、也不该占屏太久。
 *
 * 会不会刷屏：不会。后端只在**真的下发了指令**时才广播——规则命中但结论跟当前
 * 状态一致、或者被 canAct 防抖（同一开关 3 秒内只动一次）拦住时都不下发、也就不弹。
 * 稳态运行时开关状态不变，一条都不会弹。
 * 【配置中心关联】无直接读取；展示内容完全来自 linkageRules.js 广播的联动事件。
 * -->
<script setup>
import { onMounted, onUnmounted } from 'vue'
import { ElNotification } from 'element-plus'
import { connect, on as wsOn } from '@/utils/websocket'

let unsubscribe = null

/** 读数为 null（这条消息没带这个字段）时显示 '-'，不显示 'null'。 */
const val = (v) => (v == null ? '-' : v)

function handleLinkageTriggered(trigger) {
  // 一次动作可能由好几条规则共同判定出来，全列出来用户才知道是被什么触发的
  const rules = (trigger.rules || []).join('、') || '联动规则'
  const s = trigger.sensors || {}
  const device = trigger.deviceNo ? `（设备 ${trigger.deviceNo}）` : ''
  ElNotification({
    title: `联动控制：${trigger.deviceLabel}→${trigger.actionLabel}`,
    // 纯文本单行，跟 AlarmNotifier / SafetyAlertNotifier 一致，不引入 HTMLString。
    // 用"｜"分段，跟告警记录页的记录文案是同一套排版，两边看到的东西对得上。
    message: `命中：${rules}${device}｜`
      + `T1=${val(s.temp1)} T2=${val(s.temp2)} 流量=${val(s.flow)} 压力=${val(s.pressure)}`,
    type: 'info',
    duration: 4500, // 比安全联锁(10s)、阈值告警(6s)都短：正常调节，扫一眼就够
    position: 'top-right',
    offset: 50,
  })
}

onMounted(() => {
  connect()
  unsubscribe = wsOn('linkage_triggered', handleLinkageTriggered)
})

onUnmounted(() => {
  unsubscribe?.()
})
</script>

<template>

</template>
