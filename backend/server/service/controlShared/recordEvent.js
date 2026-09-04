/** 【文件职责】把一条事件写进故障记录表 t_error_msg，供"告警记录 / 故障记录"页面查看。
 * 安全联锁（safetyInterlock.js）、故障状态机（faultStatus.js）、正常状况联动
 * （linkageRules.js）三处原本各自手写同一条 INSERT，只有 type 字段值不同——这里
 * 统一成一个函数，各调用方只负责拼 message / 决定 type。
 *
 * @param {Object}        p
 * @param {string|null}   p.deviceNo - 设备号，空则写 null
 * @param {string}        p.message  - 事件描述（e_msg）
 * @param {string|number} p.code     - 事件代码（e_no）：故障 id / 规则 key 等
 * @param {string}        p.type     - 事件类型：'安全联锁' | '安全告警' | '故障保护' | '联动控制' 等
 * @param {string}        [p.time]   - c_time，缺省用服务器本地时间（设备上报时间需要调用方显式传）
 * 【配置中心关联】无。 */
const promisePool = require('../../config/dbPool')
const { nowLocalDateTime } = require('../../utils/helper')

async function recordEvent({ deviceNo, message, code, type, time }) {
  await promisePool.execute(
    'INSERT INTO t_error_msg (d_no, c_time, e_msg, e_no, type) VALUES (?, ?, ?, ?, ?)',
    [deviceNo || null, time || nowLocalDateTime(), message, code ?? null, type]
  )
}

module.exports = { recordEvent }
