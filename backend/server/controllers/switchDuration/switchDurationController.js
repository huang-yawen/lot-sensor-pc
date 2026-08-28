/** 【文件职责】首页开关运行时长 API 控制器。
 * 【配置中心关联】CUMULATIVE_METRICS 在服务层动态读取；SWITCH_DURATION_DISPLAY.enabled
 * 由前端自行判断是否请求本接口，本控制器不做总开关拦截。 */
const switchDurationService = require('../../service/switchDuration/switchDurationService')

/**
 * GET /api/switch-duration
 * Query: ?d_no=xxx（单设备模式可不传）
 */
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
