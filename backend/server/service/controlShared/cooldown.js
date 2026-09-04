/** 【文件职责】"设备 + 触发类型"维度的触发冷却，安全联锁（safetyInterlock.js）和
 * 故障状态机（faultStatus.js）共用同一份实现。
 *
 * 为什么要冷却：这两个模块都是"每收到一条 MQTT 上报就评估一次"。如果某个异常条件
 * 持续满足（比如流量一直低于下限），不加冷却的话，设备每秒上报几次，就会每秒都关一次
 * 水泵、每秒都往 t_error_msg 写一条告警——执行器被反复下发、故障记录页被刷屏。冷却的
 * 作用是：同一个"设备 + 触发类型"处理过一次后，在 cooldownMs 时间内即使条件仍然满足
 * 也直接跳过，等冷却期过了才重新处理。
 *
 * 为什么用 createCooldown() 工厂、而不是直接导出一个共享的 Map：
 * 安全联锁和故障机各自 createCooldown() 拿一份**独立**的计时状态。两边的 trigger.id
 * 目前并不重叠（安全联锁是 flow_low / pressure_high / manual_mode ... ，故障机是
 * dry_burn / pipe_blockage ...），就算共用一张表也不会撞 key；但拆开各持一份，行为跟
 * "重构前每个模块自己维护一个 lastFired Map"完全一致，将来两边万一用了同名 id 也不会
 * 相互干扰，更保险。
 *
 * key 统一约定为 `${deviceNo || 'global'}:${triggerId}`（deviceNo 为空的全局配置用
 * 'global' 占位）。冷却时长 cooldownMs 由调用方按各自的配置项传入（安全联锁读
 * SAFETY_INTERLOCK.alarmCooldownMs，故障机读 FAULT_STATUS.alarmCooldownMs，默认都是 30000）。
 * 【配置中心关联】无（本模块不读配置，时长由调用方传入）。 */

/**
 * 创建一份独立的冷却计时器。返回的三个函数共享同一个内部 Map（闭包），互不影响其它
 * createCooldown() 实例。
 * @returns {{withinCooldown: Function, markFired: Function, clearForDevice: Function}}
 */
function createCooldown() {
  /** key（`设备:触发类型`）-> 上次触发时间戳（ms）。只存在内存里，进程重启即清空。 */
  const lastFired = new Map()

  /** 这个 key 是不是还在冷却期内：cooldownMs 毫秒内已经处理过一次就返回 true，
   * 调用方据此直接跳过本次触发（不关执行器、不写告警）。没记录过（从没触发过）时
   * last 取 0，Date.now() - 0 远大于 cooldownMs，返回 false，正常放行。 */
  function withinCooldown(key, cooldownMs) {
    const last = lastFired.get(key) || 0
    return Date.now() - last < cooldownMs
  }

  /** 记下这个 key 本次的触发时间，作为下一次 withinCooldown 的判断基准。
   * 调用方应在"确认要处理这次触发"之后、真正动手之前调用。 */
  function markFired(key) {
    lastFired.set(key, Date.now())
  }

  /**
   * 清掉某设备名下的所有冷却记录（key 形如 `${deviceNo || 'global'}:${triggerId}`，
   * 按 `设备:` 前缀匹配删除）。
   *
   * 用途：故障状态机在"用户手动把复位按钮拨回 OFF"时调用。需求要求"故障没修好时，
   * 用户把复位拨回关，只要故障条件还在，系统要能立即重新触发故障"——如果不清冷却，
   * 刚触发过的那次记录还在 30s 冷却期内，下一条 MQTT 消息进来会被 withinCooldown 拦掉，
   * 就"立即"不了。清掉之后，下一轮评估检测到故障可以马上重新走触发流程。
   */
  function clearForDevice(deviceNo) {
    const prefix = `${deviceNo || 'global'}:`
    for (const key of lastFired.keys()) {
      if (key.startsWith(prefix)) lastFired.delete(key)
    }
  }

  return { withinCooldown, markFired, clearForDevice }
}

module.exports = { createCooldown }
