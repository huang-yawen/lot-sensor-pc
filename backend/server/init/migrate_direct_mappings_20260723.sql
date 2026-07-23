CREATE TABLE IF NOT EXISTS t_direct_config_backup_20260723_mapping LIKE t_direct_config;
INSERT INTO t_direct_config_backup_20260723_mapping
SELECT source.* FROM t_direct_config AS source
WHERE NOT EXISTS (SELECT 1 FROM t_direct_config_backup_20260723_mapping LIMIT 1);

UPDATE t_direct_config
SET preffix = CASE id
  WHEN 0 THEN 'mode'
  WHEN 1 THEN 'pump'
  WHEN 2 THEN 'heater'
  WHEN 3 THEN 'target_temperature'
  WHEN 4 THEN 'pump_speed'
  WHEN 5 THEN 'temp_low'
  WHEN 6 THEN 'temp_high'
  WHEN 7 THEN 'calibrate'
  WHEN 8 THEN 'start_time'
  WHEN 9 THEN 'end_time'
  ELSE preffix
END,
topic = COALESCE(NULLIF(topic, ''), 'control')
WHERE id BETWEEN 0 AND 9
  AND (preffix IS NULL OR TRIM(preffix) = '');

UPDATE t_direct_config SET topic = 'control' WHERE id BETWEEN 0 AND 9;

SELECT id, t_name, f_type, topic, preffix FROM t_direct_config ORDER BY id;
