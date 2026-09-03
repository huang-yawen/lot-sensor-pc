/** 【文件职责】派生指标计算服务。
 * 【配置中心关联】DERIVED_METRICS 定义表达式和依赖字段，按请求动态读取。 */
const promisePool = require('../../config/dbPool')
const { parseExpression, compileSql, evaluate } = require('./expressionEngine')

// 公式里能用的标识符白名单：field1~field10，对应 t_sensor_data 预留的 10 个
// 通用字段槽位。parseExpression 只认这个名单里的名字，公式里写别的标识符会在
// 解析阶段直接报错，不会漏到 SQL 里去。
const BASE_FIELDS = Array.from({ length: 10 }, (_, index) => `field${index + 1}`)
// ensureTable() 返回的建表 Promise 缓存在这里，避免同一次进程里被多个并发
// 请求同时调用时反复尝试建表（第二次调用直接拿到同一个 Promise 等待它完成）。
let ensurePromise = null

/** 老库升级：给已存在的 t_derived_metric 表补 show_history_chart 列。
 * 列已存在时 MySQL 报"重复列名"（ER_DUP_FIELDNAME / errno 1060），直接忽略；其余错误照常抛出。 */
async function ensureHistoryChartColumn() {
  try {
    await promisePool.query('ALTER TABLE t_derived_metric ADD COLUMN show_history_chart TINYINT(1) NOT NULL DEFAULT 1 AFTER show_chart')
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME' && error.errno !== 1060) throw error
  }
}

/**
 * 确保 t_derived_metric 这张表存在（懒建表：第一次调用时才真的去建，之后
 * 复用缓存的 Promise，不会每次请求都执行一遍 CREATE TABLE）。
 * 建表失败时把缓存清空（ensurePromise = null），下次调用会重新尝试建表，
 * 而不是一直卡在一个失败的 Promise 上永远好不了。
 */
function ensureTable() {
  if (ensurePromise) return ensurePromise
  ensurePromise = promisePool.query(`CREATE TABLE IF NOT EXISTS t_derived_metric (
    id INT NOT NULL AUTO_INCREMENT,
    metric_key VARCHAR(64) NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    formula VARCHAR(1000) NOT NULL,
    unit VARCHAR(64) DEFAULT NULL,
    precision_digits INT NOT NULL DEFAULT 2,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    show_realtime TINYINT(1) NOT NULL DEFAULT 1,
    show_history TINYINT(1) NOT NULL DEFAULT 1,
    show_chart TINYINT(1) NOT NULL DEFAULT 1,
    show_history_chart TINYINT(1) NOT NULL DEFAULT 1,
    chart_type VARCHAR(16) NOT NULL DEFAULT 'line',
    y_axis VARCHAR(16) NOT NULL DEFAULT 'left',
    color VARCHAR(16) DEFAULT NULL,
    y_min DECIMAL(20,6) DEFAULT NULL,
    y_max DECIMAL(20,6) DEFAULT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    PRIMARY KEY (id), UNIQUE KEY uk_metric_key (metric_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8`)
    .then(() => ensureHistoryChartColumn())
    .catch(error => { ensurePromise = null; throw error })
  return ensurePromise
}

/**
 * 校验并规整一条自定义指标的表单数据：把前端传来的原始字段转成正确的类型
 * （数字、布尔转 0/1），补齐没填的字段用默认值，然后依次检查每个字段是否
 * 合法（标识符格式、名称非空、精度范围、图表类型、颜色格式、Y 轴范围）。
 * 最后一步 parseExpression 会把公式字符串解析成 AST，公式写错了（用了白名单
 * 之外的标识符、语法错误）会在这里直接抛出异常，调用方不需要再单独校验公式。
 * @throws {Error} 任意一项校验不通过就抛出，错误信息可以直接展示给用户
 * @returns {Object} 规整后的指标对象，多了一个 ast 字段（解析好的表达式树）
 */
function validateMetric(input) {
  const metric = {
    metric_key: String(input.metric_key || '').trim(),
    metric_name: String(input.metric_name || '').trim(),
    formula: String(input.formula || '').trim(),
    unit: String(input.unit || '').trim(),
    precision_digits: Number(input.precision_digits ?? 2),
    enabled: input.enabled === false || Number(input.enabled) === 0 ? 0 : 1,
    show_realtime: input.show_realtime === false || Number(input.show_realtime) === 0 ? 0 : 1,
    show_history: input.show_history === false || Number(input.show_history) === 0 ? 0 : 1,
    show_chart: input.show_chart === false || Number(input.show_chart) === 0 ? 0 : 1,
    // 历史图表页面现在所有图表都是查 t_sensor_data，公式如果引用了行为数据字段，
    // 放到历史图表里跑不通——这个限制由前端勾选框旁边的提示文案说明，这里不做拦截。
    show_history_chart: input.show_history_chart === false || Number(input.show_history_chart) === 0 ? 0 : 1,
    chart_type: String(input.chart_type || 'line'),
    y_axis: String(input.y_axis || 'left'),
    color: input.color ? String(input.color) : null,
    y_min: input.y_min === '' || input.y_min == null ? null : Number(input.y_min),
    y_max: input.y_max === '' || input.y_max == null ? null : Number(input.y_max),
    sort_order: Number(input.sort_order || 0),
  }
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(metric.metric_key)) throw new Error('指标标识必须以小写字母开头，只能包含小写字母、数字和下划线，长度 2-64')
  if (!metric.metric_name) throw new Error('指标名称不能为空')
  if (!Number.isInteger(metric.precision_digits) || metric.precision_digits < 0 || metric.precision_digits > 6) throw new Error('小数位数必须是 0-6 的整数')
  if (!['line', 'bar'].includes(metric.chart_type)) throw new Error('图表类型只能是 line 或 bar')
  if (!['left', 'right'].includes(metric.y_axis)) throw new Error('Y 轴只能是 left 或 right')
  if (metric.color && !/^#[0-9a-fA-F]{6}$/.test(metric.color)) throw new Error('颜色必须是 #RRGGBB 格式')
  if (metric.y_min != null && !Number.isFinite(metric.y_min)) throw new Error('Y轴最小值必须是数字')
  if (metric.y_max != null && !Number.isFinite(metric.y_max)) throw new Error('Y轴最大值必须是数字')
  if (metric.y_min != null && metric.y_max != null && metric.y_min >= metric.y_max) throw new Error('Y轴最小值必须小于最大值')
  metric.ast = parseExpression(metric.formula, BASE_FIELDS)
  return metric
}

/**
 * 查询配置中心"公式与图表"页面要用的两份数据：已经配置的全部自定义指标，
 * 和当前可见的传感器字段列表（后者给页面上"插入字段"这类辅助操作用，
 * 让用户不用死记 field1~field10 分别对应哪个物理量）。
 */
async function listMetrics() {
  await ensureTable()
  const [metrics] = await promisePool.query('SELECT * FROM t_derived_metric ORDER BY sort_order, id')
  const [fields] = await promisePool.query('SELECT id, f_name, db_name, p_name, unit FROM t_sensor_field_mapper WHERE visible = 1 ORDER BY id')
  return { metrics, fields }
}

/**
 * 新增或更新一条自定义指标：input.id 有值就按 id 更新，否则新增一条。
 * 校验通过后才会真的写库（validateMetric 校验不通过会直接抛异常，走不到
 * 这里的 UPDATE/INSERT）。
 */
async function saveMetric(input) {
  await ensureTable()
  const metric = validateMetric(input)
  const values = [metric.metric_key, metric.metric_name, metric.formula, metric.unit, metric.precision_digits, metric.enabled, metric.show_realtime, metric.show_history, metric.show_chart, metric.show_history_chart, metric.chart_type, metric.y_axis, metric.color, metric.y_min, metric.y_max, metric.sort_order]
  if (input.id) {
    await promisePool.execute(`UPDATE t_derived_metric SET metric_key=?, metric_name=?, formula=?, unit=?, precision_digits=?, enabled=?, show_realtime=?, show_history=?, show_chart=?, show_history_chart=?, chart_type=?, y_axis=?, color=?, y_min=?, y_max=?, sort_order=? WHERE id=?`, [...values, Number(input.id)])
    return { id: Number(input.id), ...metric, ast: undefined }
  }
  const [result] = await promisePool.execute(`INSERT INTO t_derived_metric (metric_key, metric_name, formula, unit, precision_digits, enabled, show_realtime, show_history, show_chart, show_history_chart, chart_type, y_axis, color, y_min, y_max, sort_order) VALUES (${values.map(() => '?').join(',')})`, values)
  return { id: result.insertId, ...metric, ast: undefined }
}

/** 删除一条自定义指标，返回是否真的删掉了（id 不存在时返回 false，不报错）。 */
async function deleteMetric(id) {
  await ensureTable()
  const [result] = await promisePool.execute('DELETE FROM t_derived_metric WHERE id = ?', [Number(id)])
  return result.affectedRows > 0
}

/**
 * 查出当前"启用"的自定义指标，可选按展示场景再过滤一层。一条指标除了总开关
 * enabled，还有三个独立的展示位置开关（show_realtime 首页实时、show_history
 * 历史表格、show_history_chart 历史图表），互不影响，用户可以让同一条指标
 * 只出现在某一个地方。
 * @param {'realtime'|'history'|'historyChart'|undefined} visibility - 只看
 *   哪个展示场景；不传就只按总开关 enabled 过滤，不管三个展示位置开关
 */
async function getEnabledMetrics(visibility) {
  await ensureTable()
  const allowed = { realtime: 'show_realtime', history: 'show_history', historyChart: 'show_history_chart' }
  const column = allowed[visibility]
  const where = column ? `WHERE enabled = 1 AND ${column} = 1` : 'WHERE enabled = 1'
  const [rows] = await promisePool.query(`SELECT * FROM t_derived_metric ${where} ORDER BY sort_order, id`)
  return rows
}

/**
 * 把一条指标的公式编译成一段 SQL 表达式，供历史图表查询直接拼进 SQL 里用
 * （具体怎么用见 derivedMetricHistoryQuery.js）。每个标识符（field1 这种）
 * 都包一层 CAST(NULLIF(...), '') AS DECIMAL(20,6))，跟项目里其它地方读数值
 * 字段的写法一致：空字符串转成 NULL、字符串统一转十进制数字，防止空值直接
 * 参与四则运算时数据库报错或者算出奇怪的结果。
 * @param {Object} metric - 指标对象（用到 formula、precision_digits）
 * @param {string} [tableAlias] - 如果这段表达式要拼进一个带别名的子查询里，
 *   传别名会把字段名加上 "别名." 前缀，不传就是裸字段名
 */
function compileMetricSql(metric, tableAlias = '') {
  const ast = parseExpression(metric.formula, BASE_FIELDS)
  const prefix = tableAlias ? `${tableAlias}.` : ''
  const expression = compileSql(ast, name => `CAST(NULLIF(${prefix}\`${name}\`, '') AS DECIMAL(20,6))`)
  return `ROUND(${expression}, ${Number(metric.precision_digits)})`
}

/**
 * 配置页面"预览"按钮用：不落库，只是拿用户填的公式和几个示例数值直接算一次
 * 结果，也顺便把编译出来的 SQL 表达式一起返回，方便用户在保存前确认公式
 * 写对了、SQL 也生成得合理。
 */
function previewMetric(input, values = {}) {
  const metric = validateMetric(input)
  const result = evaluate(metric.ast, values)
  return { result: result == null ? null : Number(result.toFixed(metric.precision_digits)), sql: compileMetricSql(metric) }
}

/**
 * 把一批指标转换成前端图表组件要用的设置对象，按 metric_name 做 key（历史
 * 图表页面拿到某条曲线的名字后，直接用这个对象查它的颜色/Y轴/可见性等
 * 展示配置，不用再去数组里遍历查找）。
 */
function chartSettings(metrics) {
  return Object.fromEntries(metrics.map(metric => [metric.metric_name, {
    metricKey: metric.metric_key,
    visible: Boolean(metric.show_chart),
    type: metric.chart_type,
    yAxis: metric.y_axis,
    color: metric.color,
    min: metric.y_min == null ? null : Number(metric.y_min),
    max: metric.y_max == null ? null : Number(metric.y_max),
    unit: metric.unit || '',
  }]))
}

module.exports = { BASE_FIELDS, ensureTable, validateMetric, listMetrics, saveMetric, deleteMetric, getEnabledMetrics, compileMetricSql, previewMetric, chartSettings }
/** 【文件职责】派生指标服务，读取原始指标并调用表达式引擎生成计算结果。
 * 【配置中心关联】DERIVED_METRICS；配置项定义名称、依赖字段和计算表达式。 */
