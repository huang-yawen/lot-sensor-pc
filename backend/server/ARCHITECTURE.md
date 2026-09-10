# 后端架构导读

> 目的：赛场上要改一个行为时，能 30 秒内定位到「改哪个文件、改哪个配置」。
> 详细设计仍看各文件头部注释，这里只做地图。

---

## 1. 一句话总览

Node + Express 单进程。三条链路跑在一起：

1. **HTTP API**：前端查数据 / 管设备 / 改配置 → `routes/sensorRoutes.js` 分发到 `controllers/` → `service/` → MySQL。
2. **MQTT 入库 + 自动控制**：设备上报 → `mqtt/` 解析入库 → 喂给一串**互相独立**的判定服务（安全联锁 / 故障检测 / 联动规则 / PID 恒温 / 恒流速 / 定量停机 / 告警规则）→ 需要动执行器时通过 MQTT 下发指令。
3. **WebSocket 推送**：`app.js` 把 MQTT 处理结果按节流间隔广播给前端；故障 / 告警 / 安全联锁这类即时事件不走节流，立即推。

---

## 2. 数据流向图

```
                          ┌────────────────────────── HTTP ──────────────────────────┐
  浏览器 ──GET/POST──▶ app.js ──▶ routes/sensorRoutes.js ──▶ controllers/* ──▶ service/* ──▶ MySQL
                          │                                                             │
                          └── express.static(dist) 直接托管前端构建产物                  │
                                                                                        │
  设备 ──MQTT──▶ mqtt/mqttClient.js ──▶ mqtt/messageRouter.js ──▶ mqtt/<sensor|behavior|combined>Realtime/
                          │                    │                        ├─ handler   解析 + 规范化
                          │                    │                        └─ repository 落库 t_sensor_data / t_behavior_data
                          │                    │
                          │                    ▼  每条消息还会依次喂给这些独立判定服务（顺序无关，各读各的配置）：
                          │        service/safety/safetyInterlock.js      强制关泵关热 + 写 t_error_msg
                          │        service/faultStatus/faultStatus.js     5 种硬故障 + 快照 + 锁面板
                          │        service/linkageRules/linkageRules.js   正常工况联动（自由勾选的规则集）
                          │        service/pidHeating/pidHeating.js       PID 时间比例恒温
                          │        service/pumpVelocityControl/…          恒流速（滞环 / 占空比）
                          │        service/quantityShutdown/…             累计流量到量停机
                          │        service/alarm/evaluateRules.js         页面自定义阈值告警
                          │                    │
                          │                    ▼  判定要动执行器时
                          │        service/directData/saveDirectConfig  写 t_direct（当前值）
                          │        mqtt/mqttClient.publish              下发指令（设备离线则由 deviceManager 暂存）
                          │
                          ▼  MQTT 处理结果 + 即时事件
                  app.js WebSocket 广播 ──▶ 浏览器（sensor_data / behavior_data / device_status /
                                             fault_triggered / alarm_triggered / safety_triggered …）
```

---

## 3. 目录职责表

| 目录 | 职责 | 典型文件 |
|---|---|---|
| `app.js` | 进程入口：Express 装配、CORS、静态托管、WebSocket、节流广播、启动初始化 | — |
| `routes/` | 唯一的 URL → controller 映射表 | `sensorRoutes.js` |
| `controllers/` | 只做「解析 req → 调 service → 返回 JSON」，不写业务逻辑（个别历史遗留除外） | `device/`、`sensor/`、`system/` |
| `service/` | 业务逻辑与 SQL。按业务域分子目录 | 见下「按域」 |
| `mqtt/` | MQTT 连接、订阅、路由、设备在线状态、离线指令暂存 | `mqttClient.js`、`messageRouter.js`、`deviceManager.js`、`index.js` |
| `config/` | `dbPool.js` 连接池、`env.js` 读 .env、`systemConfig.js` 配置中心 | — |
| `utils/` | 与业务无关的纯工具：时间格式化、协议字段解析、设备号解析、近因过滤 | `helper.js`、`protocol.js`、`mappedData.js`、`recencyFilter.js` |
| `init/` | 一次性初始化脚本 / 建表 SQL | `init_*.sql`、`init_pump_velocity_control.js` |
| `data/` | 运行期生成的持久化文件（配置、离线指令），已 gitignore | `system-config.json`、`pending-commands.json` |

**service/ 按域**：`sensor`(查询) · `tableData`(分页表格统一数据源) · `deviceData`(设备增删改查) · `directData`(指令配置树 / 当前值) · `computedMetrics` / `derivedMetric` / `cumulative` / `timeWindow` / `switchDuration`(各类图表指标) · `pidHeating` / `pumpVelocityControl` / `linkageRules` / `safety` / `faultStatus` / `quantityShutdown`(控制与保护) · `alarm`(阈值告警) · `operationHistory` / `errorHistory`(审计与异常记录) · `controlShared`(控制模块共用的小工具：换算、冷却、事件落库)

---

## 4. 「我想改 X」速查

| 想改的东西 | 去哪 |
|---|---|
| 新增 / 修改一个 HTTP 接口 | `routes/sensorRoutes.js` + 对应 `controllers/` |
| 设备上报的 JSON 字段名变了 | **不改代码**：改数据库 `t_sensor_field_mapper` / `t_behavior_field_mapper` 的 `p_name`（`utils/mappedData.js` 按它对号入座到 `field1..field10`） |
| MQTT 地址 / 主题 / 心跳方式 | 配置中心 `MQTT_URL` / `MQTT_TOPICS` / `HEARTBEAT_MODE`（见 `CONFIG_CHEATSHEET.md`），保存即热更新，无需重启 |
| 故障判定阈值（压力/流量/温差…） | 前端「指令配置」页对应指令项（`t_direct`，按 `preffix` 实时读）；删掉指令项才退回配置中心兜底 |
| 六种硬故障的判定逻辑本身 | `service/faultStatus/faultStatus.js`（文件头有编号对照表） |
| 正常工况联动规则的开关组合 | 配置中心 `LINKAGE_RULES` 逐条布尔开关；规则实现在 `service/linkageRules/linkageRules.js` 下半部分 |
| PID 系数 Kp/Ki/Kd、控制周期、占空比上下限 | 「指令配置」页 PID 子项；`service/pidHeating/pidHeating.js` 只在指令项缺失时用 `PID_HEATING` 兜底 |
| 智能判定对接的现场接口形态（同步/异步、JSON/表单/文本） | **不改代码**：配置中心 `INTELLIGENT_JUDGMENT` 各子键；适配逻辑在 `controllers/intelligent/recognize.js` |
| 页面术语 / 分页大小 / 实时刷新间隔 | 配置中心（`DEVICE_LABEL`、`DEFAULT_PAGE_SIZE`、`REALTIME_REFRESH_INTERVAL` …） |
| 部署参数（端口、监听地址、CORS、API_TOKEN、NODE_ENV） | `.env`（模板见 `.env.example`），**改后需重启** |

---

## 5. 两条主链路时序

### HTTP 查询（以「传感器汇总数据」为例）
```
GET /api/dataByType?type=sensor&...  →  routes  →  controllers/sensor/tableData.js
  →  service/tableData/getTableData.js
       ├─ 读字段映射表（列名 → 中文展示名）
       ├─ 拼 SQL（含派生指标 / 累计 / 时间窗口的内联子查询）
       ├─ query MySQL
       └─ helper.js 拼单位、套 value_map 文案
  →  { success, data: { list, total, fieldUnits, chartSettings } }
```

### MQTT 入库 + 控制
```
设备发一条上报  →  mqttClient 'message'  →  mqtt/index.js
  ├─ 心跳判定（HEARTBEAT_MODE：receive 用数据当心跳 / topic 用专门主题）→ deviceManager.onHeartbeat
  ├─ messageRouter.route(topic) → 对应 handler → repository 落库
  └─ emit 'processedMessage' → app.js 节流广播

同一条数据并行喂给判定服务（各自 try/catch，一个抛错不影响其它）：
  safetyInterlock / faultStatus / linkageRules / pidHeating / pumpVelocityControl /
  quantityShutdown / alarm  →  命中就 saveDirectData + mqttClient.publish 下发
```

---

## 6. 三条贯穿全局的约定

1. **指令中心优先、配置中心兜底**：所有「现场要能调」的阈值/开关，先查 `t_direct`（按 `preffix`），查不到才用 `systemConfig` 的默认值。删掉指令项 = 关掉该项，程序不报错。
2. **设备编号两套**：MQTT 上报里的编号对应 `t_device.number`；系统内部一律用 `t_device.d_no`（没填就用 `number` 顶替）。`number → d_no` 的转换只在入库和心跳时做一次。
3. **`field1..field10` 槽位**：数据表没有语义列名，靠 `t_*_field_mapper` 把设备字段映射到槽位。看懂某个 `fieldN` 是什么，去查映射表，别在代码里找。
