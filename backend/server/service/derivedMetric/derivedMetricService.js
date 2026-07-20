const promisePool = require('../../config/dbPool')
const { parseExpression, compileSql, evaluate } = require('./expressionEngine')

const BASE_FIELDS = Array.from({ length: 10 }, (_, index) => `field${index + 1}`)
let ensurePromise = null

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
    chart_type VARCHAR(16) NOT NULL DEFAULT 'line',
    y_axis VARCHAR(16) NOT NULL DEFAULT 'left',
    color VARCHAR(16) DEFAULT NULL,
    y_min DECIMAL(20,6) DEFAULT NULL,
    y_max DECIMAL(20,6) DEFAULT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    PRIMARY KEY (id), UNIQUE KEY uk_metric_key (metric_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8`).catch(error => { ensurePromise = null; throw error })
  return ensurePromise
}

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

async function listMetrics() {
  await ensureTable()
  const [metrics] = await promisePool.query('SELECT * FROM t_derived_metric ORDER BY sort_order, id')
  const [fields] = await promisePool.query('SELECT id, f_name, db_name, p_name, unit FROM t_sensor_field_mapper WHERE visible = 1 ORDER BY id')
  return { metrics, fields }
}

async function saveMetric(input) {
  await ensureTable()
  const metric = validateMetric(input)
  const values = [metric.metric_key, metric.metric_name, metric.formula, metric.unit, metric.precision_digits, metric.enabled, metric.show_realtime, metric.show_history, metric.show_chart, metric.chart_type, metric.y_axis, metric.color, metric.y_min, metric.y_max, metric.sort_order]
  if (input.id) {
    await promisePool.execute(`UPDATE t_derived_metric SET metric_key=?, metric_name=?, formula=?, unit=?, precision_digits=?, enabled=?, show_realtime=?, show_history=?, show_chart=?, chart_type=?, y_axis=?, color=?, y_min=?, y_max=?, sort_order=? WHERE id=?`, [...values, Number(input.id)])
    return { id: Number(input.id), ...metric, ast: undefined }
  }
  const [result] = await promisePool.execute(`INSERT INTO t_derived_metric (metric_key, metric_name, formula, unit, precision_digits, enabled, show_realtime, show_history, show_chart, chart_type, y_axis, color, y_min, y_max, sort_order) VALUES (${values.map(() => '?').join(',')})`, values)
  return { id: result.insertId, ...metric, ast: undefined }
}

async function deleteMetric(id) {
  await ensureTable()
  const [result] = await promisePool.execute('DELETE FROM t_derived_metric WHERE id = ?', [Number(id)])
  return result.affectedRows > 0
}

async function getEnabledMetrics(visibility) {
  await ensureTable()
  const allowed = { realtime: 'show_realtime', history: 'show_history' }
  const column = allowed[visibility]
  const where = column ? `WHERE enabled = 1 AND ${column} = 1` : 'WHERE enabled = 1'
  const [rows] = await promisePool.query(`SELECT * FROM t_derived_metric ${where} ORDER BY sort_order, id`)
  return rows
}

function compileMetricSql(metric, tableAlias = '') {
  const ast = parseExpression(metric.formula, BASE_FIELDS)
  const prefix = tableAlias ? `${tableAlias}.` : ''
  const expression = compileSql(ast, name => `CAST(NULLIF(${prefix}\`${name}\`, '') AS DECIMAL(20,6))`)
  return `ROUND(${expression}, ${Number(metric.precision_digits)})`
}

function previewMetric(input, values = {}) {
  const metric = validateMetric(input)
  const result = evaluate(metric.ast, values)
  return { result: result == null ? null : Number(result.toFixed(metric.precision_digits)), sql: compileMetricSql(metric) }
}

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
