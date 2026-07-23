/**
 * 【文件职责】
 * Pinia 状态仓库，集中管理前端共享状态和异步业务操作。
 * 【配置中心关联】
 * 如读取配置中心，必须通过接口或 SystemConfigStore 获取最新值，不能长期写死场景参数。
 * */
import { defineStore } from "pinia";
import { ref } from 'vue'
import api from '@/api'
import { DisplayStore } from '@/stores/DisplayStore'

export const PaginationStore = defineStore("paginationStore", () => {
    const paginationData = ref([])
    const total = ref(0)
    const currentPage = ref(1) 
    const pageSize = ref(5)
    const fieldUnits = ref({})
    const chartSettings = ref({})
    const loading = ref(false)
    const type = ref('数据监测中心')

        const fetchPaginationData = async (params = {}) => {
        loading.value = true
        try {
            // 传感器历史和行为历史共用分页接口，通过 type 切换数据表。
            const queryParams = {
                type: params.type || 'sensor',
                page: params.currentPage || currentPage.value,
                keyword: params.keyword || '',
                pageSize: params.pageSize ? Number(params.pageSize) : pageSize.value
            }
            // 只发送有值的参数，避免 null 序列化为 "null" 字符串
            if (params.online) queryParams.online = params.online
            if (params.startTime) queryParams.startTime = params.startTime
            if (params.endTime) queryParams.endTime = params.endTime

            const response = await api.get('/dataByType', { params: queryParams })
            if (response.data.success) {
                paginationData.value = response.data.data.list || []
                fieldUnits.value = response.data.data.fieldUnits || {}
                chartSettings.value = response.data.data.chartSettings || {}
                total.value = response.data.data.total || 0
                currentPage.value = response.data.data.page || 1
                pageSize.value = response.data.data.size || pageSize.value

                if (params.type) {
                    type.value = params.type === 'behavior' ? '行为数据监测' : '数据监测中心'
                } else if (response.data.data.type) {
                    type.value = response.data.data.type
                }

                // 后端返回数据库时间，Store 统一格式化后再交给表格展示。
                const displayStore = DisplayStore()
                paginationData.value = paginationData.value.map(item => ({
                    ...item,
                    '创立时间': displayStore.formatTime(item['创立时间'])
                }));
            }
        } catch (error) {
            console.error('请求失败:', error)
        } finally {
            loading.value = false
        }
    }
    return {
        fetchPaginationData,
        paginationData,
        total,
        currentPage,
        pageSize,
        fieldUnits,
        chartSettings,
        loading,
        type
    }
})
