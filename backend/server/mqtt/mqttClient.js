const mqtt = require('mqtt')
const EventEmitter = require('events')
const Joi = require('joi')
const promisePool = require('../config/promisepool')

class MqttClient extends EventEmitter {
    static defaultSetting = {
        url: 'mqtt://localhost:1883',
        option: {
            clientId: 'mqtt-client'
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
        this.client = null
        this.isConnected = false
        this.timer = {}
        this.initClient()
    }

    initClient() {
        this.client = mqtt.connect(this.config.url, this.config.option)
        this.bindClientEvents()
    }

    bindClientEvents() {
        this.client.on('connect', () => {
            this.isConnected = true
            console.log('MQTT connected')
            this.subscribeAllTopics()
        })

        this.client.on('error', (err) => {
            console.error('MQTT connection error:', err.message)
        })

        this.client.on('offline', () => {
            this.isConnected = false
            console.log('MQTT client offline')
        })

        this.client.on('close', () => {
            this.isConnected = false
        })

        this.client.on('reconnect', () => {
            console.log('MQTT reconnecting...')
        })

        this.client.on('message', (topic, payload) => {
            let info
            try {
                info = JSON.parse(payload.toString())
            } catch (err) {
                console.error('MQTT message parse failed:', err)
                return
            }

            if (topic === 'SensorData/add') {
                info.c_time = new Date()
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
                const { error } = schema.validate(info)
                if (error) {
                    console.log(error)
                } else {
                    console.log(info)
                    this.emit('message', topic, info)
                    this.SaveSensorData(info)
                }
            }

            if (topic === 'BehaviorData/add') {
                info.c_time = new Date()
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
                const { error } = schema.validate(info)
                if (error) {
                    console.log(error)
                } else {
                    console.log(info)
                    this.emit('message', topic, info)
                    this.SaveBehaviorData(info)
                }
            }

            if (topic === 'ErrorData/add') {
                info.c_time = new Date()
                const schema = Joi.object({
                    id: Joi.number().required(),
                    d_no: Joi.string().required(),
                    e_msg: Joi.string().required(),
                    e_no: Joi.string(),
                    type: Joi.string(),
                    c_time: Joi.date().required()
                })
                const { error } = schema.validate(info)
                if (error) {
                    console.log(error)
                } else {
                    console.log(info)
                    this.emit('message', topic, info)
                    this.SaveErrorData(info)
                }
            }

            if (topic.startsWith('isAlive')) {
                const id = topic.split('/').pop()
                clearTimeout(this.timer[id])
                delete this.timer[id]
                console.log(`${id} device is alive`)
            }
        })
    }

    subscribeAllTopics() {
        const topics = this.config.subscribeTopics.reduce((acc, item) => {
            acc[item.topic] = { qos: item.qos }
            return acc
        }, {})

        this.client.subscribe(topics, (err) => {
            if (err) {
                console.error('MQTT subscribe failed:', err.message)
            } else {
                console.log('MQTT subscribe success')
            }
        })
    }

    publishJson(topic, payload, options = {}) {
        // 统一把对象转成 JSON 后发布，避免各业务重复序列化。
        return this.publish(topic, JSON.stringify(payload), options)
    }

    waitUntilConnected(timeout = 5000) {
        if (this.client && this.isConnected) {
            return Promise.resolve()
        }

        return new Promise((resolve, reject) => {
            if (!this.client) {
                reject(new Error('MQTT client is not initialized'))
                return
            }

            const cleanup = () => {
                clearTimeout(timer)
                this.client.off('connect', handleConnect)
                this.client.off('error', handleError)
            }

            const handleConnect = () => {
                cleanup()
                resolve()
            }

            const handleError = (err) => {
                cleanup()
                reject(err)
            }

            const timer = setTimeout(() => {
                cleanup()
                reject(new Error('MQTT client connect timeout'))
            }, timeout)

            this.client.once('connect', handleConnect)
            this.client.once('error', handleError)
        })
    }

    async publish(topic, payload, options = {}) {
        // 发布前先等 MQTT 连接成功，避免页面刚保存时消息丢失。
        await this.waitUntilConnected()

        return new Promise((resolve, reject) => {
            this.client.publish(topic, payload, options, (err) => {
                if (err) {
                    reject(err)
                    return
                }

                resolve({ topic, payload })
            })
        })
    }

    async SaveSensorData(info) {
        const params = [info.id, info.d_no, info.field1, info.field2, info.field3, info.field4, info.field5, info.c_time, info.online]
        try {
            await promisePool.execute(
                `insert into t_sensor_data values(?,?,?,?,?,?,?,?,?)`,
                params
            )
        } catch (err) {
            console.log(err)
        }
    }

    async SaveBehaviorData(info) {
        const params = [
            info.id,
            info.d_no,
            info.field1,
            info.field2,
            info.field3,
            info.field4,
            info.field5,
            info.field6 ?? null,
            info.field7 ?? null,
            info.field8 ?? null,
            info.field9 ?? null,
            info.field10 ?? null,
            info.c_time,
            info.online
        ]

        try {
            await promisePool.execute(
                `insert into t_behavior_data values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                params
            )
        } catch (err) {
            console.error('Save behavior data failed:', err.message)
        }
    }

    async SaveErrorData(info) {
        const params = [info.id, info.d_no, info.c_time, info.e_msg, info.e_no, info.type]
        try {
            await promisePool.execute(`insert into t_error_msg values(?,?,?,?,?,?)`, params)
        } catch (err) {
            console.log(err)
        }
    }

    checkIfAlive(id) {
        setInterval(() => {
            this.client.publish(`checkIfAlive/${id}`, `${Date.now()} check alive`, { qos: 1, retain: false }, err => {
                if (err) {
                    console.error('Check alive publish failed:', err.message)
                }
            })

            if (this.timer[id]) clearTimeout(this.timer[id])
            this.timer[id] = setTimeout(() => {
                console.log('Device heartbeat timeout')
            }, 3000)
        }, 10000)
    }
}

module.exports = MqttClient
