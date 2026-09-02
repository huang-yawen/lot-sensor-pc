/**
 * 【文件职责】PID 自整定结果应用接口。
 * 把 PID_AUTOTUNE.result 里的建议 Kp/Ki/Kd 写入指令中心对应的三个指令项，复用手动
 * 改指令同一套持久化和操作历史逻辑；Kp/Ki/Kd 是本地参数（没有 preffix），不下发 MQTT。
 * 【配置中心关联】读取 systemConfig.PID_AUTOTUNE.result，不修改配置中心本身。
 *
 * POST /api/pid-autotune/apply
 * Body: { d_no }（可选，多设备模式下指定目标设备；单设备模式忽略）
 */
const systemConfig = require('../../config/systemConfig')
const { getDirectValue, saveDirectData } = require('../../service/directData/saveDirectConfig')
const { saveOperationHistory } = require('../../service/operationHistory/saveOperationHistory')
const { resolveConfigIdByPrefix } = require('../../service/pidHeating/pidHeating')
const { getDefaultDeviceId } = require('../../utils/mappedData')

// PID 自整定结果写入指令中心时用 preffix 定位指令项（数据库已在 init/fix_pid_prefix.js 补好）
const PARAM_PREFIXES = {
  kp: 'pid_kp',
  ki: 'pid_ki',
  kd: 'pid_kd',
}

const applyAutoTuneResult = async (req, res) => {
  try {
    const config = systemConfig.getConfig()
    const result = config.PID_AUTOTUNE?.result
    if (!result) {
      return res.status(400).json({ success: false, message: '没有可应用的自整定结果，请先完成一次自整定' })
    }

    // 单设备模式下 t_direct 里 Kp/Ki/Kd 是按真实设备号存取的，不是 d_no=NULL；这里必须用
    // 同一个真实设备号写入，否则 PID 主循环（用真实设备号读）永远看不到这次写入的新值。
    const dNo = config.SINGLE_DEVICE_MODE === true ? await getDefaultDeviceId() : (req.body?.d_no ?? null)

    const applied = {}
    for (const [key, prefix] of Object.entries(PARAM_PREFIXES)) {
      const configId = await resolveConfigIdByPrefix(prefix)
      if (configId == null) continue
      const value = String(result[key])
      const oldValue = await getDirectValue({ config_id: configId, d_no: dNo })
      await saveDirectData({ config_id: configId, value, d_no: dNo })
      await saveOperationHistory({ d_no: dNo, config_id: configId, old_value: oldValue, new_value: value, source: 'auto_tune' })
      applied[key] = result[key]
    }

    if (!Object.keys(applied).length) {
      return res.status(500).json({ success: false, message: '指令中心未找到 Kp/Ki/Kd 对应的指令项（preffix=pid_kp/ki/kd），无法应用' })
    }

    res.json({ success: true, message: '自整定建议值已写入指令中心，立即生效', data: applied })
  } catch (err) {
    console.error('[PidAutoTune] 应用结果失败:', err)
    res.status(500).json({ success: false, message: '应用失败: ' + err.message })
  }
}

module.exports = { applyAutoTuneResult }
