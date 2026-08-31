/**
 * 安全算术表达式引擎。
 *
 * 支持：+ - * / %、括号、一元正负号，以及 abs/round/min/max/sqrt/pow。
 * 标识符只能来自调用方提供的白名单。表达式会解析成 AST，再分别生成 SQL
 * 或在内存中计算；绝不使用 eval/new Function，也不允许插入任意 SQL。
 *
 * 【为什么不能直接 eval】DERIVED_METRICS（派生指标公式）是用户在配置中心自己填的
 * 字符串，如果直接 eval/new Function 执行，等于把任意 JS 代码执行权限交给了
 * 能改配置的人——这是严重的代码注入风险。这里改用手写的 tokenize+parse 把输入
 * 严格限定成一棵只包含数字/白名单标识符/固定几个函数调用/四则运算的 AST，
 * 不认识的字符、不在白名单里的标识符、白名单外的函数名，全部在解析阶段直接报错，
 * 从语法层面就杜绝了执行任意代码或拼出任意 SQL 的可能。
 *
 * 【为什么要维护两套"消费 AST"的函数（compileSql 和 evaluate）】同一条用户自定义
 * 公式有两种使用场景：查历史图表时希望直接编译成 SQL 片段交给数据库算（可以配合
 * GROUP BY/聚合函数，性能更好，见 averageChartQuery.js）；处理单条实时 MQTT 消息
 * 时没必要为了算一个派生指标专门发一次 SQL 查询，直接在内存里对同一棵 AST 求值
 * 更直接（见 computedMetrics.js）。两个函数各自独立遍历同一棵 AST，互不依赖。
 */
const FUNCTION_RULES = {
  abs: { min: 1, max: 1, sql: 'ABS' },
  round: { min: 1, max: 2, sql: 'ROUND' },
  min: { min: 2, max: 20, sql: 'LEAST' },
  max: { min: 2, max: 20, sql: 'GREATEST' },
  sqrt: { min: 1, max: 1, sql: 'SQRT' },
  pow: { min: 2, max: 2, sql: 'POW' },
}

// 【词法分析】把字符串公式切成 token 序列（数字/标识符/运算符），逐字符扫描，
// 每种 token 类型试一次正则匹配，命中就前进对应长度；都不命中说明出现了不认识的
// 字符（比如公式里混进了分号、字母数字之外的符号），直接抛错定位到具体字符位置，
// 方便配置中心那边提示用户改哪里，而不是留到运行时才莫名其妙算出 NaN。
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

// 【语法分析】标准的递归下降解析器（recursive descent parser）。四个函数
// primary -> unary -> multiplicative -> additive 层层调用，层级本身就天然
// 体现了运算符优先级：additive（+ -）调用 multiplicative（* / %），
// multiplicative 调用 unary（一元正负号），unary 调用 primary（数字/标识符/
// 函数调用/括号子表达式）——越往里调用的运算符优先级越高，跟数学里"先乘除后
// 加减、括号最优先"完全对应，不需要额外写优先级表。
// allowedIdentifiers 白名单在这里校验（primary 函数里 `if (!allowed.has(name))`）：
// 公式只能引用调用方明确允许的字段名，防止公式意外/故意引用到不该暴露的数据库字段。
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

// 把 AST 递归翻译成一段 SQL 表达式字符串，交给数据库直接算（用于历史图表查询）。
// 除法/取模用 NULLIF(right, 0) 包一层：SQL 里除以 0 不会报错而是直接返回 NULL，
// 这里主动用 NULLIF 把 0 换成 NULL 只是让"除以 0"和"除以 NULL"走同一条路径，
// 结果都是 NULL（数据缺失），不会让整条 SQL 因为个别行除零而报错中断查询。
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

// 在内存里对同一棵 AST 求值（用于处理单条实时消息）。跟 compileSql 是完全独立的
// 第二条遍历路径，不复用也不依赖 compileSql 的结果。任何一个子节点算出 null
// （字段缺失、除以 0、sqrt 负数等），就沿着调用链一路返回 null，不让"缺一个字段"
// 变成"整个派生指标算出 NaN 还展示出去"——只要有一环数据不全，最终结果就是
// "本次不展示"，比算出一个错误数值更安全。
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
