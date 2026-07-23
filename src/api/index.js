/**
 * 【文件职责】前端 HTTP 请求唯一入口。
 * 所有业务页面通过此 Axios 实例调用后端，统一设置超时和禁止缓存请求头。
 * 【配置中心关联】不直接读写场景配置。每次请求拦截时调用 getApiBaseUrl()，按“本地比赛/
 * 远程联调”模式选择 localhost 或公网地址；切换模式后下一次请求立即使用新地址。
 * */
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
  // 不在创建实例时固定 baseURL，防止用户切换运行模式后仍请求旧服务器。
  config.baseURL = getApiBaseUrl()
  return config
})

export default api
