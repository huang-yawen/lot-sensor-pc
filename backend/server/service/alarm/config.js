/**
 * 【文件职责】本地阈值告警与自动联锁规则。逻辑在同目录 evaluateRules.js。
 * 【值的来源】从原"配置中心"持久化文件固化下来的当前实际生效值。改完重启后端生效。
 * 【谁在读】evaluateRules.js 本身；app.js（转 WebSocket 广播）、mqtt handler（每条消息触发评估）、
 * errorHistory 的 errorQueryFilter / errorTypeNames（把规则 id 翻成中文名）。
 *
 * enabled：总开关，是否由服务端按 rules 自行计算告警；不影响设备主动上报的告警。
 * autoInterlockEnabled：规则触发后是否执行 rule.action（下发控制指令）。默认关，开启前必须实机安全测试。
 * 当前状态：总开关关着（enabled=false）。
 *
 * rules 每条字段：
 *   id            - 稳定唯一英文编号，也作告警编号
 *   name          - 页面显示名
 *   source_table + source_field - 待比较字段的"槽位"（物理名从字段映射表动态解析）
 *   operator      - > >= < <= == !=
 *   threshold     - 数值阈值
 *   enabled       - 是否启用该规则
 *   cooldownMs    - 可选，告警冷却时间
 *   require       - 可选前置条件：{ source_table, source_field, values: [任一允许值] }
 *   action        - 联锁动作 { field: 下发 JSON 属性名, value: 值(会过 CONTROL_VALUE_MAP) }
 *                   只有 autoInterlockEnabled=true 时才实际下发
 */
module.exports = {
  enabled: false,
  autoInterlockEnabled: false,
  rules: [
    {
      id: 'temperature_high',
      name: '出水温度过高',
      source_table: 't_sensor_data',
      source_field: 'field2',
      operator: '>',
      threshold: 29,
      action: { field: 'heater', value: 'off' },
      enabled: true,
    },
    {
      id: 'flow_low',
      name: '循环流量过低',
      source_table: 't_sensor_data',
      source_field: 'field3',
      operator: '<',
      threshold: 0.5,
      // 只有水泵处于开启状态时，低流量才属于异常。
      require: { source_table: 't_behavior_data', source_field: 'field1', values: ['open', 'on', 1, true] },
      action: { field: 'heater', value: 'off' },
      enabled: true,
    },
    {
      id: 'pressure_high',
      name: '管路压力过高',
      source_table: 't_sensor_data',
      source_field: 'field4',
      operator: '>',
      threshold: 10,
      action: { field: 'pump', value: 'off' },
      enabled: true,
    },
  ],
}
