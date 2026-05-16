const mqtt = require('mqtt')
const EventEmitter = require('events')
const Joi = require('joi')
const promisePool = require('../config/promisepool')
class MqttClient extends EventEmitter {
    static defaultSetting = {
        url: 'mqtt://localhost:1883',
        option: {
            clientId: "猜猜我是谁"
        },
        subscribeTopics: [
            { topic: 'testTopic/#', qos: 1 },
            { topic: '/isAlive/#', qos: 1 }
        ]
    }
    constructor(config = {}) {
        super()
        this.config = {
            url: config.url || MqttClient.defaultSetting.url,
            option: { ...MqttClient.defaultSetting.option, ...config.option },
            subscribeTopics: config.subscribeTopics || MqttClient.defaultSetting.subscribeTopics
        }
        //url/subscribetopic是二选一的，但是option是多种都需要一起实现的
        this.client = null
        this.isConnected = false
        this.initClient();
        this.timer = {}
    }
    initClient() {
        this.client = mqtt.connect(this.config.url, this.config.option)
        this.bindClientEvents()
    }
    bindClientEvents() {
        this.client.on('connect', () => {
            console.log('连接成功啦')
            this.subscribeAllTopics()
        })

        this.client.on('error', (err) => {
            console.error('连接错误：', err.message)
        })

        this.client.on('offline', () => {
            console.log('客户端离线')
        })

        this.client.on('reconnect', () => {
            console.log('正在重连...')
        })

        this.client.on('message', (topic, payload) => {
            let info
            try {
                //payroad原本是二进制，需要toString才能够转换成看得懂的字符串
                info = JSON.parse(payload.toString())
            } catch (err) {
                if (err) console.error('消息解析失败：', err)
            }

            //传感器数据接受
            if (topic === 'SensorData/add') {
                info.c_time = new Date();
                const schema = Joi.object({
                    id: Joi.number().required(),
                    d_no: Joi.number().required(),
                    field1: Joi.number().required(),
                    field2: Joi.number().required(),
                    field3: Joi.number().required(),
                    field4: Joi.number().required(),
                    field5: Joi.number().required(),
                    online: Joi.string().required(),
                    c_time: Joi.date().required()
                })
                const { value, error } = schema.validate(info)
                if (error) console.log(error)
                else {
                    console.log(info)
                    this.emit('message', topic, info)
                    this.SaveSensorData(info)
                }
            }

            //行为数据接受
            if (topic === 'BehaviorData/add') {
                info.c_time = new Date();

                const schema = Joi.object({
                    id: Joi.number().required(),
                    d_no: Joi.number().required(),
                    field1: Joi.number().required(),
                    field2: Joi.number().required(),
                    field3: Joi.number().required(),
                    field4: Joi.number().required(),
                    field5: Joi.number().required(),
                    field6: Joi.number(),
                    field7: Joi.number(),
                    field8: Joi.number(),
                    field9: Joi.number(),
                    field10: Joi.number(),
                    online: Joi.string().required(),
                    c_time: Joi.date().required()
                })
                const { value, error } = schema.validate(info)
                if (error) console.log(error)
                else {
                    console.log(info)
                    this.emit('message', topic, info)
                    this.SaveBehaviorData(info)
                }
            }
            
            //错误数据接受
            if (topic === "ErrorData/add") {
                info.c_time = new Date();
                const schema = Joi.object({
                    id: Joi.number().required(),
                    d_no: Joi.string().required(),
                    e_msg: Joi.string().required(),
                    e_no: Joi.string(),
                    type: Joi.string(),
                    c_time: Joi.date().required()
                })
                const { value, error } = schema.validate(info)
                if (error) console.log(error)
                else {
                    console.log(info)
                    this.emit('message', topic, info)
                    this.SaveErrorData(info)
                }
            }
     
            //底层设备的反馈
            if (topic.startsWith('isAlive')) {
                const id = topic.split("/").pop()
                clearTimeout(this.timer[id])
                delete this.timer[id]
                console.log(`${id}号设备是活着的！`)
            }
        })
    }

    subscribeAllTopics() {
        const { config, client } = this
        const topics = config.subscribeTopics.reduce((acc, item) => {
            acc[item.topic] = { qos: item.qos }
            return acc
        }, {})
        client.subscribe(topics, (err) => {
            if (err) {
                console.error('批量导入失败：', err.message)
            } else {
                console.log("批量导入成功啦")
            }
        })
    }
    async SaveSensorData(info) {
        const params = [info.id, info.d_no, info.field1, info.field2, info.field3, info.field4, info.field5, info.c_time, info.online]
        try {
            await promisePool.execute(`insert into t_sensor_data 
            values(?,?,?,?,?,?,?,?,?)`, params)
        } catch (err) {
            if (err) console.log(err)
        }
    }

    async SaveBehaviorData(info) {
        const params = [
            info.id,
            info.d_no,
            info.field1, info.field2, info.field3, info.field4, info.field5,
            // 如果 info.field6 不存在，则赋值为 null
            info.field6 ?? null,
            info.field7 ?? null,
            info.field8 ?? null,
            info.field9 ?? null,
            info.field10 ?? null,
            info.c_time,
            info.online
        ];

        try {
            await promisePool.execute(
                `insert into t_behavior_data values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                params
            );
        } catch (err) {
            console.error("写入失败：", err.message);
        }
    }

    async SaveErrorData(info) {
        const params = [info.id, info.d_no, info.c_time, info.e_msg, info.e_no, info.type]
        try {
            await promisePool.execute(`insert into t_error_msg values(?,?,?,?,?,?)`, params)
        } catch (err) {
            if (err) console.log(err)
        }
    }

    checkIfAlive(id) {
        setInterval(() => {
            this.client.publish(`checkIfAlive/${id}`, `${Date.now()}检查是否存活`, { qos: 1, retain: false }, err => {
                if (err) {
                    console.error("检查消息发送失败", err.message);
                }
            })
            if (this.timer[id]) clearTimeout(this.timer[id]);
            this.timer[id] = setTimeout(() => {
                console.log("对方已经失联")
            }, 3000)
        }, 10000)//心脏跳动的频率为10s,如果3秒内没收到回复，就算对方失联
    }
}

module.exports = MqttClient