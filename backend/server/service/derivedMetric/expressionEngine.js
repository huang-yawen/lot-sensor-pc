/**
 * 安全算术表达式引擎。
 *
 * 支持：+ - * / %、括号、一元正负号，以及 abs/round/min/max/sqrt/pow。
 * 标识符只能来自调用方提供的白名单。表达式会解析成 AST，再分别生成 SQL
 * 或在内存中计算；绝不使用 eval/new Function，也不允许插入任意 SQL。
 */
const FUNCTION_RULES = {
  abs: { min: 1, max: 1, sql: 'ABS' },
  round: { min: 1, max: 2, sql: 'ROUND' },
  min: { min: 2, max: 20, sql: 'LEAST' },
  max: { min: 2, max: 20, sql: 'GREATEST' },
  sqrt: { min: 1, max: 1, sql: 'SQRT' },
  pow: { min: 2, max: 2, sql: 'POW' },
}

function tokenize(input) {
  const tokens = []
  let index = 0
  while (index < input.length) {
    const rest = input.slice(index)
    const space = rest.match(/^\s+/)
    if (space) { index += space[0].length; continue }
    const number = rest.match(/^(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/)
    if (number) { tokens.push({ type: 'number', value: Number(number[0]) }); index += number[0].length; continue }
    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/)
    if (identifier) { tokens.push({ type: 'identifier', value: identifier[0] }); index += identifier[0].length; continue }
    if ('+-*/%(),'.includes(rest[0])) { tokens.push({ type: rest[0], value: rest[0] }); index += 1; continue }
    throw new Error(`公式第 ${index + 1} 个字符无法识别: ${rest[0]}`)
  }
  tokens.push({ type: 'eof' })
  return tokens
}

function parseExpression(input, allowedIdentifiers) {
  if (!String(input || '').trim()) throw new Error('公式不能为空')
  const allowed = new Set(allowedIdentifiers)
  const tokens = tokenize(String(input))
  let position = 0
  const current = () => tokens[position]
  const consume = (type) => {
    if (current().type !== type) throw new Error(`公式语法错误：期望 ${type}，实际为 ${current().value || current().type}`)
    return tokens[position++]
  }

  function primary() {
    if (current().type === 'number') return { type: 'number', value: consume('number').value }
    if (current().type === 'identifier') {
      const name = consume('identifier').value
      if (current().type === '(') {
        const rule = FUNCTION_RULES[name.toLowerCase()]
        if (!rule) throw new Error(`不支持函数 ${name}`)
        consume('(')
        const args = []
        if (current().type !== ')') {
          args.push(additive())
          while (current().type === ',') { consume(','); args.push(additive()) }
        }
        consume(')')
        if (args.length < rule.min || args.length > rule.max) throw new Error(`${name} 参数数量必须为 ${rule.min}${rule.max === rule.min ? '' : `-${rule.max}`} 个`)
        return { type: 'call', name: name.toLowerCase(), args }
      }
      if (!allowed.has(name)) throw new Error(`字段 ${name} 不在可用字段中`)
      return { type: 'identifier', name }
    }
    if (current().type === '(') { consume('('); const node = additive(); consume(')'); return node }
    throw new Error(`公式语法错误：无法处理 ${current().value || current().type}`)
  }

  function unary() {
    if (current().type === '+' || current().type === '-') {
      return { type: 'unary', operator: tokens[position++].type, value: unary() }
    }
    return primary()
  }

  function multiplicative() {
    let node = unary()
    while (['*', '/', '%'].includes(current().type)) {
      node = { type: 'binary', operator: tokens[position++].type, left: node, right: unary() }
    }
    return node
  }

  function additive() {
    let node = multiplicative()
    while (['+', '-'].includes(current().type)) {
      node = { type: 'binary', operator: tokens[position++].type, left: node, right: multiplicative() }
    }
    return node
  }

  const ast = additive()
  if (current().type !== 'eof') throw new Error(`公式末尾存在多余内容: ${current().value}`)
  return ast
}

function compileSql(ast, columnSql) {
  if (ast.type === 'number') return Number(ast.value).toString()
  if (ast.type === 'identifier') return columnSql(ast.name)
  if (ast.type === 'unary') return `(${ast.operator}${compileSql(ast.value, columnSql)})`
  if (ast.type === 'binary') {
    const left = compileSql(ast.left, columnSql)
    const right = compileSql(ast.right, columnSql)
    if (ast.operator === '/') return `(${left} / NULLIF(${right}, 0))`
    if (ast.operator === '%') return `MOD(${left}, NULLIF(${right}, 0))`
    return `(${left} ${ast.operator} ${right})`
  }
  if (ast.type === 'call') {
    const rule = FUNCTION_RULES[ast.name]
    return `${rule.sql}(${ast.args.map(arg => compileSql(arg, columnSql)).join(', ')})`
  }
  throw new Error('未知公式节点')
}

function evaluate(ast, values) {
  if (ast.type === 'number') return ast.value
  if (ast.type === 'identifier') {
    const value = Number(values[ast.name])
    return Number.isFinite(value) ? value : null
  }
  if (ast.type === 'unary') {
    const value = evaluate(ast.value, values)
    return value == null ? null : ast.operator === '-' ? -value : value
  }
  if (ast.type === 'binary') {
    const left = evaluate(ast.left, values)
    const right = evaluate(ast.right, values)
    if (left == null || right == null) return null
    if ((ast.operator === '/' || ast.operator === '%') && right === 0) return null
    return { '+': left + right, '-': left - right, '*': left * right, '/': left / right, '%': left % right }[ast.operator]
  }
  if (ast.type === 'call') {
    const args = ast.args.map(arg => evaluate(arg, values))
    if (args.some(value => value == null)) return null
    if (ast.name === 'abs') return Math.abs(args[0])
    if (ast.name === 'round') { const factor = 10 ** (args[1] ?? 0); return Math.round(args[0] * factor) / factor }
    if (ast.name === 'min') return Math.min(...args)
    if (ast.name === 'max') return Math.max(...args)
    if (ast.name === 'sqrt') return args[0] < 0 ? null : Math.sqrt(args[0])
    if (ast.name === 'pow') return Math.pow(args[0], args[1])
  }
  return null
}

module.exports = { parseExpression, compileSql, evaluate }
/** 【文件职责】受限表达式计算引擎，为派生指标执行经过校验的数学表达式。
 * 【配置中心关联】不直接读取；由 DERIVED_METRICS 提供表达式，调用方必须先校验。 */
