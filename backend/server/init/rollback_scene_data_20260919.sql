-- 【文件职责】回滚"合并版（三表方案）"。
-- 三表方案下两张旧表（t_sensor_data / t_behavior_data）从未被动过，所以回滚只涉及合并表。
--
-- 【什么时候用】
--   1. 彻底退回"分开版"：代码切回分开版（压缩包 / git），再（可选）执行本脚本删掉合并表。
--      不删也行——分开版代码根本不读 t_scene_data，留着只是多一份冗余数据。
--   2. 想重跑 migrate_scene_data_20260919.sql：先执行本脚本删掉合并表，再重跑。
--
-- 【执行方式】mysql -uroot -p competition < backend/server/init/rollback_scene_data_20260919.sql

-- ─────────────────────────── 删掉合并表（两张旧表不动）───────────────────────────
DROP TABLE IF EXISTS `t_scene_data`;

SELECT '已删除 t_scene_data（t_sensor_data / t_behavior_data 保持不变，数据未动）' AS done;

-- ══════════════════ 附：如果你处于早期的"视图版"状态 ══════════════════
-- 那一版把两张旧表改名成了 *_bak，并建了两个同名视图。按下面几步回到"三真表"结构
--（数据一行都不会丢，t_scene_data 保留），然后就能配合当前代码（三写）使用。
--
-- -- 1) 删掉两个兼容视图
-- DROP VIEW IF EXISTS `t_sensor_data`;
-- DROP VIEW IF EXISTS `t_behavior_data`;
-- -- 2) 把旧表改回原名
-- RENAME TABLE `t_sensor_data_bak_20260919` TO `t_sensor_data`;
-- RENAME TABLE `t_behavior_data_bak_20260919` TO `t_behavior_data`;
-- -- 3) 合并表的索引按三表方案精简（视图没了，has_*+id 那几个旧索引不再需要）
-- ALTER TABLE `t_scene_data` ADD KEY `idx_complete_recent` (`has_sensor`,`has_behavior`,`id`);
-- ALTER TABLE `t_scene_data` DROP KEY `idx_sensor_recent`;
-- ALTER TABLE `t_scene_data` DROP KEY `idx_behavior_recent`;
-- ALTER TABLE `t_scene_data` DROP KEY `idx_sensor_ctime`;
-- ALTER TABLE `t_scene_data` DROP KEY `idx_behavior_ctime`;
-- ALTER TABLE `t_scene_data` DROP KEY `idx_d_no`;
-- ALTER TABLE `t_scene_data` DROP KEY `idx_dno_ctime`;
-- ANALYZE TABLE `t_scene_data`;
