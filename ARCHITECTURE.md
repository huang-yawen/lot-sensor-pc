# 项目总架构

**lot-sensor-pc** —— 生物物联网竞赛用的水循环系统监控平台。
前端 Vue3 + Pinia（打包进 `dist/`），后端 Node + Express 单进程（`backend/server/app.js`），
数据存 MySQL，与现场设备走 MQTT，浏览器实时数据走 WebSocket。

> 后端内部结构见 `backend/server/ARCHITECTURE.md`；配置项速查见 `backend/server/CONFIG_CHEATSHEET.md`。
> 下面的图用 mermaid，贴到 <https://mermaid.live> 或 VSCode 的 Markdown Preview Mermaid 插件里看。

---

## 图 1 · 全景分层

```mermaid
graph TD
    subgraph FE["前端 (Vue3 + Pinia, 打包进 dist/)"]
        PAGES["13 个页面 src/views/*.vue"]
        STORES["Store 层<br/>SystemConfig / Display / Device / Direct / Error / Pagination"]
        WSUTIL["utils/websocket.js<br/>(浏览器 WS 客户端)"]
        PAGES --> STORES
        PAGES --> WSUTIL
    end

    subgraph BE["后端 (Node + Express, 单进程 app.js)"]
        STATIC["express.static(dist/)<br/>直接托管前端"]
        ROUTES["routes/sensorRoutes.js<br/>38 条 /api 路由总表"]
        CTRL["controllers/*<br/>解析请求 → 调 service → 返 JSON"]
        SVC["service/*<br/>业务逻辑 + SQL"]
        CFG["config/*.js + service/&lt;域&gt;/config.js<br/>(静态配置常量)"]
        WSS["app.js WebSocket 服务<br/>节流广播 + 即时事件广播"]
        MQTTIN["mqtt/*<br/>连接 / 路由 / 设备在线 / 离线指令队列"]
        CTRLBRAIN["控制/保护链<br/>safetyInterlock · faultStatus · linkageRules<br/>pidHeating · pumpVelocityControl · quantityShutdown · alarm"]

        ROUTES --> CTRL --> SVC
        CTRL -.读.-> CFG
        SVC -.读.-> CFG
        MQTTIN --> CTRLBRAIN
        MQTTIN --> WSS
        CTRLBRAIN --> WSS
    end

    subgraph DATA["数据源"]
        MYSQL[("MySQL<br/>t_sensor_data · t_behavior_data · t_device<br/>t_direct · t_direct_config · t_error_msg<br/>t_operation_history · t_judgment_record · t_derived_metric")]
        BROKER(["MQTT Broker<br/>mqtt://192.168.1.110:1883"])
        JUDGESVC(["现场智能判定服务<br/>(HTTP, 赛题提供)"])
    end

    DEVICE(["现场设备<br/>传感器 + 水泵/加热执行器"])

    PAGES -->|"HTTP GET/POST /api/*"| ROUTES
    STORES -->|"HTTP /api/*"| ROUTES
    WSUTIL <-->|"ws://.../ws 实时推送"| WSS
    Browser(["浏览器"]) -->|"打开页面"| STATIC

    SVC <--> MYSQL
    SVC -.控制下发.-> MQTTIN
    CTRLBRAIN --> MYSQL
    CTRLBRAIN -.控制下发.-> MQTTIN
    MQTTIN <--> BROKER
    BROKER <--> DEVICE
    CTRL -->|"POST /api/intelligent/judge"| JUDGESVC
```

---

## 图 2 · 前端页面 / Store ↔ 后端 HTTP 接口

```mermaid
graph LR
    %% ---------- 页面 ----------
    Dash["Dashboard.vue<br/>首页概览"]
    SReal["SensorRealtime.vue"]
    SHist["SensorHistory.vue"]
    BReal["BehaviorRealtime.vue"]
    BHist["BehaviorHistory.vue"]
    DevMgmt["DeviceManagement.vue<br/>设备管理"]
    DirSet["DirectSetting.vue<br/>设备设置(指令中心)"]
    Hist["HistoryCharts.vue<br/>历史图表"]
    ErrInfo["ErrorInfo.vue<br/>故障记录"]
    JudgHist["JudgmentHistory.vue<br/>智能判定记录"]
    OpHist["OperationHistory.vue<br/>操作历史"]
    TopNav["TopNav.vue (全局)"]
    SideBar["SideBar.vue (全局)"]

    %% ---------- Store ----------
    SCStore["SystemConfigStore / DisplayStore"]
    DevStore["DeviceStore"]
    DirStore["DirectStore"]
    ErrStore["ErrorStore"]
    PgStore["PaginationStore"]

    %% ---------- 接口 ----------
    subgraph EP["/api 接口"]
        e_sysconf["GET /api/system-config"]
        e_data["GET /api/data"]
        e_byType["GET /api/dataByType"]
        e_dev["GET /api/deviceData<br/>POST .../add / delete / update"]
        e_direct["GET /api/directData<br/>GET /api/directRender<br/>POST /api/directData/update"]
        e_fault["GET /api/faultStatus/state<br/>POST /api/faultStatus/reset"]
        e_devstat["GET /api/device-status"]
        e_cm["GET /api/computed-metrics<br/>GET /api/current-temp<br/>GET /api/switch-duration"]
        e_mqtt["GET /api/mqtt/status"]
        e_charts["GET /api/average-chart · temp-flow-scatter<br/>device-state-trend · heater-energy<br/>heating-analysis · pid-heating-cycles<br/>cumulative · time-window · derived-metrics/history"]
        e_err["GET /api/errData<br/>GET /api/errTypeStats"]
        e_judge["POST /api/intelligent/judge"]
        e_jrec["GET /api/intelligent/records"]
        e_op["GET /api/operation-history<br/>GET /api/operation-history/configs"]
    end

    %% ---------- 边 ----------
    SideBar --> SCStore
    Dash --> SCStore
    SReal --> SCStore
    SHist --> SCStore
    BReal --> SCStore
    BHist --> SCStore
    DevMgmt --> SCStore
    DirSet --> SCStore
    Hist --> SCStore
    ErrInfo --> SCStore
    JudgHist --> SCStore
    OpHist --> SCStore
    SCStore --> e_sysconf

    Dash --> e_data
    Dash --> e_cm
    Dash --> e_mqtt
    Dash --> DevStore

    SReal --> PgStore
    SHist --> PgStore
    BReal --> PgStore
    BHist --> PgStore
    PgStore --> e_byType

    SHist --> e_judge
    BHist --> e_judge

    DevMgmt --> DevStore
    DevStore --> e_dev

    DirSet --> DirStore
    DirSet --> DevStore
    DirStore --> e_direct
    DirSet --> e_byType
    DirSet --> e_fault

    Hist --> e_charts

    ErrInfo --> ErrStore
    ErrStore --> e_err

    JudgHist --> e_jrec
    OpHist --> e_op

    TopNav --> e_devstat
```

---

## 图 3 · 接口 → Controller → Service → 数据表

```mermaid
graph LR
    subgraph R["路由 → Controller"]
        c_dash["sensor/getDashboardData"]
        c_table["sensor/tableData"]
        c_dev["controllers/device.js"]
        c_err["controllers/error.js"]
        c_op["controllers/operationHistory.js"]
        c_chart["controllers/computedMetrics.js"]
        c_dir["direct/directConfigTree · directConfigRender"]
        c_dirupd["directData/updateDirectConfig* (service 直挂路由)"]
        c_judge["intelligent/recognize"]
        c_jrec["intelligent/records"]
        c_dm["derivedMetric/derivedMetricController"]
        c_misc["路由内联: device-status · computed-metrics · faultStatus/* · mqtt/status"]
        c_cum["cumulative / timeWindow / switchDuration / pidHeatingCycle Controller"]
        c_sys["system/configController"]
    end

    subgraph S["Service"]
        s_table["service/tableData/getTableData"]
        s_dev["service/deviceData.js"]
        s_err["service/errorHistory.js"]
        s_op["service/operationHistory.js"]
        s_cmq["service/computedMetrics/*Query.js"]
        s_cm["service/computedMetrics/computedMetrics.js"]
        s_dir["service/directData/*"]
        s_fault["service/faultStatus/faultStatus"]
        s_dm["service/derivedMetric/* (expressionEngine)"]
        s_cum["service/cumulative · timeWindow · switchDuration · pidHeatingCycleHistory"]
        s_sys["config/systemConfig (拼装 config/*.js)"]
        s_mqtt["mqtt/deviceManager"]
    end

    subgraph D["MySQL 表 / 外部"]
        t_s[("t_sensor_data")]
        t_b[("t_behavior_data")]
        t_dev[("t_device")]
        t_dir[("t_direct / t_direct_config")]
        t_e[("t_error_msg")]
        t_o[("t_operation_history")]
        t_j[("t_judgment_record")]
        t_dm[("t_derived_metric")]
        ext_judge(["现场判定服务 HTTP"])
        code(["代码常量 config/*.js"])
    end

    c_dash --> s_table --> t_s
    c_dash --> t_e
    c_table --> s_table
    s_table --> t_b
    c_dev --> s_dev --> t_dev
    c_err --> s_err --> t_e
    c_op --> s_op --> t_o
    s_op --> t_dir
    c_chart --> s_cmq --> t_s
    s_cmq --> t_b
    c_cum --> s_cum --> t_s
    s_cum --> t_b
    c_dir --> s_dir --> t_dir
    c_dirupd --> s_dir
    s_dir -. 下发 .-> s_mqtt
    c_judge --> t_s
    c_judge --> t_b
    c_judge --> ext_judge
    c_judge --> t_j
    c_jrec --> t_j
    c_dm --> s_dm --> t_dm
    s_dm --> t_s
    c_misc --> s_fault --> t_dir
    c_misc --> s_cm --> t_s
    c_misc --> s_mqtt
    c_sys --> s_sys --> code
```

---

## 图 4 · WebSocket 实时推送（后端产出 → 前端订阅）

```mermaid
graph LR
    subgraph BE["后端产出点 (app.js broadcast)"]
        b_mqtt["MQTT 处理结果<br/>(节流合并)"]
        b_fault["faultStatus.onFault"]
        b_safety["safetyInterlock.onSafetyInterlock"]
        b_alarm["alarm.onAlarm"]
        b_pid["pidHeating.onHeaterBlocked"]
        b_dev["setInterval 2s<br/>deviceManager 状态"]
        b_flush["mqtt pendingCommandsFlushed"]
        b_direct["directData/update 后广播"]
    end

    m_sensor(["sensor_data"])
    m_behav(["behavior_data"])
    m_err(["error_data"])
    m_devstat(["device_status"])
    m_fault(["fault_triggered"])
    m_safety(["safety_triggered"])
    m_alarm(["alarm_triggered"])
    m_pid(["pid_heater_blocked"])
    m_flush(["pending_commands_flushed"])
    m_direct(["direct_data_updated"])

    b_mqtt --> m_sensor & m_behav & m_err
    b_dev --> m_devstat
    b_fault --> m_fault
    b_safety --> m_safety
    b_alarm --> m_alarm
    b_pid --> m_pid
    b_flush --> m_flush
    b_direct --> m_direct

    m_sensor --> Dash2["Dashboard.vue"] & SHist2["SensorHistory.vue"] & DirSet2["direct/DeviceSetting.vue"]
    m_behav --> BHist2["BehaviorHistory.vue"] & DirSet2
    m_err --> Dash2 & ErrInfo2["ErrorInfo.vue"]
    m_devstat --> Dash2 & TopNav2["TopNav.vue (全局)"]
    m_fault --> FaultDlg["FaultAlertDialog.vue (全局)"] & DirSet2
    m_safety --> SafeNtf["SafetyAlertNotifier.vue (全局)"]
    m_alarm --> AlarmNtf["AlarmNotifier.vue (全局)"]
    m_pid --> DirSet2
    m_flush --> DirSet2
    m_direct --> DirSet2
```

---

## 要点

- **所有页面**都经 `SystemConfigStore` / `DisplayStore` 读一次 `GET /api/system-config`（标题 / 术语 / 单设备模式 / 字段显隐）——这是唯一一个"所有页面都依赖"的接口。配置本身是后端代码常量（`config/*.js`），此接口只读不写。
- `DirectSetting.vue`（设备设置页）是最重的页面：经 `DirectStore` 读写指令中心 `t_direct`，又直接订阅 6 种 WebSocket 消息。
- 后端有 4 个接口不经 controller 文件，直接内联在 `routes/sensorRoutes.js` 里：`/api/device-status`、`/api/computed-metrics`、`/api/faultStatus/state`、`/api/faultStatus/reset`。
- **两条控制路径**：① 页面通过 `POST /api/directData/update` 手动下发；② MQTT 每来一条上报，控制/保护链（safetyInterlock / faultStatus / linkageRules / pidHeating / pumpVelocityControl / quantityShutdown / alarm）自动评估，命中就写 `t_direct` + MQTT 下发 + 记录到 `t_error_msg` / `t_operation_history`。
- `t_direct`（指令中心，"设备设置"页可调）是各阈值/开关**真正生效**的层；`config/*.js` 里的同名项只是删掉指令项时的兜底默认值。
