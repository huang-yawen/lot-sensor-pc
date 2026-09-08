# 赛场应对手册（后端）

> 目标：赛题一发下来，照着这份手册"哪种情况 → 改哪个文件 / 哪张表 → 怎么改 → 怎么验证"，
> 尽量不现场读代码。配套文档：`ARCHITECTURE.md`（结构）、`CONFIG_CHEATSHEET.md`（配置键速查）、
> 根目录 `../../ARCHITECTURE.md`（前后端总图）。

## 快速索引：改一个东西，先想它属于哪一层

| 要改的东西 | 在哪 | 改完 |
|---|---|---|
| MQTT 地址 / 主题 / 心跳方式 | `config/mqtt.js` | 重启后端 |
| 设备编号 / 时间字段候选名、控制值映射(on↔open) | `config/protocol.js` | 重启后端 |
| "哪个 fieldN 是温度/流量/压力" | `config/appSettings.js` 的 `SENSOR_FIELD_MAP` + 数据库 `t_sensor_field_mapper` | 重启后端 |
| 页面标题 / 术语 / 单设备模式 / 字段显隐 / 分页 / 刷新间隔 | `config/appSettings.js` | 重启后端 + 刷新前端 |
| 累计 / 滑动窗口 / 首页计算 指标定义 | `config/metrics.js` | 重启后端 |
| 安全联锁 / 故障 / 联动 / PID / 恒流速 / 定量停机 的**开关和纯软件参数** | `service/<域>/config.js` | 重启后端 |
| 温度/流量/压力**上下限、目标温度、各种阈值、Kp/Ki/Kd** | 前端「设备设置」页（写数据库 `t_direct`），**不用改代码** | 页面即时生效 |
| 智能判定对接的现场接口形态 | `controllers/intelligent/config.js`（对着 `recognize.js` 顶部的决策树） | 重启后端 |
| 设备上报字段名和库里对不上 | 数据库 `t_sensor_field_mapper` / `t_behavior_field_mapper` 的 `p_name` | 立即生效（下一条消息） |
| 历史图表页显示哪些图 | `config/appSettings.js` 的 `HISTORY_CHARTS`，或直接删前端 `HistoryCharts.vue` 里的组件 | 前端重新打包 |

**一句话原则**：`t_direct`（指令中心，"设备设置"页）是阈值/开关**真正生效**的层，改它不用重启、不用改代码；
`config/*.js` 里的同名项只是"指令项被删掉时"的兜底默认值。能在页面上调的，就别改代码。

---

## 0. 开赛前 5 分钟自检

```bash
cd backend/server

# 1. Node 版本（>= 18）
node -v

# 2. .env 里的 DB 配置对不对（主机/库名/密码）
cat .env | grep DB_

# 3. 启动后端（这台机器从 /mnt/d 加载慢，可能要等 40~60 秒才打印 "Server started"）
npm start
#   看到 "✅ 数据库连接成功"、"Server started: http://..." 就 OK
#   看到 "❌ 数据库连接失败" → 先解决 MySQL（见 §1.3）

# 4. 另开一个终端，冒烟：不依赖 DB 的接口应返回 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/system-config
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/mqtt/status

# 5. 看当前所有配置（前端也读这个）
curl -s http://127.0.0.1:3000/api/system-config | python -m json.tool | less

# 6. 前端：在 Windows 上 `npm run build`（这台 WSL 机器打不了包，rolldown 是 Windows 原生二进制）
#    后端用 express.static 直接托管 dist/，前端不用单独起服务
```

---

## 1. 环境与启动

### 1.1 后端起不来 / 端口 3000 被占

```bash
# Windows：
netstat -ano | findstr :3000
taskkill /PID <上一行最后那个数字> /F
# WSL/Linux：
pgrep -af "node app.js"
kill -9 <pid>
```
或改端口：`.env` 里 `PORT=3001`（重启）。

### 1.2 Node 版本不对
后端需要 Node ≥ 18（用了 `??`、`?.`、`fetch`、`structuredClone`）。
赛场机器版本低 → 装 nvm 切 18/20，或用赛场自带的高版本 Node。

### 1.3 数据库连不上（`ECONNREFUSED 127.0.0.1:3306` / `ETIMEDOUT`）
1. MySQL 服务没起：Windows 服务里启动 MySQL / MariaDB；命令行 `net start mysql` 或 `mysqld`。
2. `.env` 里 `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` 跟实际不符 → 改 `.env`，重启。
3. 库不存在 → `CREATE DATABASE <名字>;`，再建表（见 §8.1）。
4. 现象定位：后端启动日志有 `❌ 数据库连接失败`；所有查数据库的接口返回 500，但 `/api/system-config`、`/api/mqtt/status` 仍 200（这两个不碰 DB）。

### 1.4 前端打不了包
`node_modules` 是在 Windows 装的，含 Windows 原生二进制。**必须在 Windows 上 `npm run build`**（不要在 WSL 里打）。
打完把 `dist/` 放到项目根，后端 `express.static` 会自动托管；访问 `http://<后端IP>:3000/`。
如果只改了后端、没动前端，不用重新打包。

### 1.5 MQTT Broker 地址 / 端口变了
`config/mqtt.js`：
```js
MQTT_URL: 'mqtt://192.168.1.110:1883',   // ← 改这里，注意前缀 mqtt://
```
重启后端。启动日志会打印 `MQTT Broker URL: ...`；连上会打 `✅ MQTT 连接成功`。
运行中查状态：`curl http://127.0.0.1:3000/api/mqtt/status`。
> 注意：`.env` 里那行 `MQTT_URL=` 已经不生效了，只有 `config/mqtt.js` 说了算（`MQTT_CLIENT_ID` 仍从 `.env` 读）。

### 1.6 前端在别的机器打开，连不上后端
`.env` 里：
- `HOST=0.0.0.0`（允许局域网访问；默认 `127.0.0.1` 只能本机）
- `CORS_ORIGINS` 加上前端页面的来源，逗号分隔，例如
  `CORS_ORIGINS=http://192.168.1.50:3000,http://192.168.1.50:5173`
重启后端。前端 WebSocket 也受同一个白名单管。

---

## 2. 设备数据接入（赛场最高频）

### 2.1 完全收不到数据 / 数据不入库
按顺序排查：
1. **MQTT 连上了吗**：`curl http://127.0.0.1:3000/api/mqtt/status` → `isConnected: true`？
2. **主题名对吗**：`config/mqtt.js` 的 `MQTT_TOPICS.sensor` / `.behavior` 要和设备固件发的主题一致。
   用 MQTTX 订阅 `#` 看设备到底发到哪个主题、内容长什么样。
3. **设备编号能不能识别**：见 §2.3。识别不出来的消息会被跳过入库（日志 `[MappedData] 上报数据的设备编号未匹配已注册设备，跳过保存`）。
4. **字段映射**：见 §2.5。`t_*_field_mapper` 里 `visible=1` 的行一条都没匹配上，就等于没数据可存。

### 2.2 传感器和行为是分开两个主题，还是合在一个
`config/mqtt.js`：
- **分开**：`sensor: 'sensor_topic'`, `behavior: 'behavior_topic'`（两个不同值）
- **合一个**（本项目默认）：`sensor` 和 `behavior` 填**同一个值**（如都填 `'receive'`）。
  代码检测到两者相同，会自动改用"合并处理器"，一条消息里同时解析传感器字段和执行器状态字段。
重启后端。

### 2.3 设备识别不出来（页面显示离线 / 数据不入库 / 归到"null"设备）
设备上报里的编号字段，和数据库 `t_device.number` 要能对上。
1. 看设备实际发的是哪个字段：MQTT 抓一条报文，比如 `{"id":"water-01", ...}` → 编号字段叫 `id`，值 `water-01`。
2. `config/protocol.js` 的 `DEVICE_ID_FIELDS` 数组要**包含**这个字段名（大小写不敏感）：
   ```js
   DEVICE_ID_FIELDS: ['id', 'VID', 'deviceId', 'device_id', 'd_no', 'DNO'],  // 缺的加进去
   ```
3. 数据库 `t_device` 里要有一行 `number = 'water-01'`（在"设备管理"页新增，"内部编号"填 `water-01`）。
4. `d_no`（系统内部编号、页面展示的）没填就用 `number` 顶替。
重启后端。验证：`curl http://127.0.0.1:3000/api/device-status` 看设备在不在、`online` 状态。

### 2.4 采集时间字段名不同
`config/protocol.js` 的 `TIME_FIELDS`：
```js
TIME_FIELDS: ['Time', 'time', 'timestamp', 'c_time', 'ts'],  // 把设备用的时间字段名加进去
```
都没匹配上时用服务器当前时间入库。重启后端。
> 建议让设备直接报 `YYYY-MM-DD HH:mm:ss` 字符串，避免时区解析出偏差。

### 2.5 上报字段名和库里"field1~field10"对不上（字段映射）
这是**改数据库，不改代码，立即生效**。
- `t_sensor_data` / `t_behavior_data` 只有 `field1`..`field10` 这种无语义列。
- `t_sensor_field_mapper` / `t_behavior_field_mapper` 每行：
  `db_name`（库里的槽位，如 `field3`）、`p_name`（设备上报的字段名，`|` 分隔多个别名）、`visible`（1=生效）。

例：设备把流量字段叫 `Flow`，要存进 `field3`：
```sql
UPDATE t_sensor_field_mapper SET p_name = 'Flow|flow|flow_rate', visible = 1 WHERE db_name = 'field3';
```
`p_name` 里写多个别名（`|` 分隔），设备换了叫法也能兜住。

**如果代码里按"语义"用这个字段**（安全联锁/故障/联动/计算数据 会区分温度1/温度2/流量/压力），
还要让 `config/appSettings.js` 的 `SENSOR_FIELD_MAP` 指对槽位：
```js
SENSOR_FIELD_MAP: { temp1: 'field1', temp2: 'field2', flow: 'field3', pressure: 'field4' },
```
（key 不能改名，value 改成实际槽位）。改了这个要重启后端。

验证：`curl "http://127.0.0.1:3000/api/dataByType?type=sensor"`，看返回列名和值对不对。

### 2.6 加一个新的传感器字段
1. 数据表本来就有 `field1`..`field10`，挑一个没用的（比如 `field5`）。
2. `t_sensor_field_mapper` 里那行：`db_name='field5'`, `p_name='<设备字段名>'`, `visible=1`。
3. 如果要在页面显示中文名/单位，同一行填 `p_name` 旁边的展示名 / 单位列（看你表结构里的列）。
4. 需要按语义参与控制/计算的，加进 `SENSOR_FIELD_MAP`（key 用固定名，只支持 temp1/temp2/flow/pressure；
   要新语义得改代码，赛场一般不做）。
> 超过 10 个字段：`t_sensor_data` 加 `field11` 列，并把 `utils/mappedData.js` 里 `ALLOWED_DATA_FIELDS` 的
> `length: 10` 改成对应数字。

### 2.7 控制值格式不同（页面 on/off，设备要 1/0 或 open/close）
`config/protocol.js` 的 `CONTROL_VALUE_MAP`：
```js
CONTROL_VALUE_MAP: { on: 'open', off: 'close' },   // 设备要 open/close
// 设备直接收 on/off：  { on: 'on',  off: 'off' }
// 设备要数字 1/0：      { on: 1,     off: 0 }
```
下发时 `on`→映射值，设备回报映射值→反查回 `on`。重启后端。
> 更复杂的报文（比如 Modbus 透传整段 JSON）：在"指令配置"页给该指令项填 `wire_on_payload` / `wire_off_payload` /
> `wire_template`（`t_direct_config` 表的列），代码优先用这些整段下发，不用改 CONTROL_VALUE_MAP。

### 2.8 心跳方式
`config/mqtt.js`：
- `HEARTBEAT_MODE: 'receive'`（默认）：设备只要发过一条传感/行为数据就算在线，不需要单独心跳包。
- `HEARTBEAT_MODE: 'topic'`：只认专门的心跳主题 `MQTT_TOPICS.heartbeat`。
  心跳包里的设备编号字段用 `config/protocol.js` 的 `HEARTBEAT_DEVICE_FIELDS`（纯文本心跳如 `water-01` 也支持）。
- `HEARTBEAT_TIMEOUT: 50000`：多少毫秒没心跳判离线。
重启后端。

### 2.9 设备读数被钳在异常大值（掉线/短路时卡在满量程）
传感器故障时很多驱动会把读数钉在一个极大值。`service/safety/config.js`：
```js
abnormalMax: 9999,   // 读数 >= 它就当"掉线/短路"，跟"超过正常上限"分开处理
```
现场传感器满量程不是 9999（比如是 65535）就改这里。安全联锁和联动控制共用这一处。重启后端。

---

## 3. 控制与保护逻辑

### 3.1 温度/流量/压力上下限、温差阈值、目标温度、Kp/Ki/Kd（现场调参）
**全部走"指令中心"，在前端「设备设置」页改，不改代码、不重启、即时生效。**
底层是数据库 `t_direct`（当前值）+ `t_direct_config`（指令项定义，含 `preffix`）。

如果页面上没有某个指令项、想直接改库：
```sql
-- 看某个指令项的 config_id
SELECT id, t_name, preffix FROM t_direct_config WHERE preffix = 'flow_low';
-- 改它的当前值（单设备模式 d_no 用表里那台设备的编号；多设备模式按 d_no）
UPDATE t_direct SET value = '2.5' WHERE config_id = <上面的id> AND (d_no = '<设备号>' OR d_no IS NULL);
```

常用 `preffix` 一览（在 `t_direct_config.preffix`）：

| 类别 | preffix |
|---|---|
| 上下限阈值 | `temp_high` `temp_low` `flow_low` `flow_high` `pressure_low` `pressure_high` `temp_diff` |
| 目标值 | `target_temperature` `target_velocity` `total_flow_target` |
| 控制模式/总开关 | `auto_control_enabled` `mode` `reset_button` |
| 加热算法开关 | `pid_enabled` `heater_hysteresis_enabled` |
| 恒流速算法开关 | `pump_velocity_pid_enabled` `pump_velocity_hysteresis_enabled` `quantity_shutdown_enabled` |
| PID 恒温参数 | `target_temperature` + Kp/Ki/Kd 等（指令项名见页面） |
| 加热滞回参数 | `heater_hysteresis` `heater_hysteresis_min_on_ms` `heater_hysteresis_min_off_ms` `temp_diff_open` `temp_single_hysteresis` `dual_temp_diff` |
| 恒流速参数 | `pump_velocity_kp/ki/kd` `pump_velocity_hysteresis` `pump_velocity_deadband` `pump_velocity_window_ms` `pump_velocity_min_on_ms` `pump_velocity_min_off_ms` `pump_velocity_derivative_filter` `pump_velocity_duty_ramp_limit` |
| 故障判定参数 | `pump_warmup_ms` `dry_burn_duration_ms` `dry_burn_min_rise` `safety_temp_diff_threshold` |

**删掉某个指令项 = 关掉该项**，程序不报错，自动退回 `config/*.js` 里的兜底默认值。

### 3.2 开关某条安全联锁条件
`service/safety/config.js`。每条布尔开关：
```js
module.exports = {
  enabled: true,             // 安全联锁总开关
  flowLow: false,            // 流量低于下限/为0
  pressureHigh: false,       // 压力高于上限/为0
  tempHigh: false,           // 任一温度高于上限
  tempDiff: false,           // 温差过大
  flowVolatility: false,     // 流量剧烈波动（疑似水锤）
  manualMode: false,         // 进手动模式时安全关闭一次
  sensorOffline: true,       // 传感器掉线
  heaterWithoutPump: false,  // 加热开着但水泵没开（事后检测强关）
  requirePumpBeforeHeater: false, // 开加热前必须先开水泵（源头拦截，不受总开关约束）
  ...
}
```
按赛题只留要的那几条为 `true`，其余 `false`。重启后端。
> 阈值本身（下限值多少）不在这里，在指令中心（§3.1）。

### 3.3 开关某种硬故障检测
`service/faultStatus/config.js`：
```js
enabled: false,        // 故障状态总开关（要用就开）
pipeBlockage: true,    // ① 进水口/管道堵塞
outletBlockage: true,  // ② 出水口堵塞
dryBurn: true,         // ③ 干烧
pumpIdle: true,        // ④ 水泵空转
pumpFault: true,       // ⑤ 水泵故障
dryBurnDurationMs: 60000, dryBurnMinRiseC: 0.1, pumpWarmupMs: 3000, ...
```
`faultStatus.js` 文件头有五种故障的判定逻辑和优先级说明。重启后端。

### 3.4 开关联动规则 / 组合
`service/linkageRules/config.js`：
```js
enabled: true,          // 联动总开关
pumpAlwaysOn: false,    // 水泵常开
flowSingle: false,      // 流量单层
pressureSingle: false,  // 压力单层
tempSingle: false,      // 温度单层（带滞回）
dualTemp: false,        // 双温度融合
tempFlow: false,        // 温度+流量融合
pressureFlow: false,    // 压力+流量融合
tempPressure: false,    // 温度+压力融合
```
9 条独立开关，按赛题要什么组合就把对应的置 `true`。多条命中且结论矛盾时"关"优先于"开"（fail-safe）。
**加热算法**（滞回带通断 / PID）是例外：不在这里勾，由指令中心 `heater_hysteresis_enabled` / `pid_enabled` 决定，
两个都开时 PID 优先。`linkageRules.js` 文件头有每条规则的详细语义。重启后端。

### 3.5 PID 恒温参数
兜底值在 `service/pidHeating/config.js`（`kp/ki/kd/windowMs/deadband/...`）。
**现场调参用指令中心**（`target_temperature` + Kp/Ki/Kd 指令项），指令项优先。
是否启用：指令中心 `pid_enabled`。
调参手感看 `pidHeating.js` 文件头"给没学过 PID 的人"那段。
验证有没有在动：看 `service` 日志，或 `curl "http://127.0.0.1:3000/api/pid-heating-cycles?d_no=<设备>"`。

### 3.6 恒流速参数
兜底值 `service/pumpVelocityControl/config.js`；现场调用指令中心（`target_velocity` + 一堆 `pump_velocity_*`）。
`mode: 'hysteresis'`（滞环通断，简单不用整定）/ `'pid'`（占空比控制，更平滑但要整定）。
**必须配管道横截面积**（`config/metrics.js` 的 `COMPUTED_METRICS.pipeAreaCm2`），否则算不出流速、整轮不动作并打日志。

### 3.7 定量停机
`service/quantityShutdown/config.js`：`enabled` + `totalFlowTarget`（升）。
现场用指令中心 `quantity_shutdown_enabled` + `total_flow_target`。累计流量到量就关泵关热。

### 3.8 目标温度
`config/appSettings.js` 的 `DEFAULT_TARGET_TEMP`（兜底）；现场用指令中心 `target_temperature`（优先）。
联动、PID 都用同一个目标温度。

### 3.9 联锁误动作 / 想临时全关保护
最快：`service/safety/config.js` 里 `enabled: false`、`service/faultStatus/config.js` 里 `enabled: false`、
`service/linkageRules/config.js` 里 `enabled: false`，重启。三套都是独立的保护/控制层，各关各的。
或者更细：只把误报的那一条子开关关掉。

### 3.10 复位按钮卡在"开"、页面点不动
故障态下复位按钮自动拨到"开"。人工修复设备后在页面把它拨回"关"，系统按快照恢复。
如果卡住（比如故障条件还在、一拨回就又触发）：
1. 先解决故障根因（或临时 §3.3 把该故障关掉）
2. `curl -X POST http://127.0.0.1:3000/api/faultStatus/reset`
3. 还不行：`UPDATE t_direct SET value='off' WHERE config_id=(SELECT id FROM t_direct_config WHERE preffix='reset_button');` 然后重启后端
   （启动时会 `initFaultStateFromDb` 把内存态和库对齐）。

---

## 4. 智能判定（现场接口五花八门，全在 `controllers/intelligent/config.js` 调）

先读 `controllers/intelligent/recognize.js` **文件顶部的决策树**——它把每个配置键对应哪条代码路径画清楚了，
配了一个请求/响应示例。下面是按现场差异分场景：

前端调用固定是：`POST /api/intelligent/judge`，body `{ "type": "sensor"|"behavior", "ids": [记录id...] }`。

### 4.1 判定服务地址 / 方法
```js
url: 'http://127.0.0.1:5000/judgment',   // ← 服务在别的机器就改成那台的局域网 IP
method: 'POST',                          // 或 'GET'（GET 时请求体拼成 URL 查询参数）
timeoutMs: 10000,                        // 单次请求超时
headers: { 'Content-Type': 'application/json' },  // 要 Token 就加 Authorization
```

### 4.2 同步返回结果 vs 异步先提交任务再轮询
```js
// 同步（默认）：一次请求就拿到结果
asyncMode: false,

// 异步：第一次请求只返回 job id，要另外轮询查结果
asyncMode: true,
asyncJobIdPath: 'job_id',                 // 从提交响应里取任务 id 的点路径
asyncPollUrl: 'http://.../result/{{jobId}}',  // 查结果地址，{{jobId}} 会被替换
asyncPollMethod: 'GET',
asyncPollIntervalMs: 1000,                // 轮询间隔
asyncMaxWaitMs: 30000,                    // 最多等多久
asyncStatusPath: 'status',                // 轮询响应里看状态的点路径
asyncDoneStatusValues: ['done','success','completed'],  // 命中=成功
asyncFailedStatusValues: ['failed','error'],            // 命中=失败
```

### 4.3 请求体：JSON vs multipart 表单
```js
bodyFormat: 'json',       // 整体 JSON.stringify（默认）
// bodyFormat: 'form-data',  // 现场服务要表单/文件字段时用，requestTemplate 每个顶层字段变一个表单项
```

### 4.4 请求体模板
```js
requestTemplate: { data: '{{records}}' },
// 占位符：{{records}}=全部记录数组  {{record}}=第一条  {{ids}}=id 数组  {{record.field1}}=取字段
// 占位符独占整个字符串时保留原始类型（不会被转成字符串）
// 现场要 { samples:[...], token:'x' } 这种：requestTemplate: { samples: '{{records}}', token: 'x' }
```
`requestMode: 'batch'`（勾选的多条一次发）/ `'single'`（每条发一次再汇总）。

### 4.5 响应是规范 JSON vs 纯文本
```js
responseFormat: 'json',
resultPath: 'data.results',    // 从响应里取结果数组的点路径（留空=用整个响应）
conclusionPath: 'result',      // 单条结果里"结论"的点路径
confidencePath: 'confidence',  // "置信度"的点路径

// 响应是一段中文文字（不是 JSON）：
responseFormat: 'text',
conclusionRegex: '检测结果[：:]\\s*(\\S+)',   // 取第 1 个捕获组当结论
confidenceRegex: '置信度[：:]?\\s*([\\d.]+)', // 取第 1 个捕获组转数字
```

### 4.6 没有判定服务，先把流程跑通
```js
enabled: false,          // 不真的发请求
mockWhenDisabled: true,  // 用本地占位判定（任一字段绝对值 > 10000 判"数据异常"），status='mock'
```
接上真实服务后 `enabled: true`。

### 4.7 判定一直超时 / 失败
- 超时 → HTTP 504；服务报错 → HTTP 502；每次都会往 `t_judgment_record` 落一条 `status='failed'` 方便排查。
- `curl` 直接打现场服务确认它自己是不是好的。
- 异步模式轮询容忍 3 次连续网络抖动，之后放弃。

改完都要**重启后端**。验证：
```bash
curl -X POST http://127.0.0.1:3000/api/intelligent/judge \
  -H 'Content-Type: application/json' \
  -d '{"type":"sensor","ids":[<某条真实记录id>]}'
```

---

## 5. 指标与图表

### 5.1 累计指标（累计流量 / 累计加热时长 / 累计水泵时长）
`config/metrics.js` 的 `CUMULATIVE_METRICS` 数组，每条：
```js
{
  metric_key: 'cumulative_flow', metric_name: '累计流量',
  source_table: 't_sensor_data', source_field: 'field3',   // 从哪张表哪个槽位
  unit: 'L', enabled: true,
  aggregation: 'flow_integral',   // flow_integral=源是 L/min 速率量，按 值/60×时间间隔 积分
                                  // on_duration=开关为1的累计时长  省略=直接 SUM  avg=累计平均
  precision: 2, chart_type: 'bar', color: '#0ea5e9', mode: 'standalone',
}
```
改 `source_field` 对准你的槽位、`enabled` 开关。重启后端。验证 `curl http://127.0.0.1:3000/api/cumulative`。

### 5.2 滑动窗口指标（滑动平均 / 波动幅度 / 变化率）
`config/metrics.js` 的 `TIME_WINDOW_METRICS`，`aggregation`: `avg` / `volatility`(极差) / `rate`(相邻两点变化)，
`window_size` 窗口点数。默认全 `enabled: false`，要哪条开哪条。验证 `curl http://127.0.0.1:3000/api/time-window`。

### 5.3 首页计算数据（换热效率 / 能效比 / 阻力系数 / 液位…）
`config/metrics.js` 的 `COMPUTED_METRICS`。每个指标一个布尔开关；`enabled` 是总开关。
**关键计算参数**（算不准就是这几个没配对）：
```js
heaterRatedPower: 0,     // 加热额定功率 W —— 现在是 0，用到"加热能耗分析"必须填正数，否则那张图返回空
pipeAreaCm2: 1.131,      // 水管横截面积 cm² —— 恒流速换算、平均流速要用
initialWaterTank1: 1.1,  // 水箱1 初始水量 L —— 液位反推要用
initialWaterTank2: 1.4,  // 水箱2 初始水量 L
tankAreaCm2: 100,        // 水箱横截面积 cm²
waterDensity: 1000,      // 介质密度 kg/m³ —— 换热效率/能效比/热平衡要用，非纯水（乙二醇/盐水）改这个
waterSpecificHeat: 4200, // 介质比热容 J/(kg·℃)
```
改完重启。验证 `curl http://127.0.0.1:3000/api/computed-metrics`。

### 5.4 历史图表页显示哪些图
两种方式：
- **配置**：`config/appSettings.js` 的 `HISTORY_CHARTS`，`showXxx: false` 关掉某张图；`pointLimit` 每张图最多多少点。改完重启后端 + 刷新前端。
- **直接删**（更彻底）：前端 `src/views/HistoryCharts.vue` 里把不要的图表组件整段删掉/注释掉，前端重新打包。赛场按赛题裁剪就用这个。

### 5.5 自定义 SQL 公式指标
"配置中心"页删掉了，公式的增删改接口也一并删了，只留下 `GET /api/derived-metrics/history`（历史图表页画公式曲线用）。
`t_derived_metric` 表和公式引擎照旧，已定义的公式照常算、照常出图（表格内联指标走 `service/tableData/getTableData.js`，不经接口）。
要新增/改公式，直接改库：
```sql
SELECT * FROM t_derived_metric;   -- 看现有的
-- 字段大致：metric_key, name, expression(受限数学表达式), source 字段引用, show_history 等
```
表达式引擎见 `service/derivedMetric/expressionEngine.js`（只允许安全的数学运算）。

### 5.6 某张历史图空白
1. 对应的原始指标 `enabled` 关着（§5.1/5.2）。
2. `heater-energy` 空 → `COMPUTED_METRICS.heaterRatedPower` 是 0，填额定功率。
3. 时间范围内没数据 / `source_field` 指错槽位。
4. `curl` 直接打那个图的接口看返回，报错信息会说是哪一步。

---

## 6. 页面展示（改 `config/appSettings.js`，重启后端 + 刷新前端）

```js
SYSTEM_TITLE: '水循环智能监控系统',   // 左侧导航标题 + 浏览器页签
SCENE_TAG: '2026水循环系统',
TERMINOLOGY: { sensor:'传感器数据', behavior:'行为数据', device:'设备中心', alarm:'告警记录', judgment:'智能判定' },
DEVICE_LABEL: '设备',

SINGLE_DEVICE_MODE: true,     // true=只控一套设备，自动选第一台、隐藏选择器；false=多设备，可选、控制消息带 d_no
HIDE_DEVICE_SELECTOR: false,  // 多设备模式下也强制隐藏选择器

HIDE_ID_FIELDS: true,         // 隐藏自增主键 id 列（只影响显示）
HIDE_NUMBER_FIELDS: false,    // 隐藏设备编号列
SHOW_SECONDS: true,           // 时间显示到秒

DEFAULT_PAGE_SIZE: 5,             // 表格默认每页条数
REALTIME_REFRESH_INTERVAL: 1000, // 实时页刷新间隔 ms；0=不自动刷
ENABLE_CHARTS: true,             // 关掉后只留表格/卡片
```

智能判定按钮 / 记录菜单的显隐在 `controllers/intelligent/config.js`：
`showOnSensorPage` / `showOnBehaviorPage` / `showHistoryMenu`。

---

## 7. 现场故障速查表

| 症状 | 先看 | 大概率原因 → 动作 |
|---|---|---|
| 后端启动打印 `❌ 数据库连接失败` | `.env` 的 DB_* | MySQL 没起 / 库名密码不对 → §1.3 |
| 所有查询接口 500，`/api/system-config` 200 | 后端日志 `ECONNREFUSED :3306` | 同上，DB 问题，不是代码问题 |
| `/api/mqtt/status` → `isConnected:false` | 启动日志 `MQTT Broker URL` | Broker 地址/端口错、Broker 没起、网络不通 → §1.5 |
| 页面有页面但没实时数据 | MQTTX 订阅 `#` 看设备发没发、发到哪 | 主题名不对 §2.2 / 设备没上报 |
| 收到 MQTT 但表里没新行 | 后端日志 `跳过保存` | 设备编号识别不出 §2.3 / 字段映射没配 §2.5 |
| 表里有数据但某列全空 | `t_*_field_mapper` | 那个槽位 `p_name` 没对上设备字段 / `visible=0` → §2.5 |
| 设备一直显示离线 | `/api/device-status` | 心跳方式/超时 §2.8 / 设备号对不上 §2.3 |
| 控制指令下发了设备没反应 | `CONTROL_VALUE_MAP` / 指令项 `preffix` | 控制值格式 §2.7 / 主题 `MQTT_TOPICS.control` |
| 安全联锁/故障老是误触发 | 对应 `config.js` 子开关 + 指令中心阈值 | 关掉该子条件 §3.2/3.3 或调阈值 §3.1 |
| 自动控制不动作 | `linkageRules/config.js` 的 `enabled` + 规则开关；指令中心 `auto_control_enabled` / `mode` | 总开关没开 / 没勾规则 → §3.4 |
| 恒流速/流速相关一直不动 | 日志"算不出流速" | `COMPUTED_METRICS.pipeAreaCm2` 没配 → §3.6 |
| 智能判定按钮点了报错 | 直接 `curl` 现场判定服务 | 地址/形态不对 → §4，先 `curl -X POST /api/intelligent/judge` 看后端返回 |
| 某历史图空白 | `curl` 那个图的接口 | 指标 `enabled` 关 / 计算参数缺 → §5.6 |
| 改了 `config/*.js` 没生效 | 有没有重启后端 | 配置是静态常量，**必须重启** |
| 改了指令中心/字段映射没生效 | —— | 这些是数据库、即时生效，刷新页面 / 等下一条 MQTT 消息 |
| 前端页面白屏 / 报接口 404 | 浏览器控制台 Network | 前端没重新打包 / 后端没起 / 端口不对 |

---

## 8. 数据库

### 8.1 新赛场准备一个干净 DB
```sql
CREATE DATABASE lot_sensor DEFAULT CHARSET utf8mb4;
USE lot_sensor;
-- 表结构参考项目根 `表结构.txt`
```
表清单（缺哪个建哪个）：
- `t_sensor_data` `t_behavior_data`：字段 `id, d_no, field1..field10, c_time, online`
- `t_device`：`id, device_name, number, d_no, remarks, ctime`
- `t_sensor_field_mapper` `t_behavior_field_mapper`：`db_name, p_name, visible`(+展示名/单位/value_map 列)
- `t_direct_config`：指令项定义，`id, t_name, preffix, f_type, ref_id, wire_*`
- `t_direct`：指令当前值，`config_id, d_no, value`
- `t_error_msg`：`id, d_no, e_msg, e_no, type, c_time`
- `t_operation_history` `t_judgment_record` `t_derived_metric`：这三张**后端首次请求时会自动建**（懒建表），
  可以不管；也可以提前跑一次对应接口让它建好。
- `init/` 目录里有几个初始化 SQL/脚本：`init_water_cycle_scene.sql`（示例场景的指令项 + 字段映射）、
  `init_calibrate_time.sql`、`init_pump_velocity_control.js`（恒流速指令项，`node init/init_pump_velocity_control.js`）。
  **换赛题后核对这些跟当前表结构是否还一致再跑。**

### 8.2 清空某类数据重新开始
```sql
TRUNCATE t_sensor_data;  TRUNCATE t_behavior_data;   -- 清历史读数
TRUNCATE t_error_msg;                                -- 清告警/故障记录
TRUNCATE t_operation_history;                        -- 清操作历史
TRUNCATE t_judgment_record;                          -- 清判定记录
-- t_device / t_direct / t_direct_config / t_*_field_mapper 一般保留（这是"配置"不是"数据"）
```
清完重启后端（清掉内存里的累计值、故障态、心跳计时）。

### 8.3 累计流量重启归零 vs 不归零
`config/metrics.js` 的 `COMPUTED_METRICS.cumulativeFlowMode`：
`'all'`（默认，从全表第一条起算，后端重启不归零）/ `'session'`（本次启动以来的内存累加，重启归零）。

---

## 附录 A · 关键文件地图

```
backend/server/
├─ app.js ................... 进程入口：Express + WebSocket + 节流广播 + 启动初始化
├─ .env .................... 部署参数（端口/HOST/CORS/DB/API_TOKEN/MQTT_CLIENT_ID）
├─ config/
│  ├─ systemConfig.js ...... 只读拼装器，喂 GET /api/system-config（改配置不看这个）
│  ├─ appSettings.js ....... 标题/术语/单设备/字段显隐/分页/刷新/SENSOR_FIELD_MAP/DEFAULT_TARGET_TEMP/HISTORY_CHARTS
│  ├─ mqtt.js .............. MQTT 地址/账号/主题/心跳
│  ├─ protocol.js .......... 设备编号&时间字段候选名、CONTROL_VALUE_MAP
│  ├─ metrics.js ........... CUMULATIVE_METRICS / TIME_WINDOW_METRICS / COMPUTED_METRICS
│  └─ dbPool.js ............ MySQL 连接池
├─ routes/sensorRoutes.js .. 38 条 /api 路由总表
├─ controllers/ ............ 薄控制器（解析请求→调 service→返 JSON）
│  └─ intelligent/{recognize.js, config.js} ... 智能判定（config.js 全是现场适配参数）
├─ service/
│  ├─ safety/{safetyInterlock.js, config.js} .. 安全联锁
│  ├─ faultStatus/{faultStatus.js, config.js} . 五种硬故障
│  ├─ linkageRules/{linkageRules.js, config.js} 正常工况联动（9 条规则）
│  ├─ pidHeating/{pidHeating.js, config.js} ... PID 恒温
│  ├─ pumpVelocityControl/{...,config.js} ..... 恒流速
│  ├─ quantityShutdown/{...,config.js} ........ 定量停机
│  ├─ alarm/{evaluateRules.js, config.js} ..... 阈值告警规则
│  ├─ controlShared/ ....... 控制模块共用：查阈值、下发开关、冷却、写记录
│  ├─ directData/ .......... 指令中心 t_direct 读写 + 下发
│  ├─ computedMetrics/ ..... 历史图表各查询
│  ├─ tableData/ ........... 分页表格统一数据源
│  ├─ deviceData.js ........ 设备增删改查
│  ├─ errorHistory.js ...... 告警记录查询
│  └─ operationHistory.js .. 操作历史（写策略/写入/查询，配置内联在文件顶部）
├─ mqtt/ .................. MQTT 连接、消息路由、设备在线状态、离线指令队列
├─ utils/ ................. protocol(字段解析) / mappedData(字段映射入库) / helper(时间) / recencyFilter
└─ init/ ................. 初始化 SQL / 脚本
```

## 附录 B · 常用验证命令

```bash
BASE=http://127.0.0.1:3000

# 当前全部配置（前端也读这个）
curl -s $BASE/api/system-config | python -m json.tool

# 一轮冒烟（不依赖 DB 的应 200，依赖 DB 的要 MySQL 起着）
for p in system-config mqtt/status cumulative time-window faultStatus/state \
         deviceData data "dataByType?type=sensor" errData operation-history \
         average-chart current-temp heater-energy device-status computed-metrics; do
  printf "%-28s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/$p")"
done

# 设备在线状态
curl -s $BASE/api/device-status | python -m json.tool

# MQTT 连接状态
curl -s $BASE/api/mqtt/status

# 传感器最近数据（看字段映射对不对）
curl -s "$BASE/api/dataByType?type=sensor&pageSize=3" | python -m json.tool

# 故障态
curl -s $BASE/api/faultStatus/state | python -m json.tool

# 手动复位
curl -s -X POST $BASE/api/faultStatus/reset

# 智能判定（换成真实记录 id）
curl -s -X POST $BASE/api/intelligent/judge -H 'Content-Type: application/json' \
  -d '{"type":"sensor","ids":[1,2,3]}' | python -m json.tool
```

> 改任何 `config/*.js` 或 `.env` 后 **必须重启后端**；改数据库（`t_direct` / `t_*_field_mapper` / `t_direct_config`）**即时生效**。
