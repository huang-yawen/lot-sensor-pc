/**
 * WebSocket 客户端工具
 * 连接后端 WebSocket 服务器，接收实时推送消息
 * 支持自动重连机制
 */

const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
const WS_BASE_URL = import.meta.env.VITE_WS_URL || `${wsProtocol}//${location.host}`

let ws = null
let reconnectTimer = null
let heartbeatTimer = null
let listeners = {}
let isManualClose = false

const RECONNECT_INTERVAL = 3000 // 重连间隔（毫秒）
const HEARTBEAT_INTERVAL = 15000 // 心跳间隔（毫秒）

/**
 * 建立 WebSocket 连接
 * @param {Object} options
 * @param {string} [options.url] - WebSocket 地址，默认自动拼接
 * @param {Function} [options.onMessage] - 收到消息的回调
 * @param {Function} [options.onOpen] - 连接打开的回调
 * @param {Function} [options.onClose] - 连接关闭的回调
 * @param {Function} [options.onError] - 连接错误的回调
 */
export function connect(options = {}) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    console.log('[WebSocket] 已连接或正在连接，跳过重复连接')
    return
  }

  isManualClose = false
  const url = options.url || `${WS_BASE_URL}/ws`

  try {
    ws = new WebSocket(url)
  } catch (err) {
    console.error('[WebSocket] 创建连接失败:', err)
    scheduleReconnect(options)
    return
  }

  ws.onopen = () => {
    console.log('[WebSocket] 连接已建立')
    startHeartbeat()
    if (options.onOpen) options.onOpen()
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      const { type, payload } = data

      // 触发对应类型的监听器
      if (listeners[type]) {
        listeners[type].forEach((fn) => fn(payload))
      }

      // 触发全局消息监听器
      if (listeners['*']) {
        listeners['*'].forEach((fn) => fn(data))
      }

      if (options.onMessage) options.onMessage(data)
    } catch (err) {
      console.warn('[WebSocket] 消息解析失败:', err)
    }
  }

  ws.onclose = (event) => {
    console.log('[WebSocket] 连接已关闭, code:', event.code)
    stopHeartbeat()
    if (options.onClose) options.onClose(event)

    if (!isManualClose) {
      scheduleReconnect(options)
    }
  }

  ws.onerror = (err) => {
    console.error('[WebSocket] 连接错误:', err)
    if (options.onError) options.onError(err)
  }
}

/**
 * 注册消息类型监听器
 * @param {string} type - 消息类型（如 'sensor_data'），'*' 表示所有消息
 * @param {Function} callback - 回调函数
 * @returns {Function} 取消监听的函数
 */
export function on(type, callback) {
  if (!listeners[type]) {
    listeners[type] = []
  }
  listeners[type].push(callback)

  // 返回取消订阅函数
  return () => {
    listeners[type] = listeners[type].filter((fn) => fn !== callback)
  }
}

/**
 * 手动关闭 WebSocket 连接
 */
export function close() {
  isManualClose = true
  stopHeartbeat()
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.onclose = null
    ws.close()
    ws = null
  }
}

/**
 * 完全关闭 WebSocket 连接并阻止自动重连
 */
export function closePermanently() {
  close()
}

/**
 * 发送消息到服务器
 * @param {Object} data - 要发送的数据
 */
export function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data))
  } else {
    console.warn('[WebSocket] 未连接，无法发送消息')
  }
}

// ==================== 内部辅助函数 ====================

function scheduleReconnect(options) {
  if (reconnectTimer) return
  console.log(`[WebSocket] ${RECONNECT_INTERVAL}ms 后尝试重连...`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect(options)
  }, RECONNECT_INTERVAL)
}

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }))
    }
  }, HEARTBEAT_INTERVAL)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}
