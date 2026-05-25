import axios from 'axios'

// 统一 API 实例；生产环境可通过 VITE_API_BASE_URL 指向后端地址。
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 10000,
  headers: {
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache'
  }
})

export default api
