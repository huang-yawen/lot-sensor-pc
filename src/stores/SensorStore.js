import { defineStore } from "pinia";
import { ref } from 'vue'

export const sensorStore = defineStore('sensorStore', () => {
    const sensorData = ref({})
    
    const sensorValue = () => sensorData.value
    
    const fetchData = async (online = '') => {
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
            console.warn('使用 mock 数据...')
            sensorData.value = {
                proccessData: [
                    { id: '1', 设备编号: 'D001', 数据类型: '温度', 温度: '25.5', 湿度: '60%', 创立时间: '2024-01-15 10:30:00', 采集时间: '2024-01-15 10:30:00' },
                    { id: '2', 设备编号: 'D002', 数据类型: '温度', 温度: '26.3', 湿度: '55%', 创立时间: '2024-01-15 10:31:00', 采集时间: '2024-01-15 10:31:00' },
                    { id: '3', 设备编号: 'D003', 数据类型: '温度', 温度: '24.8', 湿度: '62%', 创立时间: '2024-01-15 10:32:00', 采集时间: '2024-01-15 10:32:00' },
                    { id: '4', 设备编号: 'D004', 数据类型: '温度', 温度: '25.1', 湿度: '58%', 创立时间: '2024-01-15 10:33:00', 采集时间: '2024-01-15 10:33:00' },
                    { id: '5', 设备编号: 'D005', 数据类型: '温度', 温度: '25.9', 湿度: '61%', 创立时间: '2024-01-15 10:34:00', 采集时间: '2024-01-15 10:34:00' }
                ]
            }
        }
    }
    
    return { sensorData, fetchData, sensorValue }
})