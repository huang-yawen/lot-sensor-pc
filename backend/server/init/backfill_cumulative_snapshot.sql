-- ============================================================
-- 累计指标快照：建表 + 历史数据回填（一次性执行）
--   对应后端 service/cumulative/cumulativeSnapshotService.js
--   执行的库 = 后端 .env 里 DB_NAME 指向的那个库
--   ⚠️ 需要 MySQL 8.0+（用了窗口函数）。执行完请【重启后端】。
-- ============================================================
SET NAMES utf8mb4;

-- ---------- 1. 建表（已存在则跳过；后端首次用到也会自动建） ----------
CREATE TABLE IF NOT EXISTS `t_cumulative_snapshot` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `d_no` varchar(64) DEFAULT NULL COMMENT '设备编号',
  `metric_key` varchar(64) NOT NULL COMMENT '累计指标标识，对应 CUMULATIVE_METRICS.metric_key',
  `c_time` datetime NOT NULL COMMENT '该条采集时间',
  `cumulative_value` decimal(20,6) NOT NULL COMMENT '该时刻的全量累计值',
  PRIMARY KEY (`id`),
  KEY `idx_metric_time` (`metric_key`, `c_time`),
  KEY `idx_dno_metric_time` (`d_no`, `metric_key`, `c_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

-- ---------- 2. 清空旧快照（避免重复累加） ----------
TRUNCATE TABLE `t_cumulative_snapshot`;

-- ---------- 3. 回填「累计流量」cumulative_flow（t_sensor_data.field3，流量积分，单位 L） ----------
INSERT INTO `t_cumulative_snapshot` (`d_no`, `metric_key`, `c_time`, `cumulative_value`)
SELECT d_no, 'cumulative_flow', c_time,
  ROUND(
    SUM(GREATEST(COALESCE(v, 0), 0) / 60 * LEAST(COALESCE(dt_sec, 1), 10))
      OVER (PARTITION BY d_no ORDER BY c_time ASC, id ASC ROWS UNBOUNDED PRECEDING),
    6)
FROM (
  SELECT id, d_no, c_time,
    CAST(NULLIF(`field3`, '') AS DECIMAL(20,6)) AS v,
    TIMESTAMPDIFF(SECOND, LAG(c_time) OVER (PARTITION BY d_no ORDER BY c_time ASC, id ASC), c_time) AS dt_sec
  FROM `t_sensor_data`
) AS t;

-- ---------- 4. 回填「累计加热时长」cumulative_heat_time（t_behavior_data.field2，单位 min） ----------
INSERT INTO `t_cumulative_snapshot` (`d_no`, `metric_key`, `c_time`, `cumulative_value`)
SELECT d_no, 'cumulative_heat_time', c_time,
  ROUND(
    SUM(COALESCE(is_on * LEAST(dt_sec, 10), 0))
      OVER (PARTITION BY d_no ORDER BY c_time ASC, id ASC ROWS UNBOUNDED PRECEDING) / 60,
    6)
FROM (
  SELECT id, d_no, c_time,
    CASE WHEN TRIM(`field2`) = '1' THEN 1 ELSE 0 END AS is_on,
    TIMESTAMPDIFF(SECOND, LAG(c_time) OVER (PARTITION BY d_no ORDER BY c_time ASC, id ASC), c_time) AS dt_sec
  FROM `t_behavior_data`
) AS t;

-- ---------- 5. 回填「累计水泵运行时长」cumulative_pump_time（t_behavior_data.field1，单位 min） ----------
INSERT INTO `t_cumulative_snapshot` (`d_no`, `metric_key`, `c_time`, `cumulative_value`)
SELECT d_no, 'cumulative_pump_time', c_time,
  ROUND(
    SUM(COALESCE(is_on * LEAST(dt_sec, 10), 0))
      OVER (PARTITION BY d_no ORDER BY c_time ASC, id ASC ROWS UNBOUNDED PRECEDING) / 60,
    6)
FROM (
  SELECT id, d_no, c_time,
    CASE WHEN TRIM(`field1`) = '1' THEN 1 ELSE 0 END AS is_on,
    TIMESTAMPDIFF(SECOND, LAG(c_time) OVER (PARTITION BY d_no ORDER BY c_time ASC, id ASC), c_time) AS dt_sec
  FROM `t_behavior_data`
) AS t;

-- ---------- 6. 验证：每个指标回填了多少行、最后累计值是多少 ----------
SELECT metric_key,
       COUNT(*)                  AS rows_cnt,
       MIN(c_time)               AS first_time,
       MAX(c_time)               AS last_time,
       MAX(cumulative_value)     AS final_total
FROM `t_cumulative_snapshot`
GROUP BY metric_key;
