-- competition.t_behavior_data definition

CREATE TABLE `t_behavior_data` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键，自动生成',
  `d_no` varchar(64) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '设备编码，有设备场景才填充。\r\n跟底层约定好名称，不做字段的映射',
  `field1` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '预留10个字段，用于保存实时数据',
  `field2` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `field3` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `field4` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `field5` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `field6` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `field7` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `field8` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `field9` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `field10` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `c_time` datetime DEFAULT NULL COMMENT '数据更新时间。从底层获取，如果没有，则取服务端时间。跟底层约定好名称，不做字段的映射\n',
  `online` varchar(4) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '是否在线数据',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_c_time` (`c_time`),
  KEY `idx_d_no` (`d_no`)
) ENGINE=InnoDB AUTO_INCREMENT=114841 DEFAULT CHARSET=utf8mb3 ROW_FORMAT=COMPACT;


-- competition.t_behavior_field_mapper definition

CREATE TABLE `t_behavior_field_mapper` (
  `id` int NOT NULL,
  `f_name` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL COMMENT '前端显示的名称，自动生成实时数据表单或者历史数据的表头',
  `db_name` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL COMMENT '数据库的字段名称，用于查询的时候和前端映射起来',
  `p_name` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL COMMENT '物理层的上传的属性名称，用于解析上报数据时，与表字段联系起来',
  `unit` varchar(64) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `type` varchar(4) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '数据类型 1：文本 2：图片 3：视频',
  `visible` varchar(4) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '是否可见 0：不可见 1:可见',
  `value_map` text COMMENT '数据库原始值到前端展示文案的映射，JSON对象，比如 {"0":"关","1":"开"}；不配置则原样显示',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 ROW_FORMAT=COMPACT;


-- competition.t_cumulative_snapshot definition

CREATE TABLE `t_cumulative_snapshot` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `d_no` varchar(64) DEFAULT NULL COMMENT '设备编号',
  `metric_key` varchar(64) NOT NULL COMMENT '累计指标标识，对应 CUMULATIVE_METRICS.metric_key',
  `c_time` datetime NOT NULL COMMENT '该条采集时间',
  `cumulative_value` decimal(20,6) NOT NULL COMMENT '该时刻的全量累计值',
  PRIMARY KEY (`id`),
  KEY `idx_metric_time` (`metric_key`,`c_time`),
  KEY `idx_dno_metric_time` (`d_no`,`metric_key`,`c_time`)
) ENGINE=InnoDB AUTO_INCREMENT=663127 DEFAULT CHARSET=utf8mb3;


-- competition.t_derived_metric definition

CREATE TABLE `t_derived_metric` (
  `id` int NOT NULL AUTO_INCREMENT,
  `metric_key` varchar(64) NOT NULL,
  `metric_name` varchar(255) NOT NULL,
  `formula` varchar(1000) NOT NULL,
  `unit` varchar(64) DEFAULT NULL,
  `precision_digits` int NOT NULL DEFAULT '2',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `show_realtime` tinyint(1) NOT NULL DEFAULT '1',
  `show_history` tinyint(1) NOT NULL DEFAULT '1',
  `show_chart` tinyint(1) NOT NULL DEFAULT '1',
  `show_history_chart` tinyint(1) NOT NULL DEFAULT '1',
  `chart_type` varchar(16) NOT NULL DEFAULT 'line',
  `y_axis` varchar(16) NOT NULL DEFAULT 'left',
  `color` varchar(16) DEFAULT NULL,
  `y_min` decimal(20,6) DEFAULT NULL,
  `y_max` decimal(20,6) DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_metric_key` (`metric_key`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb3;


-- competition.t_device definition

CREATE TABLE `t_device` (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_name` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL COMMENT '设备名称',
  `remarks` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '备注',
  `ctime` datetime DEFAULT NULL COMMENT '创建时间',
  `number` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL COMMENT '电车编号id（唯一）',
  `d_no` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb3 ROW_FORMAT=COMPACT;


-- competition.t_direct definition

CREATE TABLE `t_direct` (
  `id` int NOT NULL AUTO_INCREMENT,
  `config_id` int DEFAULT NULL COMMENT '指令名称',
  `value` varchar(64) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '指令值；输入框：不配置；单选框：具体的值；滑动按钮：取值范围',
  `d_no` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=94 DEFAULT CHARSET=utf8mb3 ROW_FORMAT=COMPACT;


-- competition.t_direct_config definition

CREATE TABLE `t_direct_config` (
  `id` int NOT NULL,
  `ref_id` int DEFAULT NULL COMMENT '关联的指令配置Id',
  `ref_value` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '关联的指令配置值\r\n如果配置的Id的值与此处吻合，显示该指令配置',
  `t_name` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '指令名称',
  `f_type` varchar(4) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '前端类型。1：开关按钮；2：输入框；3：滑动按钮；4：时间框；5：单选框',
  `f_value` varchar(64) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '指令值；输入框：不配置；单选框：具体的值；滑动按钮：取值范围',
  `mode` varchar(4) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '模式。1=全局指令',
  `max` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `min` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `order` varchar(4) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '排序',
  `topic` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '指令对应的主题',
  `preffix` varchar(54) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '前缀，后端写代码用的“身份证”',
  `icon` varchar(32) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '图标库中的安全证书图标符号',
  `wire_template` text COMMENT '自定义协议下发的完整 JSON 模板；配置后开关类指令改用这个模板整体下发，只把其中 crc 字段按开=1/关=0 替换，不再拼 {preffix: 值}',
  `wire_on_payload` text,
  `wire_off_payload` text,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 ROW_FORMAT=COMPACT;


-- competition.t_error_msg definition

CREATE TABLE `t_error_msg` (
  `id` int NOT NULL AUTO_INCREMENT,
  `d_no` varchar(64) DEFAULT NULL,
  `source` varchar(32) NOT NULL DEFAULT 'system',
  `error_type` varchar(128) DEFAULT NULL,
  `c_time` datetime DEFAULT NULL,
  `e_msg` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `e_no` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `type` varchar(64) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT 'type=1 告警 type=2 错误，或本地规则名称',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_source` (`source`),
  KEY `idx_error_type` (`error_type`)
) ENGINE=InnoDB AUTO_INCREMENT=4239 DEFAULT CHARSET=utf8mb3 ROW_FORMAT=COMPACT;


-- competition.t_judgment_record definition

CREATE TABLE `t_judgment_record` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `d_no` varchar(64) DEFAULT NULL,
  `data_type` varchar(32) NOT NULL,
  `source_ids` varchar(1000) DEFAULT NULL,
  `request_body` longtext,
  `response_body` longtext,
  `conclusion` varchar(255) DEFAULT NULL,
  `confidence` decimal(8,4) DEFAULT NULL,
  `status` varchar(32) NOT NULL,
  `error_message` varchar(1000) DEFAULT NULL,
  `c_time` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_judgment_time` (`c_time`),
  KEY `idx_judgment_device` (`d_no`)
) ENGINE=InnoDB AUTO_INCREMENT=11458 DEFAULT CHARSET=utf8mb3;


-- competition.t_operation_history definition

CREATE TABLE `t_operation_history` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键，自动生成',
  `d_no` varchar(64) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '设备编号',
  `config_id` int DEFAULT NULL COMMENT '指令配置ID，关联t_direct_config.id',
  `old_value` varchar(64) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '旧值',
  `new_value` varchar(64) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '新值',
  `source` varchar(32) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '来源：manual(前端指令下发) / auto(设备状态变化)',
  `c_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_d_no` (`d_no`) USING BTREE,
  KEY `idx_c_time` (`c_time`) USING BTREE,
  KEY `idx_config_id` (`config_id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=12962 DEFAULT CHARSET=utf8mb3 ROW_FORMAT=COMPACT;


-- competition.t_pid_heating_cycle definition

CREATE TABLE `t_pid_heating_cycle` (
  `id` int NOT NULL AUTO_INCREMENT,
  `d_no` varchar(64) DEFAULT NULL COMMENT '设备编号',
  `cycle_index` int NOT NULL COMMENT 'PWM周期序号（进程内自增，重启清零，不作跨重启对比）',
  `window_start` datetime(3) NOT NULL COMMENT '本周期起始时间',
  `window_ms` int NOT NULL COMMENT '周期长度(ms)',
  `on_duration_ms` int NOT NULL COMMENT '本周期内加热应开启的时长(ms)',
  `duty` decimal(5,1) NOT NULL COMMENT '占空比(%)',
  `c_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '写入时间',
  PRIMARY KEY (`id`),
  KEY `idx_d_no_window_start` (`d_no`,`window_start`)
) ENGINE=InnoDB AUTO_INCREMENT=2131 DEFAULT CHARSET=utf8mb3;


-- competition.t_sensor_data definition

CREATE TABLE `t_sensor_data` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键，自动生成',
  `d_no` varchar(64) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '设备编码，有设备场景才填充。\r\n跟底层约定好名称，不做字段的映射',
  `field1` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '预留10个字段，用于保存传感器数据',
  `field2` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `field3` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `field4` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `field5` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `field6` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `field7` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `field8` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `field9` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `field10` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `c_time` datetime DEFAULT NULL COMMENT '数据更新时间。从底层获取，如果没有，则取服务端时间。跟底层约定好名称，不做字段的映射\n',
  `online` varchar(4) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '是否在线数据',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_c_time` (`c_time`),
  KEY `idx_d_no` (`d_no`)
) ENGINE=InnoDB AUTO_INCREMENT=113336 DEFAULT CHARSET=utf8mb3 ROW_FORMAT=COMPACT;


-- competition.t_sensor_field_mapper definition

CREATE TABLE `t_sensor_field_mapper` (
  `id` int NOT NULL,
  `f_name` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL COMMENT '前端显示的名称，自动生成实时数据表单或者历史数据的表头',
  `db_name` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL COMMENT '数据库的字段名称，用于查询的时候和前端映射起来',
  `p_name` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL COMMENT '物理层的上传的属性名称，用于解析上报数据时，与表字段联系起来',
  `unit` varchar(64) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `type` varchar(4) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '数据类型 1：文本 2：图片 3：视频',
  `visible` varchar(4) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '是否可见 0：不可见 1:可见',
  `value_map` text COMMENT '数据库原始值到前端展示文案的映射，JSON对象，比如 {"0":"关","1":"开"}；不配置则原样显示',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 ROW_FORMAT=COMPACT;