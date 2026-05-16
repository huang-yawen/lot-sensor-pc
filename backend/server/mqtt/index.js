const MqttClient = require('./mqttClient')
const client = new MqttClient({
  url: 'mqtt://localhost:1883',
  option: {
    clientId: '测试名称1',
    username: 'admin',
    password: '12345678a'
  },
  subscribeTopics: [
    { topic: 'testTopic/1', qos: 1 },
    { topic: 'isAlive/#', qos: 1 },
    { topic: 'SensorData/#', qos: 1 }, 
    { topic: 'BehaviorData/#', qos: 1 }, 
    { topic: 'ErrorData/#', qos: 1 }
  ]
})
client.on('message', (topic, info) => {
  console.log('收到消息,业务层面：', topic, info)
})
client.checkIfAlive(1);
module.exports = client