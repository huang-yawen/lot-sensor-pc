/**
 * 【干什么】"组合数据"两个页面（/combined-realtime、/combined-history）共用的分页数据源。
 * 【跟 usePaginationStore 的区别】那个 store 是"分开版"4 个页面共用、靠 type 参数切
 *   t_sensor_data/t_behavior_data 两张表；本 store 固定 type='combined'，一次拿到
 *   「一条上报消息」的全部字段（传感器列 + 行为列），不跟那 4 个页面共用实例，
 *   避免来回切页面时互相覆盖分页状态。
 *
 * 【导出】useCombinedStore()
 * 【状态】paginationData（当前页行，行里同时含 `传感器·xxx` 和 `行为·xxx` 列）、total、
 *        currentPage、pageSize、fieldUnits、chartSettings、loading
 * 【方法】fetchCombinedData(params, { silent }) → GET /api/dataByType?type=combined
 *   params: { currentPage, pageSize, keyword, dataScope, metricScope, startTime, endTime }
 *   silent=true：WebSocket 推送触发的静默刷新，不切 loading
 * 【调的接口】GET /api/dataByType（type=combined）
 * 【谁在用】CombinedRealtime.vue、CombinedHistory.vue
 */
import { defineStore } from "pinia";
import { ref } from 'vue'
import api from '@/api'
import { useDisplayStore } from '@/stores/useDisplayStore'

export const useCombinedStore = defineStore("combinedStore", () => {
    const paginationData = ref([])
    const total = ref(0)
    const currentPage = ref(1)
    const pageSize = ref(5)
    const fieldUnits = ref({})
    const chartSettings = ref({})
    const loading = ref(false)

    // silent=true 用于 WebSocket 推送触发的后台静默刷新，不切换 loading，
    // 避免表格/卡片里的"加载中..."跟着推送频率一直闪烁。
    const fetchCombinedData = async (params = {}, { silent = false } = {}) => {
        if (!silent) loading.value = true
        try {
            const queryParams = {
                type: 'combined',
                page: params.currentPage || currentPage.value,
                keyword: params.keyword || '',
                pageSize: params.pageSize ? Number(params.pageSize) : pageSize.value
            }
            // 只发送有值的参数，避免 null 序列化成 "null" 字符串。
            if (params.dataScope) queryParams.dataScope = params.dataScope
            // 'realtime' = 不拼接单位（给卡片和图表用，单位由 fieldUnits 单独给）；不传 = 默认 history（拼单位给表格用）
            if (params.metricScope) queryParams.metricScope = params.metricScope
            if (params.startTime) queryParams.startTime = params.startTime
            if (params.endTime) queryParams.endTime = params.endTime

            const response = await api.get('/api/dataByType', { params: queryParams })
            if (response.data.success) {
                // 后端返回数据库时间，Store 统一格式化后再交给页面展示。
                const displayStore = useDisplayStore()
                paginationData.value = (response.data.data.list || []).map(item => ({
                    ...item,
                    '创立时间': displayStore.formatTime(item['创立时间'])
                }))
                fieldUnits.value = response.data.data.fieldUnits || {}
                chartSettings.value = response.data.data.chartSettings || {}
                total.value = response.data.data.total || 0
                currentPage.value = response.data.data.page || 1
                pageSize.value = response.data.data.size || pageSize.value
            }
        } catch (error) {
            console.error('组合数据请求失败:', error)
        } finally {
            if (!silent) loading.value = false
        }
    }

    return {
        fetchCombinedData,
        paginationData,
        total,
        currentPage,
        pageSize,
        fieldUnits,
        chartSettings,
        loading
    }
})
