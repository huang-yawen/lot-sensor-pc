# IoT 传感器应用 - 后端服务使用指南

## 📋 目录

1. [项目概述](#1-项目概述)
2. [环境要求](#2-环境要求)
3. [快速开始](#3-快速开始)
4. [项目结构](#4-项目结构)
5. [配置文件说明](#5-配置文件说明)
6. [数据库表结构](#6-数据库表结构)
7. [API 接口文档](#7-api-接口文档)
8. [MQTT 消息协议](#8-mqtt-消息协议)
9. [WebSocket 实时推送](#9-websocket-实时推送)
10. [核心模块详解](#10-核心模块详解)
11. [开发指南](#11-开发指南)
12. [常见问题](#12-常见问题)

---

## 1. 项目概述

本后端服务是一个 **IoT 传感器数据采集与管理平台**，提供以下核心功能：

- **MQTT 数据采集**：接收传感器设备通过 MQTT 协议上报的实时数据
- **数据持久化**：将传感器数据、行为数据、异常状态数据存入 MySQL 数据库
- **RESTful API**：提供设备管理、数据查询、指令配置等 HTTP 接口
- **WebSocket 实时推送**：将 MQTT 收到的数据实时推送到前端客户端
- **设备管理**：设备的增删改查及在线状态管理
- **指令下发**：支持向设备下发配置指令（支持暂存指令，设备上线后自动下发）

### 技术栈

| 组件 | 技术 |
|------|------|
| 运行环境 | Node.js |
| Web 框架 | Express |
| 数据库 | MySQL |
| MQTT 客户端 | mqtt.js |
| WebSocket | ws |
| 连接池 | mysql2/promise |

---

## 2. 环境要求

- **Node.js** >= 14.x
- **MySQL** >= 5.7
- **MQTT Broker**（如 Mosquitto）>= 1.6
- **npm** >= 6.x

### 推荐环境

- Node.js 18.x LTS
- MySQL 8.0
- Mosquitto 2.x

---

## 3. 快速开始

### 3.1 安装依赖

```bash
cd server
npm install
```

### 3.2 配置环境变量

复制 `.env.example` 为 `.env` 并根据实际情况修改：

```bash
cp .env.example .env
```

### 3.3 初始化数据库

执行 SQL 脚本创建数据库和表：

```bash
mysql -u root -p < wusiqi.sql
```

### 3.4 启动服务

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm start

# 或直接使用 Node
node app.js
```

启动成功后，控制台输出：

```
Server started: http://localhost:3000
WebSocket server: ws://localhost:3000/ws
✅ 数据库连接成功
✅ MQTT 连接成功！
```

---

## 4. 项目结构

```
server/
├── app.js                          # 应用入口（Express + WebSocket）
├── package.json                    # 依赖配置
├── .env                            # 环境变量（不提交到 Git）
├── .env.example                    # 环境变量模板
├── wusiqi.sql                      # 数据库初始化脚本
│
├── config/                         # 配置文件
│   ├── env.js                      # 环境变量加载
│   └── dbPool.js                   # MySQL 连接池
│
├── controllers/                    # 控制器层（处理 HTTP 请求）
│   ├── sensor/
│   │   ├── getDashboardData.js     # 获取传感器仪表盘数据
│   │   └── historyData.js          # 获取历史数据（按类型）
│   ├── device/
│   │   ├── deviceManageList.js     # 获取设备管理列表
│   │   ├── addDevice.js            # 添加设备
│   │   ├── deleteDevice.js         # 删除设备
│   │   └── updateDevice.js         # 更新设备
│   ├── error/
│   │   ├── errorHistory.js         # 获取故障历史
│   │   └── errorTypeStats.js       # 获取故障类型统计
│   └── direct/
│       ├── directConfigTree.js     # 获取指令配置树
│       └── directConfigRender.js   # 获取指令配置渲染数据
│
├── service/                        # 服务层（业务逻辑）
│   ├── deviceData/
│   │   ├── getDeviceManageList.js  # 查询设备列表
│   │   ├── addDeviceManageData.js  # 添加设备数据
│   │   ├── deleteDeviceManageData.js # 删除设备数据
│   │   └── updateDeviceManageData.js # 更新设备数据
│   ├── directData/
│   │   ├── getDirectConfigTree.js  # 获取指令配置树
│   │   ├── saveDirectConfig.js     # 保存指令配置
│   │   ├── updateDirectConfigAndPublish.js # 更新配置并发布 MQTT
│   │   └── updateMultipleDirectConfigs.js  # 批量更新配置
│   ├── errorHistory/
│   │   ├── getErrorHistory.js      # 查询故障历史
│   │   └── getErrorTypeStats.js    # 查询故障类型统计
│   └── historyData/
│       └── getHistoryDataByType.js # 按类型查询历史数据
│
├── routes/                         # 路由配置
│   └── sensorRoutes.js             # 所有 API 路由
│
├── middleware/                      # 中间件（预留）
│
├── mqtt/                           # MQTT 模块
│   ├── index.js                    # MQTT 模块入口
│   ├── mqttClient.js               # MQTT 客户端封装
│   ├── messageRouter.js            # 消息路由器
│   ├── deviceManager.js            # 设备管理器（心跳、在线状态、暂存指令）
│   ├── sensorRealtime/             # 传感器实时数据处理
│   │   ├── sensorRealtimeHandler.js  # 处理器
│   │   └── sensorRealtimeRepository.js # 数据库操作
│   ├── behaviorRealtime/           # 行为实时数据处理
│   │   ├── behaviorRealtimeHandler.js # 处理器
│   │   └── behaviorRealtimeRepository.js # 数据库操作
│   ├── errorHistory/               # 异常状态数据处理
│   │   ├── errorHistoryHandler.js    # 处理器
│   │   └── errorHistoryRepository.js # 数据库操作
│   └── handlers/                   # 备用处理器（未启用）
│       ├── sensorHandler.js
│       ├── behaviorHandler.js
│       └── abnormalStateHandler.js
│
├── utils/                          # 工具函数
│   └── helper.js                   # 辅助函数
│
├── init/                           # 初始化脚本
│   └── init_calibrate_time.sql     # 校准时间初始化 SQL
│
└── .backend-err.log                # 错误日志文件
```

---

## 5. 配置文件说明

### 5.1 环境变量（.env）

```env
# 服务器端口
PORT=3000

# 数据库配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=123456
DB_NAME=third

# MQTT Broker 配置
MQTT_URL=mqtt://localhost:1883
MQTT_USERNAME=
MQTT_PASSWORD=

# 前端静态文件路径（可选，用于生产环境部署）
FRONTEND_DIST_PATH=D:/HUYa的桌面/LOT/dist
```

### 5.2 数据库连接池（config/dbPool.js）

使用 `mysql2/promise` 连接池，默认配置：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| host | `DB_HOST` | 数据库主机 |
| port | `DB_PORT` | 数据库端口 |
| user | `DB_USER` | 数据库用户 |
| password | `DB_PASSWORD` | 数据库密码 |
| database | `DB_NAME` | 数据库名 |
| waitForConnections | `true` | 等待连接 |
| connectionLimit | `10` | 最大连接数 |
| queueLimit | `0` | 队列限制（0=不限制） |

---

## 6. 数据库表结构

### 6.1 t_sensor_data - 传感器数据表

存储传感器上报的实时数据。

```sql
CREATE TABLE t_sensor_data (
  id          INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
  d_no        VARCHAR(64)   COMMENT '设备编号',
  field1      VARCHAR(255)  COMMENT '水温1（t1）',
  field2      VARCHAR(255)  COMMENT '水温2（t2）',
  field3      VARCHAR(255)  COMMENT '水质1（tds1）',
  field4      VARCHAR(255)  COMMENT '水质2（tds2）',
  field5      VARCHAR(255)  COMMENT '备用字段5',
  field6      VARCHAR(255)  COMMENT '备用字段6',
  field7      VARCHAR(255)  COMMENT '备用字段7',
  field8      VARCHAR(255)  COMMENT '备用字段8',
  field9      VARCHAR(255)  COMMENT '备用字段9',
  field10     VARCHAR(255)  COMMENT '备用字段10',
  c_time      DATETIME      COMMENT '采集时间',
  online      VARCHAR(4)    COMMENT '在线状态（实时数据/保留数据）',
  pid         VARCHAR(20)   COMMENT 'PID 参数',
  pid2        VARCHAR(20)   COMMENT 'PID2 参数'
);
```

**字段映射关系**（通过 `t_sensor_field_mapper` 表定义）：

| 物理字段 | 协议字段(p_name) | 显示名称(f_name) |
|----------|-----------------|-----------------|
| field1   | t1              | 水温            |
| field2   | t2              | 水温2           |
| field3   | tds1            | 水质1           |
| field4   | tds2            | 水质2           |

### 6.2 t_behavior_data - 行为数据表

存储设备行为/状态数据。

```sql
CREATE TABLE t_behavior_data (
  id          INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
  d_no        VARCHAR(64)   COMMENT '设备编号',
  field1      VARCHAR(255)  COMMENT '模式（mode）',
  field2      VARCHAR(255)  COMMENT '风机（fan）',
  field3      VARCHAR(255)  COMMENT '风机转速（fan_speed）',
  field4      VARCHAR(255)  COMMENT '空调（air）',
  field5      VARCHAR(255)  COMMENT '空调模式（acmode）',
  field6      VARCHAR(255)  COMMENT '空调功率（air_power）',
  field7      VARCHAR(255)  COMMENT 'LED（led）',
  field8      VARCHAR(255)  COMMENT 'LED功率（led_power）',
  field9      VARCHAR(255)  COMMENT '备用字段9',
  field10     VARCHAR(255)  COMMENT '备用字段10',
  c_time      DATETIME      COMMENT '采集时间',
  online      VARCHAR(4)    COMMENT '在线状态'
);
```

**字段映射关系**（通过 `t_behavior_field_mapper` 表定义）：

| 物理字段 | 协议字段(p_name) | 显示名称(f_name) |
|----------|-----------------|-----------------|
| field1   | mode            | 模式            |
| field2   | fan             | 风机            |
| field3   | fan_speed       | 风机转速        |
| field4   | air             | 空调            |
| field5   | acmode          | 空调模式        |
| field6   | air_power       | 空调功率        |
| field7   | led             | LED             |
| field8   | led_power       | LED功率         |

### 6.3 t_error_msg - 故障消息表

存储设备上报的异常/故障信息。

```sql
CREATE TABLE t_error_msg (
  id      INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
  d_no    VARCHAR(16)   COMMENT '设备编号',
  c_time  DATETIME      COMMENT '发生时间',
  e_msg   VARCHAR(255)  COMMENT '故障描述',
  e_no    VARCHAR(255)  COMMENT '故障编号',
  type    VARCHAR(15)   COMMENT '故障类型'
);
```

**故障类型定义**：

| 协议字段 | 标签 | 说明 |
|----------|------|------|
| humi_warn | 湿度 | 湿度异常 |
| smog_warn | 烟雾 | 烟雾异常 |
| fan_warn | 风机 | 风机异常 |
| air_warn | 空调 | 空调异常 |
| outage_overtime | 电源 | 电源异常 |

### 6.4 t_device - 设备表

```sql
CREATE TABLE t_device (
  id        INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
  d_no      VARCHAR(64)   COMMENT '设备编号',
  d_name    VARCHAR(255)  COMMENT '设备名称',
  d_type    VARCHAR(255)  COMMENT '设备类型',
  d_addr    VARCHAR(255)  COMMENT '设备地址',
  d_phone   VARCHAR(255)  COMMENT '联系电话',
  d_other   VARCHAR(255)  COMMENT '其他信息',
  c_time    DATETIME      COMMENT '创建时间'
);
```

### 6.5 t_direct - 指令配置表

```sql
CREATE TABLE t_direct (
  id        INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
  d_no      VARCHAR(64)   COMMENT '设备编号',
  d_name    VARCHAR(255)  COMMENT '指令名称',
  d_type    VARCHAR(255)  COMMENT '指令类型',
  d_value   VARCHAR(255)  COMMENT '指令值',
  d_other   VARCHAR(255)  COMMENT '其他信息',
  c_time    DATETIME      COMMENT '创建时间'
);
```

### 6.6 t_direct_config - 指令配置详情表

```sql
CREATE TABLE t_direct_config (
  id          INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
  d_no        VARCHAR(64)   COMMENT '设备编号',
  config_id   VARCHAR(64)   COMMENT '配置项ID',
  config_name VARCHAR(255)  COMMENT '配置项名称',
  config_value VARCHAR(255) COMMENT '配置项值',
  config_type VARCHAR(255)  COMMENT '配置项类型',
  c_time      DATETIME      COMMENT '创建时间'
);
```

### 6.7 t_sensor_field_mapper - 传感器字段映射表

```sql
CREATE TABLE t_sensor_field_mapper (
  id      INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
  p_name  VARCHAR(64)   COMMENT '协议字段名',
  db_name VARCHAR(64)   COMMENT '数据库字段名',
  f_name  VARCHAR(64)   COMMENT '显示名称'
);
```

### 6.8 t_behavior_field_mapper - 行为字段映射表

```sql
CREATE TABLE t_behavior_field_mapper (
  id      INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
  p_name  VARCHAR(64)   COMMENT '协议字段名',
  db_name VARCHAR(64)   COMMENT '数据库字段名',
  f_name  VARCHAR(64)   COMMENT '显示名称'
);
```

---

## 7. API 接口文档

所有 API 接口统一挂载在根路径 `/` 下（注意：**不是** `/api` 前缀）。

### 7.1 传感器数据

#### GET /data - 获取传感器仪表盘数据

获取最新的传感器数据，用于仪表盘展示。

**响应示例：**

```json
{
  "success": true,
  "data": {
    "sensorData": {
      "d_no": "202106",
      "field1": "25.5",
      "field2": "26.0",
      "field3": "150",
      "field4": "160",
      "c_time": "2024-01-15T10:30:00.000Z",
      "online": "实时数据"
    },
    "fieldMappers": [
      { "p_name": "t1", "db_name": "field1", "f_name": "水温" },
      { "p_name": "t2", "db_name": "field2", "f_name": "水温2" },
      { "p_name": "tds1", "db_name": "field3", "f_name": "水质1" },
      { "p_name": "tds2", "db_name": "field4", "f_name": "水质2" }
    ]
  }
}
```

#### GET /dataByType - 获取历史数据（按类型）

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 是 | 数据类型：`sensor` 或 `behavior` |
| page | number | 否 | 页码，默认 1 |
| pageSize | number | 否 | 每页条数，默认 20 |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "list": [
      {
        "id": 1,
        "d_no": "202106",
        "field1": "25.5",
        "c_time": "2024-01-15T10:30:00.000Z"
      }
    ],
    "total": 100,
    "page": 1,
    "pageSize": 20
  }
}
```

### 7.2 设备管理

#### GET /deviceData - 获取设备管理列表

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认 1 |
| pageSize | number | 否 | 每页条数，默认 10 |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "list": [
      {
        "id": 1,
        "d_no": "202106",
        "d_name": "传感器设备1",
        "d_type": "温度传感器",
        "d_addr": "A区1号",
        "d_phone": "13800138000",
        "c_time": "2024-01-15T10:30:00.000Z"
      }
    ],
    "total": 50,
    "page": 1,
    "pageSize": 10
  }
}
```

#### POST /deviceData/add - 添加设备

**请求体：**

```json
{
  "d_no": "202107",
  "d_name": "新设备",
  "d_type": "温度传感器",
  "d_addr": "A区2号",
  "d_phone": "13900139000"
}
```

**响应：**

```json
{
  "success": true,
  "message": "设备添加成功"
}
```

#### POST /deviceData/delete - 删除设备

**请求体：**

```json
{
  "d_no": "202107"
}
```

**响应：**

```json
{
  "success": true,
  "message": "设备删除成功"
}
```

#### POST /deviceData/update - 更新设备

**请求体：**

```json
{
  "d_no": "202106",
  "d_name": "更新后的名称",
  "d_type": "湿度传感器",
  "d_addr": "B区1号",
  "d_phone": "13700137000"
}
```

**响应：**

```json
{
  "success": true,
  "message": "设备更新成功"
}
```

### 7.3 故障管理

#### GET /errData - 获取故障历史

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认 1 |
| pageSize | number | 否 | 每页条数，默认 20 |
| type | string | 否 | 故障类型筛选 |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "list": [
      {
        "id": 1,
        "d_no": "202106",
        "c_time": "2024-01-15T10:30:00.000Z",
        "e_msg": "湿度异常，烟雾正常，风机正常，空调正常，电源正常",
        "e_no": "ERR001",
        "type": "湿度异常"
      }
    ],
    "total": 30,
    "page": 1,
    "pageSize": 20
  }
}
```

#### GET /errTypeStats - 获取故障类型统计

**响应示例：**

```json
{
  "success": true,
  "data": [
    { "type": "湿度异常", "count": 10 },
    { "type": "烟雾异常", "count": 5 },
    { "type": "风机异常", "count": 3 },
    { "type": "空调异常", "count": 7 },
    { "type": "电源异常", "count": 2 }
  ]
}
```

### 7.4 指令配置

#### GET /directData - 获取指令配置树

获取所有设备的指令配置，以树形结构返回。

**响应示例：**

```json
{
  "success": true,
  "data": [
    {
      "d_no": "202106",
      "d_name": "设备1",
      "configs": [
        {
          "config_id": "temp_threshold",
          "config_name": "温度阈值",
          "config_value": "30",
          "config_type": "number"
        }
      ]
    }
  ]
}
```

#### GET /directRender - 获取指令配置渲染数据

获取指令配置的渲染数据（用于前端动态渲染配置表单）。

**响应示例：**

```json
{
  "success": true,
  "data": [
    {
      "config_id": "temp_threshold",
      "config_name": "温度阈值",
      "config_value": "30",
      "config_type": "number"
    }
  ]
}
```

#### POST /directData/update - 更新指令配置并发布 MQTT

更新指定设备的指令配置，并通过 MQTT 发布到设备。

**请求体：**

```json
{
  "d_no": "202106",
  "config_id": "temp_threshold",
  "config_value": "35"
}
```

**响应：**

```json
{
  "success": true,
  "message": "配置更新成功，已发布到设备"
}
```

**MQTT 发布流程：**
1. 更新数据库中的配置值
2. 构建 MQTT 消息（JSON 格式）
3. 发布到主题 `direct_data`（QoS 1）
4. **发布两次**（确保设备收到）
5. 将指令添加到设备的暂存队列（设备离线时，上线后自动下发）

#### POST /multipleDirectData - 批量更新指令配置

**请求体：**

```json
{
  "d_no": "202106",
  "configs": [
    { "config_id": "temp_threshold", "config_value": "35" },
    { "config_id": "humi_threshold", "config_value": "80" }
  ]
}
```

**响应：**

```json
{
  "success": true,
  "message": "批量配置更新成功"
}
```

### 7.5 系统状态

#### GET /mqtt/status - 获取 MQTT 连接状态

**响应示例：**

```json
{
  "success": true,
  "data": {
    "isConnected": true,
    "clientInitialized": true,
    "url": "mqtt://localhost:1883"
  }
}
```

---

## 8. MQTT 消息协议

### 8.1 订阅主题

服务启动时会自动订阅以下主题：

| 主题 | QoS | 说明 |
|------|-----|------|
| `sensor_data` | 1 | 传感器数据上报 |
| `behavioral_data` | 1 | 行为数据上报 |
| `abnormal_state` | 1 | 异常状态上报 |
| `heart_beat` | 1 | 设备心跳 |

### 8.2 发布主题

| 主题 | QoS | 说明 |
|------|-----|------|
| `direct_data` | 1 | 指令下发到设备 |

### 8.3 消息格式

#### 传感器数据（sensor_data）

```json
{
  "VID": "202106",
  "PID": "P001",
  "Tin": "25.5",
  "Tout": "26.0",
  "LXin": "150",
  "Time": "2024-01-15 10:30:00",
  "online": "1"
}
```

**字段说明：**

| 字段 | 映射到数据库 | 说明 |
|------|-------------|------|
| VID | d_no | 设备编号 |
| PID | pid | PID 参数 |
| Tin | field1 | 水温1 |
| Tout | field2 | 水温2 |
| LXin | field3 | 水质1 |
| Time | c_time | 采集时间 |
| online | online | 在线状态（1=实时数据，其他=保留数据） |

#### 行为数据（behavioral_data）

```json
{
  "mode": "auto",
  "fan": "on",
  "fan_speed": "3",
  "air": "on",
  "acmode": "cool",
  "air_power": "1000",
  "led": "on",
  "led_power": "50",
  "Time": "2024-01-15 10:30:00",
  "online": "1"
}
```

**字段说明：**

| 字段 | 映射到数据库 | 说明 |
|------|-------------|------|
| mode | field1 | 模式 |
| fan | field2 | 风机状态 |
| fan_speed | field3 | 风机转速 |
| air | field4 | 空调状态 |
| acmode | field5 | 空调模式 |
| air_power | field6 | 空调功率 |
| led | field7 | LED 状态 |
| led_power | field8 | LED 功率 |
| Time | c_time | 采集时间 |
| online | online | 在线状态 |

> **注意**：行为数据的 `d_no` 目前硬编码为 `'202106'`，因为当前只有一套设备。

#### 异常状态数据（abnormal_state）

```json
{
  "humi_warn": 1,
  "smog_warn": 0,
  "fan_warn": 0,
  "air_warn": 1,
  "outage_overtime": 0,
  "Time": "2024-01-15 10:30:00",
  "e_no": "ERR001",
  "online": "1"
}
```

**字段说明：**

| 字段 | 说明 |
|------|------|
| humi_warn | 湿度告警（1=异常，0=正常） |
| smog_warn | 烟雾告警 |
| fan_warn | 风机告警 |
| air_warn | 空调告警 |
| outage_overtime | 电源告警 |
| Time | 发生时间 |
| e_no | 故障编号 |

**自动生成的字段：**
- `type`：根据告警字段自动拼接，如 `"湿度异常,空调异常"`
- `e_msg`：生成详细描述，如 `"湿度异常，烟雾正常，风机正常，空调异常，电源正常"`

> **注意**：异常数据的 `d_no` 目前硬编码为 `'202177'`。

#### 心跳数据（heart_beat）

心跳消息为纯文本格式，内容为设备编号：

```
202106
```

### 8.4 指令下发格式（direct_data）

```json
{
  "d_no": "202106",
  "config_id": "temp_threshold",
  "config_value": "35"
}
```

---

## 9. WebSocket 实时推送

### 9.1 连接地址

```
ws://localhost:3000/ws
```

### 9.2 消息格式

服务端推送的消息格式：

```json
{
  "type": "sensor_data",
  "payload": { ... },
  "timestamp": 1705300000000
}
```

**消息类型（type）：**

| type 值 | 说明 |
|---------|------|
| sensor_data | 传感器实时数据 |
| behavior_data | 行为实时数据 |
| error_data | 异常状态数据 |

### 9.3 客户端心跳

客户端应定期发送心跳以保持连接：

```json
{ "type": "ping" }
```

服务端回复：

```json
{ "type": "pong" }
```

### 9.4 前端使用示例

```javascript
const ws = new WebSocket('ws://localhost:3000/ws')

ws.onopen = () => {
  console.log('WebSocket 已连接')
  // 启动心跳
  setInterval(() => {
    ws.send(JSON.stringify({ type: 'ping' }))
  }, 30000)
}

ws.onmessage = (event) => {
  const { type, payload, timestamp } = JSON.parse(event.data)
  switch (type) {
    case 'sensor_data':
      updateSensorDisplay(payload)
      break
    case 'behavior_data':
      updateBehaviorDisplay(payload)
      break
    case 'error_data':
      showErrorAlert(payload)
      break
  }
}

ws.onclose = () => {
  console.log('WebSocket 已断开')
}
```

---

## 10. 核心模块详解

### 10.1 MQTT 模块架构

```
mqtt/index.js（入口）
    │
    ├── mqttClient.js（MQTT 客户端）
    │   ├── 连接/重连管理
    │   ├── 发布消息（publish）
    │   └── 订阅主题（subscribe）
    │
    ├── messageRouter.js（消息路由器）
    │   └── 按主题分发到对应处理器
    │
    ├── deviceManager.js（设备管理器）
    │   ├── 心跳检测（30秒超时判定离线）
    │   ├── 在线状态管理
    │   └── 暂存指令队列（设备上线后自动下发）
    │
    ├── sensorRealtime/（传感器数据处理）
    ├── behaviorRealtime/（行为数据处理）
    └── errorHistory/（异常状态数据处理）
```

### 10.2 mqttClient.js - MQTT 客户端

核心功能：

```javascript
// 创建客户端
const client = new MqttClient(config)

// 发布消息（自动 JSON 序列化）
client.publish('topic', { key: 'value' })

// 订阅主题
client.subscribe('topic', { qos: 1 })

// 检查连接状态
client.isConnected  // true/false

// 事件监听
client.on('message', (topic, payload) => {})
client.on('connect', () => {})
client.on('reconnect', () => {})
client.on('error', (err) => {})
```

**重连机制：**
- 重连间隔：5 秒
- 连接超时：10 秒
- 自动重连：启用

### 10.3 messageRouter.js - 消息路由器

```javascript
const router = new MessageRouter()

// 注册处理器
router.register('sensor_data', handleSensorData)
router.register('behavioral_data', handleBehaviorData)

// 路由消息
const result = await router.route(topic, payload)
// result = { topic: 'sensor_data', data: { ... } } 或 null
```

### 10.4 deviceManager.js - 设备管理器

**心跳检测机制：**
- 收到心跳 → 更新设备最后活跃时间
- 每 10 秒检查一次 → 超过 30 秒未收到心跳 → 标记为离线
- 设备重新上线 → 自动下发暂存指令

**暂存指令机制：**
```javascript
// 添加暂存指令（设备离线时）
deviceManager.addPendingCommand(deviceId, configId, value)

// 检查设备是否在线
deviceManager.isOnline(deviceId)

// 设备上线时自动下发所有暂存指令
```

### 10.5 数据处理器

每个数据处理器遵循相同的模式：

```
MQTT 消息 → Handler（解析/验证） → Repository（数据库操作）
```

**sensorRealtimeHandler.js 处理流程：**
1. 解析 JSON 消息
2. 提取字段（VID, PID, Tin, Tout, LXin, Time, online）
3. 调用 `sensorRealtimeRepository.saveSensorData()` 存入数据库
4. 返回处理后的数据

**behaviorRealtimeHandler.js 处理流程：**
1. 解析 JSON 消息
2. 提取字段（mode, fan, fan_speed, air, acmode, air_power, led, led_power, Time, online）
3. 调用 `behaviorRealtimeRepository.saveBehaviorData()` 存入数据库
4. 返回处理后的数据

**errorHistoryHandler.js 处理流程：**
1. 解析 JSON 消息
2. 提取告警字段（humi_warn, smog_warn 等）
3. 自动生成 `type`（故障类型）和 `e_msg`（故障描述）
4. 调用 `errorHistoryRepository.saveErrorMsg()` 存入数据库
5. 返回处理后的数据

### 10.6 指令下发流程

```
前端请求 → POST /directData/update
    │
    ├── 1. 更新数据库 t_direct_config
    │
    ├── 2. 构建 MQTT 消息
    │
    ├── 3. 发布到 direct_data 主题（第1次）
    │
    ├── 4. 等待 100ms
    │
    ├── 5. 发布到 direct_data 主题（第2次）
    │
    └── 6. 添加到设备暂存队列
         └── 设备上线时自动下发
```

> **为什么发布两次？** 确保在不可靠的网络环境下设备能收到指令。

---

## 11. 开发指南

### 11.1 添加新的 API 接口

1. **创建控制器**：在 `controllers/` 下创建对应的控制器文件
2. **创建服务层**（可选）：在 `service/` 下创建对应的服务文件
3. **注册路由**：在 `routes/sensorRoutes.js` 中添加路由

示例 - 添加一个获取设备数量的接口：

```javascript
// controllers/device/deviceCount.js
const promisePool = require('../../config/dbPool')

async function getDeviceCount(req, res) {
  try {
    const [rows] = await promisePool.query('SELECT COUNT(*) as count FROM t_device')
    res.json({ success: true, data: rows[0].count })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

module.exports = getDeviceCount
```

```javascript
// routes/sensorRoutes.js 中添加
const getDeviceCount = require('../controllers/device/deviceCount')
router.get('/deviceCount', getDeviceCount)
```

### 11.2 添加新的 MQTT 主题处理器

1. 在 `mqtt/` 下创建新的模块目录（如 `mqtt/newTopic/`）
2. 创建 Handler 和 Repository 文件
3. 在 `mqtt/index.js` 中注册

示例：

```javascript
// mqtt/newTopic/newTopicHandler.js
const repository = require('./newTopicRepository')

const NEW_TOPIC = 'new_topic'

async function handleMessage(topic, payload) {
  try {
    const data = JSON.parse(payload.toString())
    await repository.saveData(data)
    return { topic, data }
  } catch (err) {
    console.error('[NewTopic] 处理失败:', err.message)
    return null
  }
}

module.exports = { handleMessage, NEW_TOPIC }
```

```javascript
// mqtt/index.js 中添加
const { handleMessage: handleNewTopic, NEW_TOPIC } = require('./newTopic/newTopicHandler')

// 添加到订阅列表
mqttClient.subscribe(NEW_TOPIC, { qos: 1 })

// 注册到路由器
messageRouter.register(NEW_TOPIC, handleNewTopic)
```

### 11.3 代码规范

- **控制器（Controller）**：只处理 HTTP 请求/响应，不包含业务逻辑
- **服务层（Service）**：包含业务逻辑，调用 Repository 或数据库
- **处理器（Handler）**：处理 MQTT 消息，调用 Repository 存储数据
- **仓库（Repository）**：封装数据库操作，只处理数据存取
- **错误处理**：所有异步操作使用 try/catch，错误信息统一返回 `{ success: false, message: err.message }`

### 11.4 日志规范

```javascript
// 成功日志
console.log('[模块名] 操作成功描述')

// 错误日志
console.error('[模块名] 操作失败:', err.message)

// 警告日志
console.warn('[模块名] 警告信息')
```

---

## 12. 常见问题

### 12.1 MQTT 连接失败

**现象：** 启动时显示 `⚠️ MQTT 尚未连接`

**排查步骤：**

1. 检查 MQTT Broker 是否运行：
   ```bash
   netstat -an | findstr :1883
   ```

2. 检查 `.env` 中的 `MQTT_URL` 配置是否正确

3. 检查防火墙是否阻止了 1883 端口

4. 查看 `.backend-err.log` 中的详细错误信息

### 12.2 数据库连接失败

**现象：** 启动时没有显示 `✅ 数据库连接成功`

**排查步骤：**

1. 检查 MySQL 服务是否运行：
   ```bash
   net start | findstr MySQL
   ```

2. 检查 `.env` 中的数据库配置（DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME）

3. 尝试手动连接：
   ```bash
   mysql -u root -p -h localhost -P 3306
   ```

4. 确认数据库 `third` 已创建：
   ```sql
   CREATE DATABASE IF NOT EXISTS third DEFAULT CHARACTER SET utf8mb4;
   ```

### 12.3 数据没有入库

**现象：** MQTT 已连接，但数据库中没有数据

**排查步骤：**

1. 检查 MQTT 是否收到消息（查看控制台日志）

2. 检查数据库表结构是否与 SQL 脚本一致

3. 检查字段映射是否正确（特别是 `online` 字段的格式）

4. 查看 `.backend-err.log` 中的数据库错误信息

### 12.4 WebSocket 连接不上

**现象：** 前端无法连接到 WebSocket

**排查步骤：**

1. 确认后端服务正在运行

2. 检查 WebSocket URL 是否正确：`ws://localhost:3000/ws`

3. 检查是否有代理或防火墙阻止 WebSocket 连接

4. 查看浏览器控制台的 WebSocket 错误信息

### 12.5 指令下发后设备没有响应

**现象：** 通过 API 下发指令后，设备没有执行

**排查步骤：**

1. 检查 MQTT 连接状态：`GET /mqtt/status`

2. 检查设备是否在线（通过心跳检测）

3. 检查指令格式是否正确

4. 查看控制台是否有 MQTT 发布成功的日志

5. 如果设备离线，指令会暂存，设备上线后自动下发

### 12.6 设备状态不显示（前端显示"暂无设备数据"）

**现象：** 菜单页面设备状态卡片显示"暂无设备数据"

**排查步骤：**

1. **检查数据库 t_device 表是否有设备记录：**
   ```sql
   SELECT number, device_name FROM t_device;
   ```

2. **确认设备编号（number）不为空：**
   - `DeviceManager` 以 `number` 字段作为设备唯一标识
   - 如果 `number` 为 NULL，该设备不会被加载
   - 在设备管理页面添加设备时，**必须填写设备编号**

3. **检查设备是否发送了心跳：**
   - 查看后端控制台是否有 `[MQTT] 收到消息` 日志
   - 心跳消息应包含 `online` 字段
   - `DeviceManager.onHeartbeat()` 收到心跳后才会标记设备在线

4. **自动发现机制：**
   - 即使数据库中没有设备记录，只要设备发送了心跳，`DeviceManager` 会自动发现并跟踪
   - 收到心跳后刷新前端页面即可显示

5. **检查 WebSocket 连接：**
   - 确认前端 WebSocket 已连接（控制台显示 `[WebSocket] 客户端已连接`）
   - 检查 WebSocket 消息中是否包含 `deviceStatus` 字段

6. **重启后端服务：**
   ```bash
   # 查找并杀掉旧进程
   netstat -ano | findstr :3000
   taskkill /PID <PID> /F
   # 重新启动
   cd server && node app.js
   ```

### 12.7 端口被占用

**现象：** 启动时显示 `EADDRINUSE`

**解决方法：**

```bash
# 查找占用端口的进程
netstat -ano | findstr :3000

# 终止进程（替换 PID）
taskkill /PID <PID> /F

# 或修改 .env 中的 PORT 为其他端口
PORT=3001
```

---

## 附录

### A. 常用命令速查

```bash
# 启动服务
cd server && node app.js

# 开发模式（需要 nodemon）
cd server && npm run dev

# 测试 API
Invoke-RestMethod -Uri http://localhost:3000/data

# 查看 MQTT 状态
Invoke-RestMethod -Uri http://localhost:3000/mqtt/status

# 查看日志
type .backend-err.log

# 连接 MySQL
mysql -u root -p third

# 订阅 MQTT 主题（调试用）
mosquitto_sub -t "sensor_data" -v
```

### B. 相关文件说明

| 文件 | 说明 |
|------|------|
| `wusiqi.sql` | 完整数据库初始化脚本（建库+建表+初始数据） |
| `init/init_calibrate_time.sql` | 校准时间初始化脚本 |
| `.env.example` | 环境变量模板（提交到 Git） |
| `.env` | 实际环境变量（不提交到 Git） |
| `.backend-err.log` | 运行时错误日志（自动生成） |
| `package.json` | 依赖和脚本配置 |

### C. 依赖清单

| 包名 | 版本 | 用途 |
|------|------|------|
| express | ^4.18 | Web 框架 |
| mysql2 | ^3.6 | MySQL 驱动（支持 Promise） |
| mqtt | ^5.0 | MQTT 客户端 |
| ws | ^8.14 | WebSocket 服务端 |
| cors | ^2.8 | 跨域支持 |
| dotenv | ^16.3 | 环境变量加载 |
| nodemon | ^3.0 | 开发热重载（devDependencies） |
