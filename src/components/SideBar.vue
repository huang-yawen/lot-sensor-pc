<template>
    <div class="container">
        <el-row class="tac">
            <el-col :span="24">
                <h4 style="text-align: center;">物联网数据管理中心</h4>
                <el-menu default-active="2" class="el-menu-vertical-demo" @open="handleOpen" @close="handleClose" router>
                    <el-sub-menu index="1">
                        <template #title>
                            <el-icon>
                                <DataLine />
                            </el-icon>
                            <span>传感器数据</span>
                        </template>
                        <el-menu-item-group>
                            <el-menu-item index="/sensor-realtime" to="/sensor-realtime">实时数据</el-menu-item>
                            <el-menu-item index="/sensor-history" to="/sensor-history">历史数据</el-menu-item>
                        </el-menu-item-group>
                    </el-sub-menu>
                    <el-sub-menu index="2">
                        <template #title>
                            <el-icon>
                                <Film />
                            </el-icon>
                            <span>行为数据</span>
                        </template>
                        <el-menu-item-group>
                            <el-menu-item index="/behavior-realtime" to="/behavior-realtime">实时数据</el-menu-item>
                            <el-menu-item index="/behavior-history" to="/behavior-history">历史数据</el-menu-item>
                        </el-menu-item-group>
                    </el-sub-menu>
                    <el-sub-menu index="3">
                        <template #title>
                            <el-icon>
                                <Film />
                            </el-icon>
                            <span>设备管理</span>
                        </template>
                        <el-menu-item-group>
                            <el-menu-item index="/device-management" to="/device-management">设备管理</el-menu-item>
                            <el-menu-item index="/device-setting" to="/device-setting">设备设置</el-menu-item>
                        </el-menu-item-group>
                    </el-sub-menu>
                    <el-menu-item index="/error-info" to="/error-info">
                        <el-icon>
                            <setting />
                        </el-icon>
                        <span>错误信息</span>
                    </el-menu-item>
                </el-menu>
            </el-col>
        </el-row>
    </div>
</template>

<script setup>
import {
    Document,
    Menu as IconMenu,
    Location,
    Setting,
} from '@element-plus/icons-vue'

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
}
:deep(.el-menu) {
    text-align: left;
}
:deep(.el-menu-item-group) {
    padding-left: 0 !important;
}
</style>
