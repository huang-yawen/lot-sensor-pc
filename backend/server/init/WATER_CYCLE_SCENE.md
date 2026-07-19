# 2026 水循环场景接入

先备份数据库，再执行 `init_water_cycle_scene.sql`。脚本会自动额外保存三张配置备份表，不删除传感器、行为或告警历史数据。

默认 MQTT 主题及消息示例：

```text
heart_beat
{"VID":"water-01"}

sensor_data
{"VID":"water-01","Tin":22.6,"Tout":28.1,"Flow":3.4,"Pressure":126,"Time":"2026-07-18 18:00:00","online":1}

behavioral_data
{"VID":"water-01","pump":"open","heater":"close","inlet_valve":"close","drain_valve":"close","Time":"2026-07-18 18:00:00","online":1}
```

后端现在按 `t_sensor_field_mapper.p_name` 和 `t_behavior_field_mapper.p_name` 动态解析字段。现场固件字段名不同，只需修改映射表，不必改 Node.js 代码。

指令下发的 JSON 属性名取自 `t_direct_config.preffix`。例如循环水泵配置的 `preffix=pump`，开启时下发 `{"pump":"open"}`。

## 现场适配（推荐）

启动前后端后进入“场景配置”页面，导出一份完整 JSON 作为备份。现场通常只需修改：

- `config.MQTT_URL`、`config.MQTT_TOPICS` 和 `config.MQTT_QOS`
- `config.DEVICE_ID_FIELDS`、`config.TIME_FIELDS`
- `config.CONTROL_VALUE_MAP`（例如 `on/off` 是否需要转成 `open/close`）
- `config.INTELLIGENT_JUDGMENT` 的地址、请求模板和返回字段路径
- `metadata.t_sensor_field_mapper`、`metadata.t_behavior_field_mapper` 中的 `p_name`
- `metadata.t_direct_config` 中的控制属性名 `preffix`

`p_name` 支持用 `|` 写多个别名，例如 `Tin|inlet_temperature|temp_in`。场景包导入时会校验配置，三张元数据表在同一个数据库事务中更新；失败不会留下半套配置。

自动联锁默认关闭（`ENABLE_AUTO_INTERLOCK=false`），防止设备接线和高低电平含义尚未确认时误动作。本地阈值告警默认开启，规则位于 `ALARM_RULES`。

智能判定服务未启用时只运行确定性的本地占位判定，并在结果中标记 `mock=true`。比赛现场确认接口后，将 `INTELLIGENT_JUDGMENT.enabled` 改为 `true`；支持 `batch` 和 `single` 两种请求模式，所有成功、失败和 Mock 结果都会写入 `t_judgment_record`。
