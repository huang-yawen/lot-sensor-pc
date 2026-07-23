import axios from 'axios'
import { getApiBaseUrl } from '@/utils/runtimeEndpoint'

// 每次请求时读取当前连接模式，避免切换后仍使用旧地址。
const api = axios.create({
  timeout: 10000,
  headers: {
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache'
  }
})

api.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl()
  return config
})

export default api
