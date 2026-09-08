/**
 * 【接口】GET /api/switch-duration —— 首页"水泵/加热运行时长"卡片数据
 *
 * 请求 query：d_no（可选，单设备模式可不传）
 * 响应 200：{ success:true, data:{
 *              pump:   { fieldLabel, isOn, totalMinutes, currentSessionMinutes } | null,
 *              heater: { fieldLabel, isOn, totalMinutes, currentSessionMinutes } | null } }
 *           对应指标在 config/metrics.js 里被删除/改名时该项为 null。
 * 出错 500：{ success:false, message }
 *
 * 数据来自 CUMULATIVE_METRICS 里 cumulative_pump_time / cumulative_heat_time 两条累计指标。
 * 是否显示这个卡片由前端按 SWITCH_DURATION_DISPLAY.enabled 判断，本接口不拦截。
 * 计算在 service/switchDuration/switchDurationService.js。
 */
const switchDurationService = require('../../service/switchDuration/switchDurationService')

module.exports = async (req, res) => {
  try {
    const d_no = req.query.d_no || null
    const data = await switchDurationService.getSwitchDurationSummary(d_no)
    res.json({ success: true, data })
  } catch (err) {
    console.error('[SwitchDurationController] 查询失败:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}
