-- ----------------------------
-- Table structure for t_operation_history  操作历史
-- 关联 t_direct_config.id 获取操作名称和值含义，保证通过改数据库就能适配不同赛题
-- ----------------------------
CREATE TABLE IF NOT EXISTS `t_operation_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '主键，自动生成',
  `d_no` varchar(64) CHARACTER SET utf8 COLLATE utf8_general_ci DEFAULT NULL COMMENT '设备编号',
  `config_id` int(11) DEFAULT NULL COMMENT '指令配置ID，关联t_direct_config.id',
  `old_value` varchar(64) CHARACTER SET utf8 COLLATE utf8_general_ci DEFAULT NULL COMMENT '旧值',
  `new_value` varchar(64) CHARACTER SET utf8 COLLATE utf8_general_ci DEFAULT NULL COMMENT '新值',
  `source` varchar(32) CHARACTER SET utf8 COLLATE utf8_general_ci DEFAULT NULL COMMENT '来源：manual(前端指令下发) / auto(设备状态变化)',
  `c_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_d_no` (`d_no`) USING BTREE,
  KEY `idx_c_time` (`c_time`) USING BTREE,
  KEY `idx_config_id` (`config_id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8 COLLATE = utf8_general_ci ROW_FORMAT = Compact;