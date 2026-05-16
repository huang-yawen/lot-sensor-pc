/*
 Navicat Premium Data Transfer

 Source Server         : science
 Source Server Type    : MySQL
 Source Server Version : 50557
 Source Host           : 8.136.98.154:8300
 Source Schema         : wusiqi

 Target Server Type    : MySQL
 Target Server Version : 50557
 File Encoding         : 65001

 Date: 08/07/2024 10:09:12
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;


-- ----------------------------
-- Table structure for t_sensor_data  传感器数据
-- ----------------------------
DROP TABLE IF EXISTS `t_sensor_data`;
CREATE TABLE `t_sensor_data`  (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '主键，自动生成',
  `d_no` varchar(64) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '设备编码，有设备场景才填充。\r\n跟底层约定好名称，不做字段的映射',
  `field1` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '预留10个字段，用于保存传感器数据',
  `field2` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `field3` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `field4` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `field5` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `field6` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `field7` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `field8` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `field9` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `field10` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `c_time` datetime NULL DEFAULT NULL COMMENT '数据更新时间。从底层获取，如果没有，则取服务端时间。跟底层约定好名称，不做字段的映射\n',
  `online` varchar(4) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '是否在线数据',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8 COLLATE = utf8_general_ci ROW_FORMAT = Compact;

-- ----------------------------
-- Records of t_sensor_data
-- ----------------------------
INSERT INTO `t_sensor_data` VALUES (4039, '2021', '12', '23', '45', '43', NULL, NULL, NULL, NULL, NULL, NULL, '2024-06-29 20:13:21', '实时数据');
INSERT INTO `t_sensor_data` VALUES (4040, '2021', '23', '43', '45', '67', NULL, NULL, NULL, NULL, NULL, NULL, '2024-06-29 20:13:59', '保存数据');
INSERT INTO `t_sensor_data` VALUES (4041, '2022', '32', '34', '57', '19', NULL, NULL, NULL, NULL, NULL, NULL, '2024-06-29 20:14:36', '实时数据');
INSERT INTO `t_sensor_data` VALUES (4042, '2022', '34', '78', '43', '21', NULL, NULL, NULL, NULL, NULL, NULL, '2024-06-29 20:14:54', '保存数据');

-- ----------------------------
-- Table structure for t_sensor_field_mapper
-- ----------------------------
DROP TABLE IF EXISTS `t_sensor_field_mapper`;
CREATE TABLE `t_sensor_field_mapper`  (
  `id` int(11) NOT NULL,
  `f_name` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL COMMENT '前端显示的名称，自动生成实时数据表单或者历史数据的表头',
  `db_name` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL COMMENT '数据库的字段名称，用于查询的时候和前端映射起来',
  `p_name` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL COMMENT '物理层的上传的属性名称，用于解析上报数据时，与表字段联系起来',
  `unit` varchar(64) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `type` varchar(4) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '数据类型 1：文本 2：图片 3：视频',
  `visible` varchar(4) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '是否可见 0：不可见 1:可见',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8 COLLATE = utf8_general_ci ROW_FORMAT = Compact;

-- ----------------------------
-- Records of t_sensor_field_mapper  传感器数据映射表
-- ----------------------------
INSERT INTO `t_sensor_field_mapper` VALUES (1, '水温', 'field1', 't1', '℃', '1', '1');
INSERT INTO `t_sensor_field_mapper` VALUES (2, '水温2', 'field2', 't2', '℃', '1', '1');
INSERT INTO `t_sensor_field_mapper` VALUES (3, '水质1', 'field3', 'tds1', 'ppm', '1', '1');
INSERT INTO `t_sensor_field_mapper` VALUES (4, '水质2', 'field4', 'tds2', 'ppm', '1', '1');
INSERT INTO `t_sensor_field_mapper` VALUES (5, '湿度', 'field5', 'tds', 'hPa', '1', '1');

-- ----------------------------
-- Table structure for t_behavior_data  行为数据    
-- ----------------------------
DROP TABLE IF EXISTS `t_behavior_data`;
CREATE TABLE `t_behavior_data`  (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '主键，自动生成',
  `d_no` varchar(64) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '设备编码，有设备场景才填充。\r\n跟底层约定好名称，不做字段的映射',
  `field1` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '预留10个字段，用于保存实时数据',
  `field2` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `field3` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `field4` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `field5` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `field6` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `field7` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `field8` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `field9` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `field10` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `c_time` datetime NULL DEFAULT NULL COMMENT '数据更新时间。从底层获取，如果没有，则取服务端时间。跟底层约定好名称，不做字段的映射\n',
  `online` varchar(4) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '是否在线数据',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8 COLLATE = utf8_general_ci ROW_FORMAT = Compact;

-- ----------------------------
-- Records of t_behavior_data  行为数据映射表
-- ----------------------------
INSERT INTO `t_behavior_data` VALUES (4039, '2021', '12', '23', '45', '43', '2024-06-29 20:13:21', NULL, NULL, NULL, NULL, NULL, '2024-06-29 20:13:21', '实时数据');
INSERT INTO `t_behavior_data` VALUES (4040, '2021', '23', '43', '45', '67', '2024-06-29 20:13:59', NULL, NULL, NULL, NULL, NULL, '2024-06-29 20:13:59', '保存数据');
INSERT INTO `t_behavior_data` VALUES (4041, '2022', '32', '34', '57', '19', '2024-06-29 20:14:36', NULL, NULL, NULL, NULL, NULL, '2024-06-29 20:14:36', '实时数据');
INSERT INTO `t_behavior_data` VALUES (4042, '2022', '34', '78', '43', '21', '2024-06-29 20:14:54', NULL, NULL, NULL, NULL, NULL, '2024-06-29 20:14:54', '保存数据');

-- ----------------------------
-- Table structure for t_behavior_field_mapper
-- ----------------------------
DROP TABLE IF EXISTS `t_behavior_field_mapper`;
CREATE TABLE `t_behavior_field_mapper`  (
  `id` int(11) NOT NULL,
  `f_name` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL COMMENT '前端显示的名称，自动生成实时数据表单或者历史数据的表头',
  `db_name` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL COMMENT '数据库的字段名称，用于查询的时候和前端映射起来',
  `p_name` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL COMMENT '物理层的上传的属性名称，用于解析上报数据时，与表字段联系起来',
  `unit` varchar(64) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `type` varchar(4) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '数据类型 1：文本 2：图片 3：视频',
  `visible` varchar(4) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '是否可见 0：不可见 1:可见',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8 COLLATE = utf8_general_ci ROW_FORMAT = Compact;

-- ----------------------------
-- Records of t_behavior_field_mapper
-- ----------------------------
INSERT INTO `t_behavior_field_mapper` VALUES (1, '水温1', 'field1', 't1', '', '1', '1');
INSERT INTO `t_behavior_field_mapper` VALUES (2, '水温2', 'field2', 't2', '', '1', '1');
INSERT INTO `t_behavior_field_mapper` VALUES (3, '水质1', 'field3', 'tds1', '', '1', '1');
INSERT INTO `t_behavior_field_mapper` VALUES (4, '水质2', 'field4', 'tds2', NULL, '1', '1');

-- ----------------------------
-- Table structure for t_device
-- ----------------------------
DROP TABLE IF EXISTS `t_device`;
CREATE TABLE `t_device`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `device_name` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL COMMENT '设备名称',
  `remarks` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '备注',
  `ctime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `number` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '电车编号id（唯一）',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8 COLLATE = utf8_general_ci ROW_FORMAT = Compact;

-- ----------------------------
-- Table structure for t_direct
-- ----------------------------
DROP TABLE IF EXISTS `t_direct`;
CREATE TABLE `t_direct`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `config_id` int(11) NULL DEFAULT NULL COMMENT '指令名称',
  `value` varchar(64) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '指令值；输入框：不配置；单选框：具体的值；滑动按钮：取值范围',
  `d_no` varchar(9) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8 COLLATE = utf8_general_ci ROW_FORMAT = Compact;

-- ----------------------------
-- Table structure for t_direct_config
-- ----------------------------
DROP TABLE IF EXISTS `t_direct_config`;
CREATE TABLE `t_direct_config`  (
  `id` int(11) NOT NULL,
  `ref_id` int(11) NULL DEFAULT NULL COMMENT '关联的指令配置Id',
  `ref_value` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '关联的指令配置值\r\n如果配置的Id的值与此处吻合，显示该指令配置',
  `t_name` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '指令名称',
  `f_type` varchar(4) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '前端类型。1：开关按钮；2：输入框；3：滑动按钮；4：时间框；5：单选框',
  `f_value` varchar(64) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '指令值；输入框：不配置；单选框：具体的值；滑动按钮：取值范围',
  `mode` varchar(4) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '模式。1=全局指令',
  `max` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `min` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `order` varchar(4) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '排序',
  `topic` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '指令对应的主题',
  `preffix` varchar(54) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '前缀',
  `icon` varchar(32) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT '图标库中的安全证书图标符号',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8 COLLATE = utf8_general_ci ROW_FORMAT = Compact;

-- ----------------------------
-- Records of t_direct_config
-- ----------------------------
INSERT INTO `t_direct_config` VALUES (0, NULL, NULL, '控制模式', '1', '手动:off|自动:on', NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `t_direct_config` VALUES (1, 0, 'off&on', '空调开关', '1', '关:off|开:on', NULL, NULL, NULL, '0', 'direct', NULL, NULL);
INSERT INTO `t_direct_config` VALUES (2, 0, 'off', '风机开关', '1', '关:off|开:on', NULL, 'null', 'null', '1', 'direct', NULL, NULL);
INSERT INTO `t_direct_config` VALUES (3, 2, 'on', '风机模式', '3', '正转:1|反转:0', NULL, '100', '1', '3', 'direct', NULL, NULL);
INSERT INTO `t_direct_config` VALUES (4, 2, 'on', '风机功率', '2', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `t_direct_config` VALUES (5, 1, 'on', '空调模式', '1', '制冷:0|制热:1', NULL, 'null', 'null', '4', 'direct', NULL, NULL);
INSERT INTO `t_direct_config` VALUES (6, 1, 'on', '空调功率', '3', NULL, NULL, '100', '1', '7', 'direct', NULL, NULL);
INSERT INTO `t_direct_config` VALUES (7, 0, 'on', '温差', '2', NULL, NULL, '100', '0', '6', 'direct', NULL, NULL);
INSERT INTO `t_direct_config` VALUES (9, 0, 'on', '温度下限阈值', '2', NULL, NULL, NULL, NULL, '9', 'direct', NULL, NULL);
INSERT INTO `t_direct_config` VALUES (10, 0, 'on', '温度上限阈值', '2', NULL, NULL, NULL, NULL, '10', 'direct', NULL, NULL);
INSERT INTO `t_direct_config` VALUES (11, 0, 'on', '光照阈值', '2', NULL, NULL, 'null', 'null', '11', 'direct', NULL, NULL);

-- ----------------------------
-- Table structure for t_error_msg
-- ----------------------------
DROP TABLE IF EXISTS `t_error_msg`;
CREATE TABLE `t_error_msg`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `d_no` varchar(16) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `c_time` datetime NULL DEFAULT NULL,
  `e_msg` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `e_no` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
  `type` varchar(4) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL COMMENT 'type=1 告警 type=2 错误',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8 COLLATE = utf8_general_ci ROW_FORMAT = Compact;

-- ----------------------------
-- Records of t_error_msg
-- ----------------------------
INSERT INTO `t_error_msg` VALUES (121, '2021', '2024-06-29 11:34:32', '出错了', NULL, NULL);
INSERT INTO `t_error_msg` VALUES (122, '2022', '2024-06-29 11:34:32', '故障了', NULL, NULL);
INSERT INTO `t_error_msg` VALUES (123, '2021', '2024-06-30 09:22:01', '1', NULL, NULL);
INSERT INTO `t_error_msg` VALUES (124, '2021', '2024-06-30 09:22:09', '2', NULL, NULL);
INSERT INTO `t_error_msg` VALUES (125, '2022', '2024-06-30 09:22:16', '3', NULL, NULL);
INSERT INTO `t_error_msg` VALUES (126, '2022', '2024-06-30 09:22:21', '4', NULL, NULL);


SET FOREIGN_KEY_CHECKS = 1;
