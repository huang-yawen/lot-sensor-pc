/** 【文件职责】查询当前控制模式（手动/自动）。
 * 指令中心里 preffix='auto_control_enabled' 的开关就是页面上的"控制模式"：
 * 值为 on/auto/open/1/true 时是自动，off/manual/close/0/false 时是手动。
 * safetyInterlock.js、linkageRules.js、pidHeating.js 都用这个
 * 函数判断当前是不是手动模式，统一走同一套查询逻辑，不再各自复制一份。
 * 【配置】无直接读取；开关的值存在 t_direct 表，由指令中心页面下发。 */
const promisePool = require('../../config/dbPool')
const { getDirectValue } = require('./saveDirectConfig')

async function resolveModeConfigId() {
  const [rows] = await promisePool.query(
    "SELECT id FROM t_direct_config WHERE preffix IS NOT NULL AND preffix != '' AND LOWER(preffix) = LOWER(?) ORDER BY id ASC LIMIT 1",
    ['auto_control_enabled']
  )
  return rows[0]?.id ?? null
}

/** 当前控制模式：'auto' | 'manual' | null（查不到配置项或没有值时）。 */
async function getCurrentMode(deviceNo) {
  const configId = await resolveModeConfigId()
  if (configId == null) return null
  const value = await getDirectValue({ config_id: configId, d_no: deviceNo })
  if (value == null) return null
  const v = String(value).trim().toLowerCase()
  if (['on', 'auto', 'open', '1', 'true'].includes(v)) return 'auto'
  if (['off', 'manual', 'close', '0', 'false'].includes(v)) return 'manual'
  return null
}

module.exports = { getCurrentMode }
