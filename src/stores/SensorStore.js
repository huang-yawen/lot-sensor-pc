/**
 * 【文件职责】
 * Pinia 状态仓库，集中管理前端共享状态和异步业务操作。
 * 【配置中心关联】
 * 如读取配置中心，必须通过接口或 SystemConfigStore 获取最新值，不能长期写死场景参数。
 * */
import { defineStore } from "pinia";
import { ref } from 'vue'
import api from '@/api'

export const SensorStore = defineStore('sensorStore', () => {
    const sensorData = ref({})
    const fieldUnits = ref({})
    const loading = ref(false)

    const sensorValue = () => sensorData.value

    const fetchData = async (online = '') => {
        loading.value = true
        try {
            // 实时页按在线状态过滤；不传 online 时请求全部实时概览数据。
            const response = await api.get('/data', {
                params: online ? { online } : {}
            })
            sensorData.value = response.data
            fieldUnits.value = response.data?.fieldUnits || {}
        } catch (error) {
            console.error('API 请求失败:', error)
            sensorData.value = {}
            fieldUnits.value = {}
        } finally {
            loading.value = false
        }
    }

    return { sensorData, fieldUnits, fetchData, sensorValue, loading }
})
