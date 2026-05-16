<template>
  <div class="container">
        <div class="breadcrumb" :style="{ right: breadcrumbRight }">
            <!-- // 面包屑导航,形成首页>行为数据>历史数据 的导航栏目 -->
            <span v-for="(item, index) in breadcrumbItems" :key="item.path">
                <span v-if="index > 0" class="arrow">></span>
                <span>{{ item.label }}</span>
            </span>
        </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { HomeFilled } from '@element-plus/icons-vue'

const router = useRouter()
const route = useRoute()

const breadcrumbItems = ref([])

const breadcrumbRight = computed(() => {
    const count = breadcrumbItems.value.length
    if (count <= 2) {
        return '70px'
    }
    return '60px'
})

const getBreadcrumb = (route) => {
    const matched = route.matched
    const items = []
    matched.forEach(record => {
        if (record.meta && record.meta.title) {
            const titles = record.meta.title.split('/')
            titles.forEach((title, index) => {
                items.push({
                    path: record.path,
                    label: title
                })
            })
        }
    })
    return items
}

const updateBreadcrumb = () => {
    breadcrumbItems.value = getBreadcrumb(route)
}

onMounted(() => {
    updateBreadcrumb()
    router.afterEach(updateBreadcrumb)
})

onUnmounted(() => {
    router.afterEach(() => {})
})
</script>

<style scoped>
.container{
    height: 50px;
    background-color: #374270;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 20px;
    position: relative;
}
.container span{
    color: #fff;
}
.breadcrumb {
    position: absolute;
    right: 150px;
    color: #fff;
    font-size: 14px;
}
.breadcrumb .arrow {
    margin: 0 8px;
    color: #aaa;
}
.breadcrumb span {
    color: #fff;
    font-size: 16px;
    line-height: 70px;
}
.home-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #fff;
    text-decoration: none;
    padding: 6px 12px;
    border-radius: 4px;
    transition: background-color 0.2s;
}
.home-btn:hover {
    background-color: rgba(255, 255, 255, 0.1);
}
</style>