-- 验证 t_sensor_data 中“累计计数器”字段的只读检查与差分累计 SQL
-- 用法：把 :D_NO 和时间范围替换为你的设备和区间后，在 MySQL 客户端执行。示例：
-- mysql -u user -p -D lot_sensor < validate_counters.sql

-- 0) 可选：修正映射表的拼写错误（若需要）
-- UPDATE t_sensor_field_mapper SET db_name = 'field6' WHERE db_name = 'filed6';

-- 1) 查看映射行（确认）
SELECT id, f_name, db_name, p_name, unit
FROM t_sensor_field_mapper
WHERE id IN (5,6,7);

-- 2) 查看最近 50 条是否有写入（快速样例）
SELECT id, d_no, field5, field6, field7, c_time
FROM t_sensor_data
WHERE COALESCE(field5, field6, field7) IS NOT NULL
ORDER BY c_time DESC
LIMIT 50;

-- 3) 判断单条序列（是否为单调计数器）
SELECT c_time, field5 AS heat_counter
FROM t_sensor_data
WHERE field5 IS NOT NULL
ORDER BY c_time DESC
LIMIT 50;

SELECT c_time, field6 AS pump_counter
FROM t_sensor_data
WHERE field6 IS NOT NULL
ORDER BY c_time DESC
LIMIT 50;

SELECT c_time, field7 AS flow_counter
FROM t_sensor_data
WHERE field7 IS NOT NULL
ORDER BY c_time DESC
LIMIT 50;

-- 4) 区间内按差分累加（处理复位/归零）：heat_time（秒） -> 转分钟
-- 替换 'your_device' 与时间范围
SELECT ROUND(SUM(delta)/60,2) AS total_heat_minutes
FROM (
  SELECT
    CASE
      WHEN prev_value IS NULL THEN 0
      WHEN value >= prev_value THEN value - prev_value
      ELSE value
    END AS delta
  FROM (
    SELECT
      CAST(NULLIF(field5,'') AS DECIMAL(20,6)) AS value,
      LAG(CAST(NULLIF(field5,'') AS DECIMAL(20,6))) OVER (ORDER BY c_time ASC, id ASC) AS prev_value
    FROM t_sensor_data
    WHERE d_no = 'your_device' AND c_time BETWEEN '2026-09-16 00:00:00' AND '2026-09-17 00:00:00'
  ) t
) s;

-- 5) pump_time 同理（秒 -> 分钟）
SELECT ROUND(SUM(delta)/60,2) AS total_pump_minutes
FROM (
  SELECT
    CASE
      WHEN prev_value IS NULL THEN 0
      WHEN value >= prev_value THEN value - prev_value
      ELSE value
    END AS delta
  FROM (
    SELECT
      CAST(NULLIF(field6,'') AS DECIMAL(20,6)) AS value,
      LAG(CAST(NULLIF(field6,'') AS DECIMAL(20,6))) OVER (ORDER BY c_time ASC, id ASC) AS prev_value
    FROM t_sensor_data
    WHERE d_no = 'your_device' AND c_time BETWEEN '2026-09-16 00:00:00' AND '2026-09-17 00:00:00'
  ) t
) s;

-- 6) total_flow（单位 L）
SELECT SUM(delta) AS total_flow_L
FROM (
  SELECT
    CASE
      WHEN prev_value IS NULL THEN 0
      WHEN value >= prev_value THEN value - prev_value
      ELSE value
    END AS delta
  FROM (
    SELECT
      CAST(NULLIF(field7,'') AS DECIMAL(20,6)) AS value,
      LAG(CAST(NULLIF(field7,'') AS DECIMAL(20,6))) OVER (ORDER BY c_time ASC, id ASC) AS prev_value
    FROM t_sensor_data
    WHERE d_no = 'your_device' AND c_time BETWEEN '2026-09-16 00:00:00' AND '2026-09-17 00:00:00'
  ) t
) s;

-- 7) 去重后再差分（若可能存在重复 c_time）
WITH dedup AS (
  SELECT * FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY c_time ORDER BY id DESC) AS rn
    FROM t_sensor_data
    WHERE d_no = 'your_device' AND c_time BETWEEN '2026-09-16 00:00:00' AND '2026-09-17 00:00:00'
  ) x WHERE rn = 1
)
SELECT ROUND(SUM(delta)/60,2) AS total_heat_minutes FROM (
  SELECT CASE WHEN value>=prev_value THEN value-prev_value ELSE value END AS delta
  FROM (
    SELECT CAST(NULLIF(field5,'') AS DECIMAL(20,6)) AS value,
      LAG(CAST(NULLIF(field5,'') AS DECIMAL(20,6))) OVER (ORDER BY c_time ASC, id ASC) AS prev_value
    FROM dedup
  ) t
) s;

-- 8) 计算平均采样间隔（秒）用于对比“行数×固定间隔”的合理性
SELECT AVG(dt) AS avg_sec FROM (
  SELECT TIMESTAMPDIFF(SECOND, LAG(c_time) OVER (ORDER BY c_time ASC, id ASC), c_time) AS dt
  FROM t_sensor_data
  WHERE d_no = 'your_device' AND c_time BETWEEN '2026-09-16 00:00:00' AND '2026-09-17 00:00:00'
) t WHERE dt IS NOT NULL;

-- 9) 查找异常大差分（批量写入/补写）——阈值示例：3600 秒（1 小时）
SELECT c_time, value, prev_value, (value - prev_value) AS delta
FROM (
  SELECT c_time,
    CAST(NULLIF(field5,'') AS DECIMAL(20,6)) AS value,
    LAG(CAST(NULLIF(field5,'') AS DECIMAL(20,6))) OVER (ORDER BY c_time ASC, id ASC) AS prev_value
  FROM t_sensor_data
  WHERE d_no='your_device' AND c_time BETWEEN '2026-09-16 00:00:00' AND '2026-09-17 00:00:00'
) t
WHERE prev_value IS NOT NULL AND (value - prev_value) > 3600
ORDER BY c_time DESC
LIMIT 50;

-- 10) 简单法统计（行数×1s 假设）对比
SELECT COUNT(*) AS rows_nonnull
FROM t_sensor_data
WHERE d_no='your_device' AND field5 IS NOT NULL AND c_time BETWEEN '2026-09-16 00:00:00' AND '2026-09-17 00:00:00';
-- rows_nonnull / 60 => 分钟（直接对比差分法结果）

-- End of file
