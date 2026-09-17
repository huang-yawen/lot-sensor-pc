// 示例：新增三个累计计数器对应的 CUMULATIVE_METRICS 条目（仅示例，不会主动写入系统）
// 注意：这三列是“累计计数器（单调增）”，在后端使用时需先对计数器做差分再求和。

module.exports = [
  {
    metric_key: 'cumulative_heat_time_counter',
    metric_name: '累计开加热时间（s）',
    source_table: 't_sensor_data',
    source_field: 'field5',
    aggregation: 'sum',
    mode: 'standalone',
    precision: 1,
    enabled: true,
    note: '注意：field5 为计数器，应在查询前做差分（curr-prev）再 SUM。'
  },
  {
    metric_key: 'cumulative_pump_time_counter',
    metric_name: '累计开水泵时间（s）',
    source_table: 't_sensor_data',
    source_field: 'field6',
    aggregation: 'sum',
    mode: 'standalone',
    precision: 1,
    enabled: true,
    note: '注意：field6 为计数器，应在查询前做差分（curr-prev）再 SUM。'
  },
  {
    metric_key: 'cumulative_flow_counter',
    metric_name: '累计流量（L）',
    source_table: 't_sensor_data',
    source_field: 'field7',
    aggregation: 'sum',
    mode: 'standalone',
    precision: 2,
    enabled: true,
    note: '注意：field7 为累计计数器（L），需要做差分再 SUM。'
  }
];
