/** 【文件职责】把一条事件写进故障记录表 t_error_msg，供前端"告警记录 / 故障记录"
 * 页面查看（表格 + 按类型统计的饼图）。
 *
 * 为什么要抽出来：安全联锁（safetyInterlock.js 的 recordAlarm）、故障状态机
 * （faultStatus.js 的 recordAlarm）、正常状况联动（linkageRules.js 的 recordLinkageAlarm）
 * 三处原本各自手写了一条**一模一样**的 INSERT——同样的表、同样的 5 个字段、同样用
 * nowLocalDateTime() 取时间，唯一的区别只是 type 字段的值不同（'安全联锁' / '安全告警' /
 * '故障保护' / '联动控制'）。三份拷贝里改一处忘了改另外两处就会出问题，统一成一个函数，
 * 各调用方只负责拼自己的 message、传自己的 type。
 *
 * 字段对应：
 *   d_no    - 设备号，deviceNo 为空（全局配置 / 单设备模式）时写 null
 *   c_time  - 事件时间。默认用服务器本地时间 nowLocalDateTime()（不是 UTC，避免
 *             toISOString() 的 8 小时时差）。需要用"设备上报时间"的调用方（如告警规则
 *             evaluateRules）自己把 time 传进来。
 *   e_msg   - 事件描述文本，由调用方拼好
 *   e_no    - 事件代码：故障 id（dry_burn ...）/ 安全联锁触发 id / 联动规则 key。
 *             errorTypeNames.js 会拿这个去查中文名。为空时写 null。
 *   type    - 事件类型，决定前端归到哪个板块、饼图怎么分类
 *
 * @param {Object}        p
 * @param {string|null}   p.deviceNo - 设备号
 * @param {string}        p.message  - 事件描述（e_msg）
 * @param {string|number} p.code     - 事件代码（e_no）
 * @param {string}        p.type     - 事件类型（'安全联锁' | '安全告警' | '故障保护' | '联动控制' 等）
 * @param {string}        [p.time]   - c_time，缺省用服务器本地时间
 * 【配置】无。 */
const promisePool = require('../../config/dbPool')
const { nowLocalDateTime } = require('../../utils/helper')

async function recordEvent({ deviceNo, message, code, type, time }) {
  await promisePool.execute(
    'INSERT INTO t_error_msg (d_no, c_time, e_msg, e_no, type) VALUES (?, ?, ?, ?, ?)',
    [deviceNo || null, time || nowLocalDateTime(), message, code ?? null, type]
  )
}

module.exports = { recordEvent }
