/**
 * 【干什么】传感器/行为 4 个页面（实时、汇总各一份传感器和行为）共用的分页表格数据源。
 * 一个 store 实例被这 4 个页面共用，靠 type 参数切数据表。
 *
 * 【导出】usePaginationStore()
 * 【状态】paginationData（当前页行）、total、currentPage、pageSize、fieldUnits、chartSettings、
 *        loading、type
 * 【方法】
 *   fetchPaginationData(params, { silent })  → GET /api/dataByType
 *     params: { type:'sensor'|'behavior', currentPage, pageSize, keyword, dataScope, metricScope, startTime, endTime }
 *     silent=true：WebSocket 推送触发的静默刷新，不切 loading（避免"加载中"跟着推送闪）
 * 【调的接口】GET /api/dataByType
 * 【谁在用】SensorRealtime.vue、SensorHistory.vue、BehaviorRealtime.vue、BehaviorHistory.vue
 * 【依赖】DisplayStore.formatTime（格式化"创立时间"列）
 */
import { defineStore } from "pinia";
import { ref } from 'vue'
import api from '@/api'
import { useDisplayStore } from '@/stores/DisplayStore'

export const usePaginationStore = defineStore("paginationStore", () => {
    const paginationData = ref([])
    const total = ref(0)
    const currentPage = ref(1) 
    const pageSize = ref(5)
    const fieldUnits = ref({})
    const chartSettings = ref({})
    const loading = ref(false)
    const type = ref('数据监测中心')

        // silent=true 用于 WebSocket 推送触发的后台静默刷新，不切换 loading，
        // 避免表格里的"加载中..."跟着推送频率一直闪烁。
        const fetchPaginationData = async (params = {}, { silent = false } = {}) => {
        if (!silent) loading.value = true
        try {
            // 传感器历史和行为历史共用分页接口，通过 type 切换数据表。
            const queryParams = {
                type: params.type || 'sensor',
                page: params.currentPage || currentPage.value,
                keyword: params.keyword || '',
                pageSize: params.pageSize ? Number(params.pageSize) : pageSize.value
            }
            // 只发送有值的参数，避免 null 序列化为 "null" 字符串。
            // dataScope 是数据范围筛选值（'实时数据' | '保存数据'），跟设备在线状态无关。
            if (params.dataScope) queryParams.dataScope = params.dataScope
            // metricScope 决定派生指标过滤维度和是否拼单位：
            // 'realtime' = 用 show_realtime 过滤 + 纯数值（给图表/卡片用），不传 = 默认 history。
            if (params.metricScope) queryParams.metricScope = params.metricScope
            if (params.startTime) queryParams.startTime = params.startTime
            if (params.endTime) queryParams.endTime = params.endTime

            const response = await api.get('/api/dataByType', { params: queryParams })
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
                const displayStore = useDisplayStore()
                paginationData.value = paginationData.value.map(item => ({
                    ...item,
                    '创立时间': displayStore.formatTime(item['创立时间'])
                }));
            }
        } catch (error) {
            console.error('请求失败:', error)
        } finally {
            if (!silent) loading.value = false
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
