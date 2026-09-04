/** 【文件职责】"设备 + 触发类型"维度的触发冷却，安全联锁（safetyInterlock.js）和
 * 故障状态机（faultStatus.js）共用同一份实现，不再各自维护 lastFired Map +
 * withinCooldown/markFired。
 *
 * 每个调用方通过 createCooldown() 拿到一份独立的计时状态（各自的 Map），
 * 只复用逻辑、不共享数据——安全联锁和故障机的 trigger.id 互不重叠，即便共享一张
 * 表也不会撞 key，但拆开更保险，行为跟拆分前完全一致。
 *
 * key 统一约定为 `${deviceNo || 'global'}:${triggerId}`，冷却时长（cooldownMs）由
 * 调用方按各自的配置项传入。
 * 【配置中心关联】无。 */

/**
 * 创建一份独立的冷却计时器。
 * @returns {{withinCooldown: Function, markFired: Function, clearForDevice: Function}}
 */
function createCooldown() {
  /** key -> 上次触发时间戳（ms） */
  const lastFired = new Map()

  /** cooldownMs 毫秒内该 key 已经处理过一次则返回 true（调用方据此跳过本次触发）。 */
  function withinCooldown(key, cooldownMs) {
    const last = lastFired.get(key) || 0
    return Date.now() - last < cooldownMs
  }

  /** 记下该 key 本次触发时间，供下一次 withinCooldown 判断。 */
  function markFired(key) {
    lastFired.set(key, Date.now())
  }

  /**
   * 清掉某设备名下的所有冷却记录（key 形如 `${deviceNo || 'global'}:${triggerId}`）。
   * 故障复位后若故障条件仍在，需要能立即重新触发，不被冷却期拦住。
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
