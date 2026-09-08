/**
 * 【接口】GET /api/system-config —— 只读返回拼装后的完整配置
 *
 * 请求：无参数
 * 响应 200：{ success:true, data:{ SYSTEM_TITLE, TERMINOLOGY, SINGLE_DEVICE_MODE,
 *              HISTORY_CHARTS, INTELLIGENT_JUDGMENT, SAFETY_INTERLOCK, ... 全部配置项 } }
 *
 * 前端所有页面经 SystemConfigStore / DisplayStore 读这个（标题/术语/字段显隐/页面开关）。
 * 配置本身是代码常量（config/*.js），此接口只读不写；要改配置改对应 config.js，
 * 清单见 config/systemConfig.js 顶部。
 */
const systemConfig = require('../../config/systemConfig')

const getConfig = (req, res) => {
  res.json({ success: true, data: systemConfig.getConfig() })
}

module.exports = { getConfig }
