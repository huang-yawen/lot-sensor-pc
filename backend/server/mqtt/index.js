require('../config/env')
const MqttClient = require('./mqttClient')

// 集中创建 MQTT 客户端，业务模块通过这个单例发布指令或接收上报。
const client = new MqttClient({
  url: process.env.MQTT_URL || 'mqtt://localhost:1883',
  option: {
    clientId: process.env.MQTT_CLIENT_ID || 'lot-sensor-pc',
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD
  },
  subscribeTopics: [
    // 心跳、传感器、行为和故障上报统一在 mqttClient 内解析分发。
    { topic: 'testTopic/1', qos: 1 },
    { topic: 'isAlive/#', qos: 1 },
    { topic: 'SensorData/#', qos: 1 }, 
    { topic: 'BehaviorData/#', qos: 1 }, 
    { topic: 'ErrorData/#', qos: 1 }
  ]
})
client.on('message', (topic, info) => {
  console.log('MQTT message received:', topic, info)
})
client.checkIfAlive(1);
module.exports = client
