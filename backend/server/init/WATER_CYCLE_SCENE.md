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

