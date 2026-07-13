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
