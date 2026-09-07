/**
 * 【文件职责】后端 HTTP/WebSocket 服务入口。
 * 负责创建 Express 服务、配置跨域和静态前端、挂载业务路由，并把配置中心、MQTT
 * 和 WebSocket 推送链路在同一进程中启动。
 *
 * 所有业务 API 路由统一放在 routes/sensorRoutes.js 里集中管理，本文件只做：
 *   1. Express 基础配置（CORS、JSON 解析、静态文件）
 *   2. 挂载路由入口（app.use('/', sensorRoutes)）
 *   3. WebSocket + MQTT 集成（广播、节流、事件监听）
 *   4. 初始化逻辑（启动安全联锁、恢复故障态、MQTT 诊断）
 *
 * 【配置中心关联】MQTT_URL 用于启动诊断日志；REALTIME_REFRESH_INTERVAL 控制
 * 实时推送定时器，保存配置后会动态生效。MQTT 的实际连接热更新由 mqtt/index.js 处理。
 * 【环境变量】PORT、HOST、CORS_ORIGINS、FRONTEND_DIST_PATH 只控制部署环境，修改后需重启。
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
require('./config/env');
const sensorRoutes = require('./routes/sensorRoutes');
const { MQTT_URL, MQTT_TOPICS } = require('./config/mqtt');
const { REALTIME_REFRESH_INTERVAL } = require('./config/appSettings');
const { startMonitor: startSafetyMonitor, onSafetyInterlock } = require('./service/safety/safetyInterlock');
const { initFaultStateFromDb, onFault } = require('./service/faultStatus/faultStatus');
const { onAlarm } = require('./service/alarm/evaluateRules');
const { onHeaterBlocked } = require('./service/pidHeating/pidHeating');
const mqttClient = require('./mqtt/index')

const app = express();
const port = Number(process.env.PORT) || 3000;
// 电脑端默认仅监听本机，避免未认证的设备控制接口暴露到局域网或公网。
// 如确需局域网访问，显式设置 HOST，并同时配置严格的 CORS_ORIGINS。
const host = process.env.HOST || '127.0.0.1';
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('该来源不允许访问服务'));
  }
}));
app.use(express.json({ limit: '1mb' }));

// ==================== API 认证 ====================
// 通过环境变量 API_TOKEN 启用；未配置时不拦截（本地开发友好）。
// 配置后所有 /api/ 请求需在 x-api-token 头或 ?token= 查询参数中携带正确 token。
// 静态前端文件（非 /api/ 路径）放行，保证页面能正常加载。
const API_TOKEN = process.env.API_TOKEN || '';
if (API_TOKEN) {
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    const token = req.headers['x-api-token'] || req.query.token;
    if (token !== API_TOKEN) {
      return res.status(401).json({ success: false, message: '未授权访问' });
    }
    next();
  });
}

// 所有业务接口统一挂载到同一个路由入口，便于集中维护。
// 具体路由定义见 routes/sensorRoutes.js，app 层不再直接写路由。
app.use('/', sensorRoutes);

// ==================== 全局错误处理 ====================
// 兜底所有未被控制器 catch 的异常：生产环境不返回内部错误细节（SQL/路径等），
// 开发环境仍返回 err.message 便于调试。
const isProd = process.env.NODE_ENV === 'production';
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[GlobalError]', err.message);
  res.status(500).json({
    success: false,
    message: isProd ? '服务器内部错误' : (err.message || '未知错误')
  });
});

// ==================== 静态前端托管 ====================
// 前端构建产物 dist/ 由后端 express.static 直接提供，不需要单独前端服务器。
const distPath = process.env.FRONTEND_DIST_PATH
  ? path.resolve(process.env.FRONTEND_DIST_PATH)
  : path.join(__dirname, '../../dist');
app.use(express.static(distPath));

app.get('/', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});
console.log('Dist Path:', distPath);

// ==================== MQTT 初始化 ====================
console.log('正在初始化 MQTT 连接...');
console.log('MQTT Broker URL:', MQTT_URL);

// ==================== WebSocket 服务器 ====================
// 和 HTTP 共用同一个 http.Server，避免多进程端口冲突。
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// 存储所有已连接的 WebSocket 客户端
const wsClients = new Set();

wss.on('connection', (ws, req) => {
    // 校验 Origin：拒绝来自非白名单页面的 WebSocket 连接（防恶意网页跨站连入）。
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
        console.warn(`[WebSocket] 拒绝非法来源连接: ${origin}`);
        ws.close(1008, '来源不允许');
        return;
    }
    // 若配置了 API_TOKEN，WebSocket 通过 URL query 传递 ?token=xxx 校验。
    if (API_TOKEN) {
        const url = new URL(req.url, 'http://localhost');
        if (url.searchParams.get('token') !== API_TOKEN) {
            console.warn('[WebSocket] 拒绝未授权连接');
            ws.close(1008, '未授权');
            return;
        }
    }
    console.log(`[WebSocket] 客户端已连接, IP: ${req.socket.remoteAddress}`);
    wsClients.add(ws);
    // 首次连接立即发送当前设备状态，避免头部导航等待下一轮定时广播。
    mqttClient.waitForDeviceSync().then(() => {
        if (ws.readyState !== 1) return;
        ws.send(JSON.stringify({
            type: 'device_status',
            payload: mqttClient.getAllDeviceStatus(),
            timestamp: Date.now()
        }));
    });

    // 处理客户端发来的消息（如心跳 ping）
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            }
        } catch (err) {
            // 忽略非 JSON 消息
        }
    });

    ws.on('close', () => {
        console.log('[WebSocket] 客户端已断开');
        wsClients.delete(ws);
    });

    ws.on('error', (err) => {
        console.error('[WebSocket] 客户端错误:', err.message);
        wsClients.delete(ws);
    });
});

/**
 * 向所有连接的 WebSocket 客户端广播消息
 * @param {string} type - 消息类型（如 'sensor_data', 'behavior_data', 'error_data'）
 * @param {*} payload - 消息内容
 */
function broadcast(type, payload) {
    const message = JSON.stringify({ type, payload, timestamp: Date.now() });
    const deadClients = [];
    wsClients.forEach((client) => {
        if (client.readyState === 1) { // WebSocket.OPEN
            client.send(message);
        } else {
            deadClients.push(client);
        }
    });
    // 清理已断开的客户端
    deadClients.forEach((client) => wsClients.delete(client));
}

// 只在后端确认整批暂存指令都已发送并入库后通知页面。
mqttClient.on('pendingCommandsFlushed', (payload) => {
    broadcast('pending_commands_flushed', payload);
});

// ==================== 消息节流（Throttle） ====================
// 避免底层高频数据导致前端页面闪烁
// 传感器/行为/故障数据按场景配置的实时刷新间隔合并广播。

/** 节流缓存：{ type: latestData } */
const throttleCache = {}

/** 各消息类型的节流间隔（毫秒） */
const THROTTLED_TYPES = new Set(['sensor_data', 'behavior_data', 'error_data'])

/** 各消息类型的定时器 */
const throttleTimers = {}

// 按节流间隔广播一种消息类型；从 processedMessage 中拆出来，便于一条消息广播成多种类型。
function broadcastThrottled(type, data) {
    // 非节流类型（如 unknown）直接广播。
    if (!THROTTLED_TYPES.has(type)) {
        broadcast(type, data)
        return
    }

    // 0 表示不限制服务端推送；前端实时页同时会关闭自动刷新。
    const interval = Number(REALTIME_REFRESH_INTERVAL)
    if (!Number.isFinite(interval) || interval <= 0) {
        broadcast(type, data)
        return
    }

    // 更新缓存中的最新数据
    throttleCache[type] = data

    // 如果该类型还没有定时器，启动一个
    if (!throttleTimers[type]) {
        throttleTimers[type] = setTimeout(() => {
            // 广播缓存中的最新数据
            if (throttleCache[type] !== undefined) {
                broadcast(type, throttleCache[type])
                delete throttleCache[type]
            }
            delete throttleTimers[type]
        }, interval)
    }
}

// 监听 MQTT 处理后的消息，先缓存最新数据，按节流间隔广播
mqttClient.on('processedMessage', (topic, data) => {
    const topics = MQTT_TOPICS

    // 传感器和行为主题被配置成同一个主题时，说明设备把两类字段放在一条消息里上报，
    // 两种前端实时页都要能收到推送，所以同一条数据要广播成两种类型。
    if (topics.sensor === topics.behavior && topic === topics.sensor) {
        broadcastThrottled('sensor_data', data)
        broadcastThrottled('behavior_data', data)
        return
    }

    const typeMap = {
        [topics.sensor]: 'sensor_data',
        [topics.behavior]: 'behavior_data',
    };
    const type = typeMap[topic] || 'unknown';
    broadcastThrottled(type, data)
})

// 导出 broadcast 函数，供其他模块使用（如控制器需要主动推送时）
app.set('wsBroadcast', broadcast);

// 新故障触发时立即广播（不走节流），前端收到后弹窗提示当前故障情况。
onFault((trigger) => {
    broadcast('fault_triggered', trigger);
});

// 安全联锁触发时立即广播（不走节流）。安全联锁触发时已经把水泵和加热强制关掉了，
// 是"已动作、通知用户知悉"的性质，不需要用户处理，所以前端用非阻塞通知展示
// （SafetyAlertNotifier.vue），不做成模态弹窗。
onSafetyInterlock((trigger) => {
    broadcast('safety_triggered', trigger);
});

// 自定义阈值告警规则（ALARM_RULES）触发时立即广播（不走节流）——这些规则可能比
// 硬故障触发得频繁得多，前端用非阻塞通知展示（AlarmNotifier.vue），不用像故障
// 弹窗那样打断操作、要求用户复位。
onAlarm((alarm) => {
    broadcast('alarm_triggered', alarm);
});

// PID 恒温控制想开加热但水泵没开，被拦下来时立即广播（不走节流）——性质跟自定义
// 阈值告警一样是"提示、不需要用户处理"，同样用 AlarmNotifier.vue 的非阻塞通知展示。
onHeaterBlocked((info) => {
    broadcast('pid_heater_blocked', info);
});

// ==================== 设备在线状态定时广播 ====================
// 每 2 秒广播一次所有设备的在线状态，接近实时
setInterval(() => {
    const deviceStatus = mqttClient.getAllDeviceStatus();
    broadcast('device_status', deviceStatus);
}, 2000);

// ==================== MQTT 重连诊断 ====================
// 监听 MQTT 重连失败事件，优雅降级
mqttClient.on('reconnect_failed', () => {
    console.warn('⚠️  MQTT 重连失败，已停止重连。WebSocket 仍可正常提供 API 服务。');
    console.warn('⚠️  当 MQTT Broker (Mosquitto) 启动后，可调用 /api/system-config 或重启后端恢复连接。');
});

// 检查 MQTT 初始连接状态
setTimeout(() => {
    if (mqttClient.isConnected) {
        console.log('✅ MQTT 连接成功！');
    } else if (!mqttClient._reconnectStopped) {
        console.warn('⚠️  MQTT 尚未连接，可能正在重连或 Broker 未运行');
    }
}, 5000);

// ==================== 服务启动初始化 ====================
// 启动安全联锁掉线监测（条件 6：传感器长时间无数据上报）。
startSafetyMonitor();

// 从数据库同步复位按钮的持久化状态到内存故障态，避免服务重启后内存被重置成
// NORMAL，但数据库里 reset_button 仍停留在重启前的 on，导致状态显示不一致、
// 复位开关卡死无法通过页面操作恢复。
initFaultStateFromDb();

// ==================== 进程级异常兜底 ====================
// 捕获未处理的同步异常和 Promise rejection，防止单次错误导致整个服务崩溃。
// 控制系统可用性优先：记录错误后不退出进程，让服务继续运行。
process.on('uncaughtException', (err) => {
  console.error('[FATAL] 未捕获异常:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED] 未处理的 Promise rejection:', reason);
});

server.listen(port, host, () => {
  console.log(`Server started: http://${host}:${port}`);
  console.log(`WebSocket server: ws://${host}:${port}/ws`);
});
