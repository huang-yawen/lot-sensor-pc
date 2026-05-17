import { defineStore } from "pinia";
import axios from 'axios'
import { ref } from 'vue'

export const SensorStore = defineStore('sensorStore', () => {
    const sensorData = ref({})
    const loading = ref(false)

    const sensorValue = () => sensorData.value

    const fetchData = async (online = '') => {
        loading.value = true
        try {
            const url = online ? `/data?online=${encodeURIComponent(online)}` : '/data'
            const respond = await fetch(url)

            if (!respond.ok) {
                throw new Error(`HTTP error! status: ${respond.status}`)
            }

            const contentType = respond.headers.get('content-type')
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error('响应不是 JSON 格式')
            }

            const json = await respond.json()
            sensorData.value = json
        } catch (error) {
            console.error('API 请求失败:', error)
            sensorData.value = {}
        } finally {
            loading.value = false
        }
    }

    return { sensorData, fetchData, sensorValue, loading }
})
