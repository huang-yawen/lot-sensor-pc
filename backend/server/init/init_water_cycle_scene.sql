-- 2026 湖南省大学生物联网应用创新设计竞赛：水循环场景初始化
-- 执行前请确认当前数据库，脚本会备份并替换“字段映射/指令配置”，不会删除历史采集数据。

SET NAMES utf8mb4;
START TRANSACTION;

CREATE TABLE IF NOT EXISTS t_sensor_field_mapper_before_water LIKE t_sensor_field_mapper;
INSERT IGNORE INTO t_sensor_field_mapper_before_water SELECT * FROM t_sensor_field_mapper;
CREATE TABLE IF NOT EXISTS t_behavior_field_mapper_before_water LIKE t_behavior_field_mapper;
INSERT IGNORE INTO t_behavior_field_mapper_before_water SELECT * FROM t_behavior_field_mapper;
CREATE TABLE IF NOT EXISTS t_direct_config_before_water LIKE t_direct_config;
INSERT IGNORE INTO t_direct_config_before_water SELECT * FROM t_direct_config;

INSERT INTO t_sensor_field_mapper (id, f_name, db_name, p_name, unit, type, visible) VALUES
  (1, '进水温度', 'field1', 'Tin',      '℃',     '1', '1'),
  (2, '出水温度', 'field2', 'Tout',     '℃',     '1', '1'),
  (3, '管路流量', 'field3', 'Flow',     'L/min',  '1', '1'),
  (4, '管路压力', 'field4', 'Pressure', 'kPa',    '1', '1')
ON DUPLICATE KEY UPDATE
  f_name = VALUES(f_name), db_name = VALUES(db_name), p_name = VALUES(p_name),
  unit = VALUES(unit), type = VALUES(type), visible = VALUES(visible);
UPDATE t_sensor_field_mapper SET visible = '0' WHERE id NOT IN (1, 2, 3, 4);

INSERT INTO t_behavior_field_mapper (id, f_name, db_name, p_name, unit, type, visible) VALUES
  (1, '水泵状态',   'field1', 'pump',        '', '1', '1'),
  (2, '加热状态',   'field2', 'heater',      '', '1', '1'),
  (3, '进水继电器', 'field3', 'inlet_valve', '', '1', '1'),
  (4, '排水继电器', 'field4', 'drain_valve', '', '1', '1')
ON DUPLICATE KEY UPDATE
  f_name = VALUES(f_name), db_name = VALUES(db_name), p_name = VALUES(p_name),
  unit = VALUES(unit), type = VALUES(type), visible = VALUES(visible);
UPDATE t_behavior_field_mapper SET visible = '0' WHERE id NOT IN (1, 2, 3, 4);

-- preffix 是发给设备的 MQTT JSON 属性名，现场协议变化时只改这里。
DELETE FROM t_direct_config;
INSERT INTO t_direct_config
  (id, ref_id, ref_value, t_name, f_type, f_value, mode, max, min, `order`, topic, preffix, icon)
VALUES
  (0,  NULL, NULL,     '控制模式',     '1', '手动:off|自动:on', NULL, NULL, NULL, '0', 'control', 'mode',        NULL),
  (1,  0,    'off&on', '循环水泵',     '1', '关闭:off|开启:on', NULL, NULL, NULL, '1', 'control', 'pump',        NULL),
  (2,  0,    'off&on', '加热模块',     '1', '关闭:off|开启:on', NULL, NULL, NULL, '2', 'control', 'heater',      NULL),
  (3,  0,    'off&on', '进水继电器',   '1', '关闭:off|开启:on', NULL, NULL, NULL, '3', 'control', 'inlet_valve', NULL),
  (4,  0,    'off&on', '排水继电器',   '1', '关闭:off|开启:on', NULL, NULL, NULL, '4', 'control', 'drain_valve', NULL),
  (5,  0,    'on',     '温度上限阈值', '2', NULL,               NULL, '100','0',  '5', 'control', 'temp_high',   NULL),
  (6,  0,    'on',     '温度下限阈值', '2', NULL,               NULL, '100','0',  '6', 'control', 'temp_low',    NULL),
  (7,  0,    'on',     '流量下限阈值', '2', NULL,               NULL, '100','0',  '7', 'control', 'flow_low',    NULL),
  (8,  0,    'on',     '压力上限阈值', '2', NULL,               NULL, '1000','0', '8', 'control', 'pressure_high', NULL),
  (14, 0,    'off&on', '校准时间',     '6', NULL,               NULL, NULL, NULL, '14','control', 'calibrate',   NULL);

-- 清除旧场景的空调/风机指令值，避免页面读到与新配置同 id 的历史值。
DELETE FROM t_direct;

COMMIT;

