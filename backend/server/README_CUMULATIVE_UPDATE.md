说明：验证 t_sensor_data 中累计计数器字段并生成指标配置样例

文件：
- [工具 SQL](backend/server/tools/validate_counters.sql)
- [示例配置](backend/server/config/samples/cumulative_new_metrics.js)

步骤：
1) 在测试数据库上运行 validate_counters.sql（替换 your_device 与时间范围）：

   mysql -u <user> -p -D lot_sensor < backend/server/tools/validate_counters.sql

   或者把文件打开，复制需要的单条 SQL 在客户端执行并替换占位符。

2) 检查输出：
   - mapping 行是否正确（db_name 是否为 field5/field6/field7，修正 filed6 拼写）；
   - 最近写入是否存在、数值是否为单调计数器；
   - 差分累计（delta 求和）结果是否合理；
   - 是否有异常大 delta（批量补写）或复位情况。

3) 将示例配置粘贴到 config/metrics.js 或 system-config.json 时注意：
   - 代码现有的 cumulativeService 假设 source_field 存的是原始瞬时值或开关。
   - 对于“累计计数器”字段，必须在查询层对计数器做差分再 SUM。可以：
     a) 在数据库查询里使用 LAG() + CASE 做差分（推荐、见 validate_counters.sql）；或
     b) 在写入环节改为写入“本条增量”而非计数器（需要上游修改）。

4) 风险与建议：
   - 若上游存在补写/批量写历史，差分会出现异常大值，需在查询里加阈值过滤或在上游保证写入顺序。
   - 若计数器可能被重置，确认重置策略并在查询中按需处理（示例用 "else value" 近似处理重置）。

需要我：
- 把示例配置合并到 `config/metrics.js`（只在你确认后执行）；或
- 帮你把 validate_counters.sql 中的占位符替换成具体 `d_no` 与时间范围并生成单次可执行 SQL（我会把结果贴出来供你复制执行）。

