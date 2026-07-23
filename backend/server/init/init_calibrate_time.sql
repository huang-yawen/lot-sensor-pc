-- 【文件职责】时间校准控制项的初始化/升级脚本。
-- 【配置中心关联】控制字段最终由 t_direct_config.preffix 映射；执行前请先备份数据库。

-- 校准时间配置
-- 作为控制模式(config_id=0)的子节点
-- 当控制模式为手动(off)时显示，自动(on)时也显示（自动模式下自动获取北京时间）
-- f_type=6 表示校准时间组件（完整日期时间选择器）
INSERT INTO `t_direct_config` VALUES (14, 0, 'off&on', '校准时间', '6', NULL, NULL, NULL, NULL, '14', 'direct', NULL, NULL);
-- 【文件职责】时间校准控制项的初始化/升级脚本。
-- 【配置中心关联】控制字段最终由 t_direct_config.preffix 映射；执行前请先备份数据库。
