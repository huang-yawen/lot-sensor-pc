/**
 * 【文件职责】手动判定 API 控制器 —— 页面上点「智能判定」按钮走的就是这里。
 *
 * 两个等价地址（同一份代码，历史原因保留两个）：
 *   POST /api/intelligent/judge
 *   POST /api/intelligent/recognize
 *
 * 它自己只干两件事：**校验参数** + **把异常翻译成 HTTP 状态码**；
 * 查库、调判定服务、落库都在 service/intelligent/intelligentJudgment.js 的 runManualJudgment 里；
 * 判定服务的地址/超时/字段路径在 service/intelligent/config.js。
 *
 * ══════════════ 请求 / 响应 ══════════════
 * 前端发：{ "type": "combined", "ids": [117027, 117028] }      ← 合并显示（组合数据/汇总数据页）
 *         { "type": "sensor",   "ids": [113331, 113332] }      ← 分开显示（传感器汇总页；该页已停用但接口仍在）
 *         { "type": "behavior", "ids": [114840] }              ← 分开显示（行为汇总页）
 *   · ids 必须是**对应表的行 id**：type=combined → t_scene_data.id；sensor → t_sensor_data.id；
 *     behavior → t_behavior_data.id。两张表的 id 是各自的自增序列，**不能混用**
 *     （混用会得到 404 "未找到待判定数据"）。
 *   · 一次最多 100 条（下面的 MAX_IDS）：前端全选上千条会被截断；再大也没意义，
 *     因为 t_judgment_record.source_ids 只有 varchar(1000)。
 *
 * 本文件回：{ "success": true, "data": { "results": [...], "conclusion": "...", "confidence": 0.9, "mock": false },
 *            "message": "智能判定完成" }
 *   · results     判定服务原样的结果数组（前端弹窗的"查看原始响应数据"显示的就是它）
 *   · conclusion  从结果里解析出的结论文字（可能是"正常/异常/干烧"等任意标签）
 *   · confidence  置信度，取不到是 null（0 是合法值）
 *   · mock        true 表示这是"本地占位判定"（判定服务未启用），不是真实结论
 *
 * 出错时的 HTTP 状态码（ERROR_STATUS 映射，没匹配上的一律 502）：
 *   · 400 参数不合法：type 不是 sensor/behavior/combined，或 ids 不是非空整数数组
 *   · 404 库里查不到这些 id（runManualJudgment 抛 NOT_FOUND）
 *   · 502 判定服务报错 / 响应不是合法 JSON / 网络错误（BAD_GATEWAY）
 *   · 504 判定服务超时（TIMEOUT，由 config.timeoutMs 控制）
 *   失败也会在 t_judgment_record 里留一条 status='failed' 的记录，方便事后查。
 *
 * ══════════════ 谁在调用 ══════════════
 *   src/views/CombinedHistory.vue  → type:'combined'（当前生效）
 *   src/views/SensorHistory.vue    → type:'sensor'   （页面已停用，改造回路由即可恢复）
 *   src/views/BehaviorHistory.vue  → type:'behavior' （同上）
 *   自测：
 *     curl -X POST http://127.0.0.1:3000/api/intelligent/judge \
 *          -H "Content-Type: application/json" -d "{\"type\":\"combined\",\"ids\":[117027]}"
 *
 * 【与判定相关但不在本文件】三种链路的公共逻辑、自动判定定时器、实时判定、结果落库都在
 * service/intelligent/intelligentJudgment.js；组合判定的字段名还原在 service/intelligent/combinedJudgment.js；
 * 判定结论触发的"关泵/关加热"联动在 service/judgmentAction/。
 * 详细手册见项目根目录 JUDGMENT_GUIDE.md。
 */
const { runManualJudgment, TYPE_TABLES } = require('../../service/intelligent/intelligentJudgment')

/** 一次判定最多取多少条记录，防止前端全选几千条把判定服务打挂。 */
const MAX_IDS = 100

/** runManualJudgment 抛出的错误码 -> HTTP 状态码。没匹配上的一律当成 502（判定服务报错）。 */
const ERROR_STATUS = { NOT_FOUND: 404, TIMEOUT: 504, BAD_GATEWAY: 502 }

module.exports = async (req, res) => {
  const type = req.body?.type
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(Number).filter(Number.isInteger))].slice(0, MAX_IDS) : []
  if (!TYPE_TABLES[type] || ids.length === 0) {
    return res.status(400).json({ success: false, message: 'type 必须是 sensor/behavior/combined，ids 必须是非空整数数组' })
  }

  try {
    const data = await runManualJudgment({ type, ids })
    return res.json({ success: true, data, message: data.mock ? '本地判定完成（服务未启用）' : '智能判定完成' })
  } catch (error) {
    console.error('[Judgment] 判定失败:', error.message)
    return res.status(ERROR_STATUS[error.code] || 502).json({ success: false, message: error.message })
  }
}
