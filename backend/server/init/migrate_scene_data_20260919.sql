-- 【文件职责】"第二部分（合并版）"存储层：新增合并表 t_scene_data，并把两张旧表的历史数据搬进去。
--
-- ══════════════════ 三表方案（当前生效） ══════════════════
-- 合并版同时写三张**真表**，任何一版代码都能直接用这套库（切代码不用动数据库）：
--   ① t_scene_data     合并表：「一条消息一行」——传感器槽位 field1~field10 +
--                      行为槽位 field11~field20（写入时 +10 偏移）+ has_sensor / has_behavior 标记。
--                      组合数据页面（/api/dataByType?type=combined）读这张表。
--   ② t_sensor_data     传感器侧（本文件不改它的结构和数据，只读它来搬历史）
--   ③ t_behavior_data   行为侧（同上）
-- 写入由 backend/server/utils/mappedData.js 的 saveSceneData 一次完成（每条消息 3 次 INSERT）。
--
-- 【执行前置】
--   1. 先停后端（否则迁移期间写入的数据会漏进合并表）
--   2. 先备份：mysqldump -uroot -p competition > backup_competition_xxx.sql
--   3. 执行：mysql -uroot -p competition < backend/server/init/migrate_scene_data_20260919.sql
-- 【回滚】见同目录 rollback_scene_data_20260919.sql
-- ⚠ 本脚本只执行一次：库里已经有 t_scene_data 就不要再跑（会主键冲突/重复搬数据）。
--
-- 【历史数据怎么配对】两张旧表的 (d_no, c_time) 不唯一（实测有 4000 行同秒重复），所以用
-- 「同秒组内 ROW_NUMBER() 序号 1:1 配对」，保证每一行旧数据恰好出现一次：
--   传感器行：保留原 id，写进合并表的 field1~field10（has_sensor = 1）
--   行为行  ：与同秒的第 N 条传感器行配对，写进同一行的 field11~field20（has_behavior = 1）
--   配不上的行为行：单独成一行（has_sensor = 0），只影响组合页，不会污染传感器侧
--
-- 【如果你手上是早期的"视图版"（两张旧表改名成 *_bak + 两个同名视图）】
--   先执行 rollback_scene_data_20260919.sql 里的「视图版还原」两段，回到三真表的结构，
--   再跑本文件。

-- ─────────────────────────── 1) 合并表 ───────────────────────────
CREATE TABLE IF NOT EXISTS `t_scene_data` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `d_no` varchar(64) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '设备编码',
  `field1`  varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '传感器槽位1',
  `field2`  varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '传感器槽位2',
  `field3`  varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '传感器槽位3',
  `field4`  varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '传感器槽位4',
  `field5`  varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '传感器槽位5',
  `field6`  varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '传感器槽位6',
  `field7`  varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '传感器槽位7',
  `field8`  varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '传感器槽位8',
  `field9`  varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '传感器槽位9',
  `field10` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '传感器槽位10',
  `field11` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '行为槽位1（t_behavior_data.field1）',
  `field12` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '行为槽位2',
  `field13` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '行为槽位3',
  `field14` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '行为槽位4',
  `field15` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '行为槽位5',
  `field16` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '行为槽位6',
  `field17` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '行为槽位7',
  `field18` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '行为槽位8',
  `field19` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '行为槽位9',
  `field20` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '行为槽位10',
  `has_sensor` tinyint(1) NOT NULL DEFAULT '0' COMMENT '本条上报是否含传感器字段',
  `has_behavior` tinyint(1) NOT NULL DEFAULT '0' COMMENT '本条上报是否含行为字段',
  `c_time` datetime DEFAULT NULL COMMENT '数据更新时间。从底层获取，如果没有，则取服务端时间。',
  `online` varchar(4) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '是否在线数据',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_c_time` (`c_time`),
  KEY `idx_complete_recent` (`has_sensor`,`has_behavior`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 ROW_FORMAT=DYNAMIC COMMENT='一条上报消息一行：传感器槽位 field1~10 + 行为槽位 field11~20';
-- 注意 ROW_FORMAT 必须是 DYNAMIC：本表有 20 个 varchar(255)，utf8mb3 下每列最多 765 字节，
-- 20 列合计约 15KB，超过 InnoDB 单行 8126 字节上限（旧表只有 10 列，所以 COMPACT 刚好够）。
-- DYNAMIC 会把长字段存到页外、行内只留指针，对应用层读写完全透明。

-- ─────────────────────────── 2) 历史数据：传感器行（保留原 id，页面/图表的时间轴不变）───────────────────────────
INSERT INTO `t_scene_data`
  (`id`, `d_no`, `field1`, `field2`, `field3`, `field4`, `field5`, `field6`, `field7`, `field8`, `field9`, `field10`,
   `has_sensor`, `has_behavior`, `c_time`, `online`)
SELECT
  `id`, `d_no`, `field1`, `field2`, `field3`, `field4`, `field5`, `field6`, `field7`, `field8`, `field9`, `field10`,
  1, 0, `c_time`, `online`
FROM `t_sensor_data`;

-- ─────────────────────────── 3) 历史数据：行为行按「同秒组内序号」1:1 配对补进 field11~20 ───────────────────────────
-- 不能用朴素 (d_no, c_time) JOIN：实测有 4000 行同秒重复，会把同一行行为数据复制到多条记录上。
UPDATE `t_scene_data` s
JOIN (
  SELECT `id`, `d_no`, `c_time`,
         ROW_NUMBER() OVER (PARTITION BY `d_no`, `c_time` ORDER BY `id`) AS rn
  FROM `t_scene_data`
  WHERE `has_sensor` = 1
) sr ON sr.`id` = s.`id`
JOIN (
  SELECT `id`, `d_no`, `c_time`,
         `field1`, `field2`, `field3`, `field4`, `field5`, `field6`, `field7`, `field8`, `field9`, `field10`,
         ROW_NUMBER() OVER (PARTITION BY `d_no`, `c_time` ORDER BY `id`) AS rn
  FROM `t_behavior_data`
) br ON br.`d_no` = sr.`d_no` AND br.`c_time` = sr.`c_time` AND br.`rn` = sr.`rn`
SET s.`field11` = br.`field1`,
    s.`field12` = br.`field2`,
    s.`field13` = br.`field3`,
    s.`field14` = br.`field4`,
    s.`field15` = br.`field5`,
    s.`field16` = br.`field6`,
    s.`field17` = br.`field7`,
    s.`field18` = br.`field8`,
    s.`field19` = br.`field9`,
    s.`field20` = br.`field10`,
    s.`has_behavior` = 1;

-- ─────────────────────────── 4) 历史数据：没配对上的行为行原样保留为「仅行为行」───────────────────────────
-- 即「该秒行为条数 > 传感器条数」多出来的那些，以及 (d_no, c_time) 在传感器侧根本不存在的行。
-- has_sensor = 0 → 组合页不会把它们当成"完整的消息"，行为侧的数据一行都不丢。
INSERT INTO `t_scene_data`
  (`d_no`, `field11`, `field12`, `field13`, `field14`, `field15`, `field16`, `field17`, `field18`, `field19`, `field20`,
   `has_sensor`, `has_behavior`, `c_time`, `online`)
SELECT
  br.`d_no`, br.`field1`, br.`field2`, br.`field3`, br.`field4`, br.`field5`,
  br.`field6`, br.`field7`, br.`field8`, br.`field9`, br.`field10`,
  0, 1, br.`c_time`, br.`online`
FROM (
  SELECT `id`, `d_no`, `c_time`, `online`,
         `field1`, `field2`, `field3`, `field4`, `field5`, `field6`, `field7`, `field8`, `field9`, `field10`,
         ROW_NUMBER() OVER (PARTITION BY `d_no`, `c_time` ORDER BY `id`) AS rn
  FROM `t_behavior_data`
) br
LEFT JOIN (
  SELECT `d_no`, `c_time`, COUNT(*) AS sensor_cnt
  FROM `t_scene_data`
  WHERE `has_sensor` = 1
  GROUP BY `d_no`, `c_time`
) sc ON sc.`d_no` = br.`d_no` AND sc.`c_time` = br.`c_time`
WHERE br.`rn` > COALESCE(sc.`sensor_cnt`, 0);

-- ─────────────────────────── 5) 刷新统计信息 ───────────────────────────
-- ANALYZE 不能省：不刷新的话优化器可能给"按时间范围查"选错索引
-- （实测刷新前走 has_*_recent 索引 + 回表，刷新后走 idx_c_time / 覆盖索引）。
ANALYZE TABLE `t_scene_data`;

-- ─────────────────────────── 6) 自检（人工核对下面这组数字）───────────────────────────
-- 期望：scene_total = sensor_tbl + behavior_only
--       paired       = 传感器行里配上行为数据的条数
SELECT (SELECT COUNT(*) FROM `t_sensor_data`)   AS sensor_tbl,
       (SELECT COUNT(*) FROM `t_behavior_data`) AS behavior_tbl,
       (SELECT COUNT(*) FROM `t_scene_data`)    AS scene_total,
       (SELECT COUNT(*) FROM `t_scene_data` WHERE `has_sensor` = 1 AND `has_behavior` = 1) AS paired,
       (SELECT COUNT(*) FROM `t_scene_data` WHERE `has_sensor` = 0) AS behavior_only;
