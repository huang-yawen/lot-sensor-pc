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
    </div>
</template>

<script setup>
import SideBar from '@/components/SideBar.vue'
import TopNav from '@/components/TopNav.vue'
import { DisplayStore } from '@/stores/DisplayStore'

import { ref, onMounted } from 'vue'
const activeIndex = ref('2')
const displayStore = DisplayStore()
onMounted(() => displayStore.loadDisplayConfig().catch(error => console.error('[DisplayConfig] 加载失败:', error)))
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
