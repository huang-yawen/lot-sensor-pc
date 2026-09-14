# 配置中心速查表（systemConfig.js）

> 赛场调参先查这里，找到键名再去 `config/systemConfig.js` 看该键的详细注释（文件已按编号分区，见文件顶部目录）。
>
> **改配置的正确姿势**：前端「场景配置」页 → 导出 → 改 JSON → 校验并应用。落盘在 `data/system-config.json`，覆盖代码里的默认值。
>
> **热更新**：除标注「需重启」外，保存后由 `systemConfig.onChange` 立即生效，无需重启后端。
>
> **一条贯穿约定**：凡是「现场要能调的阈值 / 开关」，程序先查指令中心 `t_direct`（按 `preffix`），查不到才用这里的默认值。所以下面很多项写着「兜底」——指令中心配了就不看这里。

---

## 场景元信息（大多只前端用）

| 键 | 作用 | 备注 |
|---|---|---|
| `SCENE_TAG` `SCENE_DESCRIPTION` `SYSTEM_TITLE` | 场景标识 / 页面标题 | 前端展示 |
| `DEVICE_LABEL` `TERMINOLOGY` | 「设备」等术语的现场叫法 | 前端展示 |
| `SINGLE_DEVICE_MODE` | 单设备模式：接口自动定位当前设备，前端不显示设备选择器 | 后端多处读（路由、各控制服务、`mappedData`）；改它影响 `t_direct` 按 `d_no` 还是 `NULL` 存取 |
| `HIDE_ID_FIELDS` `HIDE_NUMBER_FIELDS` `HIDE_DEVICE_SELECTOR` `SHOW_SECONDS` | 前端字段 / 控件显隐 | 前端 |
| `ENABLE_CHARTS` | 总开关：关掉后页面只留表格 / 卡片 | 前端 |

## 数据接入与字段映射

| 键 | 作用 | 读取方 | 备注 |
|---|---|---|---|
| `SENSOR_FIELD_MAP` | 业务语义 → `t_sensor_data` 物理槽位（`temp1/temp2/flow/pressure` → `field1..4`） | 安全联锁、故障、联动、computedMetrics | key 不能改名；value 要和 `t_sensor_field_mapper.db_name` 一致 |
| `DEVICE_ID_FIELDS` | 上报 JSON 里「设备编号」的候选字段名（按序匹配，大小写不敏感） | `protocol.js`、mqtt handlers、`mappedData.js` | 值须与 `t_device.number` 完全一致才被采信 |
| `TIME_FIELDS` | 上报 JSON 里「采集时间」的候选字段名；都没有则用服务器时间 | mqtt handlers、`protocol.js` | 建议设备直接报 `YYYY-MM-DD HH:mm:ss` |
| `HEARTBEAT_DEVICE_FIELDS` | JSON 心跳里设备编号的候选字段（纯文本心跳也支持） | `mqtt/index.js` | |
| `CONTROL_VALUE_MAP` | 页面 / 库里的控制值 ↔ 设备线上值（如 `on`↔`open`） | `protocol.js`、`deviceManager`、指令下发 | 设备直接收 `on/off` 就改成 `{on:'on',off:'off'}` |

## MQTT / 心跳

| 键 | 作用 | 读取方 | 热更新 |
|---|---|---|---|
| `MQTT_URL` `MQTT_USERNAME` `MQTT_PASSWORD` `MQTT_QOS` | Broker 连接参数 | `mqtt/index.js` | 变了才断线重连（签名比对） |
| `MQTT_TOPICS` | `sensor` / `behavior` / `heartbeat` / `control` 四个主题名。`sensor===behavior` 时启用合并处理器 | `mqtt/*`、安全联锁、指令下发、`protocol.js` | ✅ |
| `HEARTBEAT_MODE` | `receive`＝收到任意传感/行为数据即视为在线；`topic`＝只认专门心跳主题 | `mqtt/index.js` | ✅ |
| `HEARTBEAT_TIMEOUT` | 多久没心跳判离线（ms，默认 10000） | `mqtt/index.js`、`deviceManager.js` | ✅ |

## 页面行为

| 键 | 作用 | 读取方 |
|---|---|---|
| `DEFAULT_PAGE_SIZE` | 列表默认分页大小 | tableData、设备列表、异常/操作历史、智能判定记录 |
| `REALTIME_REFRESH_INTERVAL` | WebSocket 实时数据节流间隔（ms）。`0`＝不节流 | `app.js` |
| `OPERATION_HISTORY_MODE` | `both` / `software_only` / `device_only` / `off` | `operationHistoryPolicy.js` |
| `SWITCH_DURATION_DISPLAY.enabled` | 首页是否显示水泵 / 加热「累计 + 本次运行时长」 | `switchDuration*` |
| `HISTORY_CHARTS` | 历史图表页里每种图的显隐开关 | 前端 |

## 图表 / 派生指标

| 键 | 作用 | 读取方 |
|---|---|---|
| `CUMULATIVE_METRICS` | 累计指标定义（源表 / 字段 / 聚合方式 / 单位 / 精度） | `cumulativeService`、switchDuration、`mappedData`、告警 |
| `TIME_WINDOW_METRICS` | 滑动窗口指标（均值 / 波动 / 变化率）定义 | `timeWindowService`、告警 |
| `COMPUTED_METRICS` | 后端实时算的工程指标；含 `pipeAreaCm2`（流速换算）、`cumulativeFlowMode` 等 | computedMetrics 各查询、`controlHelpers`、恒流速 |
| `DEFAULT_TARGET_TEMP` | 目标温度兜底（指令中心 `target_temperature` 优先） | 联动、PID、averageChart |

## 控制与保护（都可整体禁用，`enabled: false` 是默认）

| 键 | 作用 | 读取方 | 关键子项 |
|---|---|---|---|
| `SAFETY_INTERLOCK` | 安全联锁：命中任一启用条件即强制关泵关热 + 写 `t_error_msg` | `safety/safetyInterlock.js` | 各条件布尔开关；`abnormalMax` 异常哨兵；`tempDiffThreshold` 兜底；`monitorIntervalMs`（**需重启**）；流量两条规则的水泵预热借用 `FAULT_STATUS.pumpWarmupMs` |
| `FAULT_STATUS` | 六种硬故障 + 快照恢复 + 锁面板 | `faultStatus/faultStatus.js` | `pipeBlockage/outletBlockage/dryBurn/pumpIdle/pumpFault/pipeLeak` 开关；`pumpWarmupMs` 预热宽限（安全联锁流量规则也共用）；`dryBurnDurationMs/dryBurnMinRiseC`；`tempDiffThreshold` 兜底 |
| `LINKAGE_RULES` | 正常工况联动规则集（可任意勾选组合） | `linkageRules/linkageRules.js` | `pumpAlwaysOn` / `heaterHysteresis*` / `flowSingle` / `tempSingle` / `dualTemp` / `tempFlow` / `pressureFlow` / `tempPressure` 等逐条开关 |
| `PID_HEATING` | PID 时间比例恒温（只接管加热）；真正启用看指令中心 `pid_enabled` | `pidHeating/pidHeating.js` | `kp/ki/kd`、`windowMs`、`deadband/derivativeFilter/dutyRampLimit/kff` 增强参数 |
| `PUMP_VELOCITY_CONTROL` | 恒流速（`mode: hysteresis` 滞环 / `pid` 占空比） | `pumpVelocityControl/*` | `defaultTargetVelocity`、`minOnMs/minOffMs` 防短循环、`windowMs`、PID 系数 |
| `QUANTITY_SHUTDOWN` | 累计流量到 `totalFlowTarget`(L) 自动停机 | `quantityShutdown/*` | `enabled`、`totalFlowTarget`（指令中心 `total_flow_target` 优先） |
| `ALARM_RULES` | 阈值告警：温度 / 流量 / 压力六条上下限规则，超限写记录 + 弹提示，可选自动联锁 | `alarm/evaluateRules.js`（规则写在 `checkAlarms`）、`app.js`、mqtt handlers、errorHistory | `enabled` 总开关；`autoInterlockEnabled` 是否真的下发规则里的 `actions`（数组，可同时放水泵和加热）；`temperatureHigh/temperatureLow/flowHigh/flowLow/pressureHigh/pressureLow` 逐条开关；`xxxThreshold` 六个阈值兜底（指令中心 `temp_high` 等优先）；`cooldownMs` |

## 智能判定

| 键 | 作用 | 读取方 |
|---|---|---|
| `INTELLIGENT_JUDGMENT` | 对接现场判定服务的全部参数，共 13 个键：`enabled` / `mockWhenDisabled`、`url` / `method` / `timeoutMs` / `headers`、请求体字段名 `requestField`、结论解析 `resultPath` / `conclusionPath` / `confidencePath`、显示开关 `showOnSensorPage` / `showOnBehaviorPage` / `showHistoryMenu`。**手动和自动两种模式共用这一份** | `service/intelligentJudgment/judgeClient.js` |
| `AUTO_JUDGMENT` | 自动判定模式的节奏：`enabled`（定时器总开关，跟上面那个 `enabled` 不是一回事）、`intervalMs`（多久提交一次）、`recentCount`（每次取最新几条）、`bufferSize`（内存留几条给图表）、`showMenu` | `service/autoJudgment/autoJudgment.js` |

---

## 只在这里配、不走指令中心兜底的项（改了立刻是唯一真相）

`SAFETY_INTERLOCK.flowVolatility*` · `SAFETY_INTERLOCK.abnormalMax` · `SAFETY_INTERLOCK.monitorIntervalMs` · `FAULT_STATUS` 的时长 / 计时类子项 · `PID_HEATING` 增强参数 · 所有 `*_METRICS` 定义 · `REALTIME_REFRESH_INTERVAL` · `DEFAULT_PAGE_SIZE`

## 仍然只从指令中心 t_direct 读、配置中心里没有的阈值

压力上下限 · 流量下限 · 目标温度 · 各控制模块的「回差」「温差阈值」指令项（`preffix` 见对应 service 文件头）
