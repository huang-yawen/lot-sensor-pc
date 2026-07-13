<template>
    <div class="container">
        <el-row class="tac">
            <el-col :span="24">
                <h4 style="text-align: center;">物联网数据管理中心</h4>
                <el-menu
                    :default-active="activeMenu"
                    :default-openeds="openedMenus"
                    class="el-menu-vertical-demo"
                    @open="handleOpen"
                    @close="handleClose"
                    router
                >
                    <el-sub-menu index="1">
                        <template #title>
                            <el-icon>
                                <Odometer />
                            </el-icon>
                            <span>传感器数据</span>
                        </template>
                        <el-menu-item index="/sensor-realtime" to="/sensor-realtime">
                            <el-icon><Promotion /></el-icon>
                            <span>实时数据</span>
                        </el-menu-item>
                        <el-menu-item index="/sensor-history" to="/sensor-history">
                            <el-icon><Histogram /></el-icon>
                            <span>历史数据</span>
                        </el-menu-item>
                    </el-sub-menu>
                    <el-sub-menu index="2">
                        <template #title>
                            <el-icon>
                                <Location />
                            </el-icon>
                            <span>行为数据</span>
                        </template>
                        <el-menu-item index="/behavior-realtime" to="/behavior-realtime">
                            <el-icon><Promotion /></el-icon>
                            <span>实时数据</span>
                        </el-menu-item>
                        <el-menu-item index="/behavior-history" to="/behavior-history">
                            <el-icon><Histogram /></el-icon>
                            <span>历史数据</span>
                        </el-menu-item>
                    </el-sub-menu>
                    <el-sub-menu index="3">
                        <template #title>
                            <el-icon>
                                <View />
                            </el-icon>
                            <span>设备数据</span>
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
                    <el-menu-item index="/error-info" to="/error-info">
                        <el-icon>
                            <Document />
                        </el-icon>
                        <span>故障记录</span>
                    </el-menu-item>
                </el-menu>
            </el-col>
        </el-row>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const menuParents = {
    '/sensor-realtime': '1',
    '/sensor-history': '1',
    '/behavior-realtime': '2',
    '/behavior-history': '2',
    '/device-management': '3',
    '/device-setting': '3',
    '/operation-history': '3',
}

const activeMenu = computed(() => route.path === '/' ? '/sensor-realtime' : route.path)
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
