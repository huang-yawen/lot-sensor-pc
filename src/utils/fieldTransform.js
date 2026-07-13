/**
 * 行为数据字段值转换
 * 与移动端 behaviorRealtime/behaviorHistory 的 transformValue 保持一致
 */

/**
 * 转换行为数据中的特定字段值
 * @param {string} key - 字段名
 * @param {*} val - 字段值
 * @returns {string} 转换后的字符串
 */
export const transformBehaviorValue = (key, val) => {
  if (val === null || val === undefined) return ''

  const numVal = Number(val)
  const isZero = numVal === 0 || val === '0'
  const isOne = numVal === 1 || val === '1'

  if (key.includes('开关')) {
    return isZero ? '关' : isOne ? '开' : String(val)
  }

  if (key.includes('控制模式')) {
    return isZero ? '手动' : isOne ? '自动' : String(val)
  }

  if (key.includes('空调模式')) {
    return isZero ? '制冷' : isOne ? '制热' : String(val)
  }

  return String(val)
}

/**
 * 对整行数据进行转换，返回新对象
 * @param {Object} item - 原始数据行
 * @returns {Object} 转换后的数据行
 */
export const transformBehaviorRow = (item) => {
  if (!item || typeof item !== 'object') return item
  const transformed = {}
  for (const [key, value] of Object.entries(item)) {
    transformed[key] = transformBehaviorValue(key, value)
  }
  return transformed
}

/**
 * 对数据列表进行转换
 * @param {Array} list - 原始数据列表
 * @returns {Array} 转换后的数据列表
 */
export const transformBehaviorList = (list) => {
  if (!Array.isArray(list)) return []
  return list.map(transformBehaviorRow)
}