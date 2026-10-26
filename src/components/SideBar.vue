<!--
 * 【文件职责】
 * 可复用界面组件，负责展示数据或组织页面布局。
 * 【配置中心关联】
 * 不持久化配置中心；需要展示场景信息时由父组件或状态仓库传入。
 * -->
<template>
    <div class="container">
        <el-row class="tac">
            <el-col :span="24">
                <h4 style="text-align: center;">{{ config.SYSTEM_TITLE }}</h4>
                <el-menu
                    :default-active="activeMenu"
                    :default-openeds="openedMenus"
                    class="el-menu-vertical-demo"
                    @open="handleOpen"
                    @close="handleClose"
                    router
                >
                    <el-menu-item index="/dashboard" to="/dashboard">
                        <el-icon><DataBoard /></el-icon>
                        <span>首页概览</span>
                    </el-menu-item>
                    <!-- 「合并版」：传感器与行为永远是同一条消息里的数据，合并成一整套数据页面。
                         一条上报消息 = 数据库一行 = 页面上的一行，不再分"传感器数据/行为数据"两套页面。
                         分开版的 4 个旧地址在 router/index.js 里保留重定向，老链接点了不会 404。 -->
                    <el-sub-menu v-if="config.SHOW_COMBINED_PAGE !== false" index="1">
                        <template #title>
                            <el-icon>
                                <Connection />
                            </el-icon>
                            <span>{{ terms.combined }}</span>
                        </template>
                        <el-menu-item index="/combined-realtime" to="/combined-realtime">
                            <el-icon><Promotion /></el-icon>
                            <span>实时数据</span>
                        </el-menu-item>
                        <el-menu-item index="/combined-history" to="/combined-history">
                            <el-icon><Histogram /></el-icon>
                            <span>汇总数据</span>
                        </el-menu-item>
                    </el-sub-menu>
                    <el-sub-menu index="3">
                        <template #title>
                            <el-icon>
                                <View />
                            </el-icon>
                            <span>{{ terms.device }}</span>
                        </template>
                        <!-- <el-menu-item index="/device-management">
                            <el-icon><Grid /></el-icon>
                            <span>设备管理</span>
                        </el-menu-item> -->
                        <el-menu-item index="/device-setting">
                            <el-icon><Setting /></el-icon>
                            <span>指令配置</span>
                        </el-menu-item>
                        <el-menu-item index="/operation-history">
                            <el-icon><Timer /></el-icon>
                            <span>操作历史</span>
                        </el-menu-item>
                    </el-sub-menu>
                    <el-menu-item index="/history-charts" to="/history-charts">
                        <el-icon><TrendCharts /></el-icon>
                        <span>历史图表</span>
                    </el-menu-item>
                    <el-menu-item index="/error-info" to="/error-info">
                        <el-icon>
                            <Document />
                        </el-icon>
                            <span>{{ terms.alarm }}</span>
                    </el-menu-item>
                    <el-menu-item v-if="config.INTELLIGENT_JUDGMENT?.showHistoryMenu" index="/judgment-history" to="/judgment-history">
                        <el-icon><Document /></el-icon>
                        <span>{{ terms.judgment }}记录</span>
                    </el-menu-item>
                    <el-menu-item v-if="config.AUTO_JUDGMENT?.showMenu" index="/auto-judgment" to="/auto-judgment">
                        <el-icon><Document /></el-icon>
                        <span>{{ terms.judgment }}（自动）</span>
                    </el-menu-item>
                </el-menu>
            </el-col>
        </el-row>
    </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useSystemConfigStore } from '@/stores/useSystemConfigStore'

const route = useRoute()
const systemStore = useSystemConfigStore()
const config = computed(() => systemStore.config)
const terms = computed(() => systemStore.config.TERMINOLOGY || {})
onMounted(() => systemStore.load().catch(error => console.error('[SideBar] 配置加载失败:', error)))

const menuParents = {
    '/combined-realtime': '1',
    '/combined-history': '1',
    '/device-management': '3',
    '/device-setting': '3',
    '/operation-history': '3',
}

const activeMenu = computed(() => route.path === '/' ? '/dashboard' : route.path)
const openedMenus = computed(() => {
    const parent = menuParents[activeMenu.value]
    return parent ? [parent] : []
})

const handleOpen = (key, keyPath) => {
    console.log(key, keyPath)
}
const handleClose = (key, keyPath) => {
    console.log(key, keyPath)
}
</script>
<style scoped>
.container{
    width: 100%;
    height: 100%;
    margin: 0 !important;
    padding: 0 !important;
    text-align: left;
}
:deep(.el-row) {
    margin: 0 !important;
    padding: 0 !important;
}
:deep(.el-col) {
    margin: 0 !important;
    padding: 0 !important;
    display: flex;
    flex-direction: column;
}
:deep(.el-menu) {
    text-align: left;
}

.tac,
:deep(.el-col) {
    height: 100%;
}

.el-menu-vertical-demo {
    border-right: none;
}

</style>
