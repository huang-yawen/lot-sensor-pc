import { defineStore } from "pinia";
import { ref } from 'vue'
import api from '@/api'

export const PaginationStore = defineStore("paginationStore", () => {
    const paginationData = ref([])
    const total = ref(0)
    const currentPage = ref(1) 
    const pageSize = ref(5)
    const loading = ref(false)
    const type = ref('数据监测中心')

    const fetchPaginationData = async (params = {}) => {
        loading.value = true
        try {
            // 传感器历史和行为历史共用分页接口，通过 type 切换数据表。
            const response = await api.get('/dataByType', {
                params: {
                    type: params.type || 'sensor',
                    online: params.online || null,
                    page: params.currentPage || currentPage.value,
                    keyword: params.keyword || '',
                    startTime: params.startTime,
                    endTime: params.endTime,
                    pageSize: params.pageSize ? Number(params.pageSize) : pageSize.value
                },
            })
            if (response.data.success) {
                paginationData.value = response.data.data.list || []
                total.value = response.data.data.total || 0
                currentPage.value = response.data.data.page || 1
                pageSize.value = response.data.data.size || pageSize.value

                if (params.type) {
                    type.value = params.type === 'behavior' ? '行为数据监测' : '数据监测中心'
                } else if (response.data.data.type) {
                    type.value = response.data.data.type
                }

                // 后端返回数据库时间，Store 统一格式化后再交给表格展示。
                paginationData.value = paginationData.value.map(item => ({
                    ...item,
                    '创立时间': item['创立时间']
                        ? new Date(item['创立时间']).toLocaleString('zh-CN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false
                        })
                        : '未知时间'
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
        loading,
        type
    }
})
