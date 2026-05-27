const express = require('express');
const cors = require('cors');
const path = require('path');
require('./config/env');
const sensorRoutes = require('./routes/sensor');
const mqttClient = require('./mqtt/index')
const app = express();
const port = Number(process.env.PORT) || 3000;
app.use(cors());
app.use(express.json());
     
app.use('/', sensorRoutes);

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

// 检查 MQTT 初始连接状态
setTimeout(() => {
    if (mqttClient.isConnected) {
        console.log('✅ MQTT 连接成功！');
    } else {
        console.warn('⚠️  MQTT 尚未连接，可能正在重连或 Broker 未运行');
    }
}, 2000);

app.listen(port, () => {
  console.log(`Server started: http://localhost:${port}`);
});
