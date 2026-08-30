/**
 * 【文件职责】运行模式与端点地址解析器。
 * 统一提供 HTTP、WebSocket 地址，避免页面分别硬编码 localhost 或公网 IP。
 * 【配置中心关联】不保存后端场景配置；连接模式仅存浏览器 localStorage。环境变量
 * VITE_LOCAL_*、VITE_REMOTE_* 可覆盖默认地址，切换后由 API/WebSocket 调用方即时读取。
 * MQTT Broker 地址不在这里维护——它只有配置中心的 MQTT_URL 一个生效来源，本模块的
 * 本地/远程切换不会、也不应该去改动它，避免出现"两处都能设置地址但只有一处真正生效"。
 * */
const STORAGE_KEY = 'lot-connection-mode'
const LOCAL_MODE = 'local'
const REMOTE_MODE = 'remote'

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function isLocalHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function defaultMode() {
  const configured = import.meta.env.VITE_DEFAULT_CONNECTION_MODE
  if (configured === LOCAL_MODE || configured === REMOTE_MODE) return configured
  return isLocalHostname(window.location.hostname) ? LOCAL_MODE : REMOTE_MODE
}

export function getConnectionMode() {
  const saved = window.localStorage.getItem(STORAGE_KEY)
  return saved === LOCAL_MODE || saved === REMOTE_MODE ? saved : defaultMode()
}

export function setConnectionMode(mode) {
  if (mode !== LOCAL_MODE && mode !== REMOTE_MODE) {
    throw new Error(`不支持的连接模式: ${mode}`)
  }
  window.localStorage.setItem(STORAGE_KEY, mode)
}

export function getApiBaseUrl(mode = getConnectionMode()) {
  if (mode === LOCAL_MODE) {
    return trimTrailingSlash(import.meta.env.VITE_LOCAL_API_BASE_URL || 'http://localhost:3000')
  }

  // 部署在公网 Nginx 时优先复用当前页面来源，避免把协议或端口写死。
  const deployedOnRemoteHost = !isLocalHostname(window.location.hostname)
  const fallback = deployedOnRemoteHost ? window.location.origin : 'http://101.133.232.20'
  return trimTrailingSlash(
    import.meta.env.VITE_REMOTE_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || fallback
  )
}

export function getWebSocketBaseUrl(mode = getConnectionMode()) {
  const configured = mode === LOCAL_MODE
    ? import.meta.env.VITE_LOCAL_WS_URL
    : (import.meta.env.VITE_REMOTE_WS_URL || import.meta.env.VITE_WS_URL)

  if (configured) return trimTrailingSlash(configured)
  return getApiBaseUrl(mode).replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
}

export const CONNECTION_MODES = Object.freeze({
  LOCAL: LOCAL_MODE,
  REMOTE: REMOTE_MODE,
})
