<!--
 * 【文件职责】
 * 可复用界面组件，负责展示数据或组织页面布局。
 * 【配置中心关联】
 * 不持久化配置中心；需要展示场景信息时由父组件或状态仓库传入。
 * -->
<template>
    <div class="container">
        <div class="main-row">
            <div class="sidebar">
                <SideBar />
            </div>
            <div class="right-content">
                <div class="top-nav">
                    <TopNav />
                </div>
                <div class="content">
                    <router-view />
                </div>
            </div>
        </div>
        <!-- 全局挂载点：不管用户停在哪个页面，只要后端触发新故障就弹窗提示，
             不需要每个业务页面各自监听，组件内部自己监听 WebSocket。 -->
        <FaultAlertDialog />
        <!-- 安全联锁触发的实时提示（非阻塞），见 SafetyAlertNotifier.vue 头部注释。 -->
        <SafetyAlertNotifier />
        <!-- 自定义阈值告警（ALARM_RULES）的实时提示，跟上面故障弹窗是两套独立机制，
             各自监听不同的 WebSocket 事件，互不干扰，见 AlarmNotifier.vue 头部注释。 -->
        <AlarmNotifier />
        <!-- 正常状况联动下发开关时的实时提示（非阻塞、info 级），见 LinkageNotifier.vue 头部注释。 -->
        <LinkageNotifier />
        <!-- 智能判定联动告警弹窗（可选复位），见 JudgmentActionAlertDialog.vue 头部注释。 -->
        <JudgmentActionAlertDialog />
    </div>
</template>

<script setup>
import SideBar from '@/components/SideBar.vue'
import TopNav from '@/components/TopNav.vue'
import FaultAlertDialog from '@/components/FaultAlertDialog.vue'
import SafetyAlertNotifier from '@/components/SafetyAlertNotifier.vue'
import AlarmNotifier from '@/components/AlarmNotifier.vue'
import LinkageNotifier from '@/components/LinkageNotifier.vue'
import JudgmentActionAlertDialog from '@/components/JudgmentActionAlertDialog.vue'
import { useDisplayStore } from '@/stores/useDisplayStore'

import { ref, onMounted } from 'vue'
const activeIndex = ref('2')
const displayStore = useDisplayStore()
onMounted(() => {
  displayStore.loadDisplayConfig().catch(error => console.error('[DisplayConfig] 加载失败:', error))
})
</script>

<style scoped>
.container {
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
    flex-wrap: wrap;
}

.sidebar {
    width: 240px;
    flex-shrink: 0;
    background-color: #f5f5f5;
}

.top-nav {
    height: 70px;
}

.main-row {
    display: flex;
    flex: 1;
}

.right-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    height: 100vh;
    background-color: #e2e2e2;
}

.content {
    flex: 1;
    overflow: hidden;
    padding: 20px;
    box-sizing: border-box;
    display: flex;
    height: 100%;
    margin-left: 10px;
    margin-top: 10px;
    background-color: rgb(255, 255, 255);
    height: 100vh;
}

.content :deep(> *) {
    background-color: #fff;
    border-radius: 8px;
    height: 100%;
    width: 100%;
    padding: 20px;
    box-sizing: border-box;
    overflow: auto;
}
.el-menu-item-group__title{
    padding:0px;
}
.el-menu-item-group__title{
    padding:0px;
}
</style>
