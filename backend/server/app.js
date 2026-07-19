const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
require('./config/env');
const sensorRoutes = require('./routes/sensorRoutes');
const systemConfig = require('./config/systemConfig');
const configController = require('./controllers/system/configController');
const mqttClient = require('./mqtt/index')
const app = express();
const port = Number(process.env.PORT) || 3000;
// PC 端默认仅监听本机，避免无认证的设备控制接口暴露到局域网/公网。
// 如确需局域网访问，显式设置 HOST，并同时配置严格的 CORS_ORIGINS。
const host = process.env.HOST || '127.0.0.1';
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173')
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
      
// Keep the API surface grouped behind a single router.
app.use('/', sensorRoutes);

// ==================== 系统配置 API ====================
// 全局配置中心，支持热更新、导出/导入
app.get('/api/system-config', configController.getConfig)
app.post('/api/system-config', configController.updateConfig)
app.post('/api/system-config/reset', configController.resetConfig)
app.get('/api/system-config/export', configController.exportConfig)
app.post('/api/system-config/import', configController.importConfig)

// MQTT 连接状态诊断接口
app.get('/api/mqtt/status', (req, res) => {
    res.json({
        success: true,
        data: {
            isConnected: mqttClient.isConnected,
            clientInitialized: !!mqttClient.client,
            url: mqttClient.config?.url || 'mqtt://localhost:1883'
        }
    })
});
        
const distPath = process.env.FRONTEND_DIST_PATH
  ? path.resolve(process.env.FRONTEND_DIST_PATH)
  : path.join(__dirname, '../../dist');
app.use(express.static(distPath));

app.get('/', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});
console.log('Dist Path:', distPath);

console.log('正在初始化 MQTT 连接...');
console.log('MQTT Broker URL:', process.env.MQTT_URL || 'mqtt://localhost:1883');

// ==================== WebSocket 服务器 ====================
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// 存储所有已连接的 WebSocket 客户端
const wsClients = new Set();

wss.on('connection', (ws, req) => {
    console.log(`[WebSocket] 客户端已连接, IP: ${req.socket.remoteAddress}`);
    wsClients.add(ws);

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

// ==================== 消息节流（Throttle） ====================
// 避免底层高频数据导致前端页面闪烁
// 传感器/行为/故障数据每 3 秒合并广播一次，设备状态每 2 秒广播一次

/** 节流缓存：{ type: latestData } */
const throttleCache = {}

/** 各消息类型的节流间隔（毫秒） */
const THROTTLE_INTERVALS = {
    'sensor_data': 3000,
    'behavior_data': 3000,
    'error_data': 3000,
}

/** 各消息类型的定时器 */
const throttleTimers = {}

// 监听 MQTT 处理后的消息，先缓存最新数据，按节流间隔广播
mqttClient.on('processedMessage', (topic, data) => {
    const topics = systemConfig.getConfig().MQTT_TOPICS
    const typeMap = {
        [topics.sensor]: 'sensor_data',
        [topics.behavior]: 'behavior_data',
        [topics.alarm]: 'error_data'
    };
    const type = typeMap[topic] || 'unknown';

    // 非节流类型（如 unknown）直接广播
    if (!THROTTLE_INTERVALS[type]) {
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
        }, THROTTLE_INTERVALS[type])
    }
})

// 导出 broadcast 函数，供其他模块使用（如控制器需要主动推送时）
app.set('wsBroadcast', broadcast);

// ==================== 设备在线状态定时广播 ====================
// 每 2 秒广播一次所有设备的在线状态，接近实时
setInterval(() => {
    const deviceStatus = mqttClient.getAllDeviceStatus();
    broadcast('device_status', deviceStatus);
}, 2000);

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

server.listen(port, host, () => {
  console.log(`Server started: http://${host}:${port}`);
  console.log(`WebSocket server: ws://${host}:${port}/ws`);
});
