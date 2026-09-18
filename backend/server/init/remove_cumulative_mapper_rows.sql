-- 【文件职责】撤销误加到 t_sensor_field_mapper 的"累计指标"映射。
--
-- 背景：累计流量 / 累计加热时长 / 累计水泵运行时长 是后端计算指标（见
-- config/metrics.js 的 CUMULATIVE_METRICS），不是设备原始上报字段，不该进字段
-- 映射表。误加后，getTableData.js 会按 visible=1 的行拼 "SELECT db_name AS 中文名"
-- 到 t_sensor_data 上，若 db_name 不是 field1~field10 就会报
--   Unknown column '...' in 'field list'
--
-- 这些累计值现已在「历史图表」页顶部"计算指标历史明细"表格里展示（走 /api/cumulative），
-- 不依赖字段映射表，因此这里把误加的行隐藏即可，传感器/行为实时/汇总表格恢复正常。
--
-- 执行前请确认当前数据库；本脚本只改映射元数据，不删除采集数据。
SET NAMES utf8mb4;

UPDATE t_sensor_field_mapper
SET visible = '0'
WHERE f_name LIKE '%累计%'
   OR p_name LIKE '%cumulative%'
   OR db_name LIKE '%cumulative%';
