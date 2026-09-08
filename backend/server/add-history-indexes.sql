-- 历史图表接口加速：给两张高频查询大表补 c_time / d_no 索引。
-- 历史图表页所有查询（/api/cumulative、/api/time-window、/api/average-chart、
-- /api/device-state-trend、/api/temp-flow-scatter、/api/heater-energy、
-- /api/heating-analysis、/api/derived-metrics/history 等）都按 c_time 过滤时间范围；
-- 这两张表原本只有主键 id，等于每次全表扫描。
--
-- 在开着 MySQL 的环境执行一次即可（wusiqi.sql 里已同步补上，全新建库不用再跑这个）：
--   mysql -u<用户> -p <库名> < backend/server/add-history-indexes.sql
-- 若索引已存在会报 "Duplicate key name"，忽略即可。

ALTER TABLE `t_sensor_data`
  ADD INDEX `idx_c_time` (`c_time`) USING BTREE,
  ADD INDEX `idx_d_no` (`d_no`) USING BTREE;

ALTER TABLE `t_behavior_data`
  ADD INDEX `idx_c_time` (`c_time`) USING BTREE,
  ADD INDEX `idx_d_no` (`d_no`) USING BTREE;
