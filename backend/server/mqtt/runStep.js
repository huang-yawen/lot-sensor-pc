/** 【文件职责】实时消息处理器（combined / sensor / behavior 三个 handler）共用的"单步执行"：
 * 一条 MQTT 消息要依次做存库、告警、安全联锁、故障机、联动、PID……好几步。以前这些步骤
 * 共用一个 try/catch，其中任何一步抛异常（数据库抖一下写记录失败、MQTT 刚好断线下发失败），
 * 后面的步骤这一轮全部跳过——安全联锁、故障保护恰好在那一刻不执行。
 * 现在每一步单独包一层：出错只打一行日志、这一步返回兜底值，后面的步骤照常执行。
 * 【配置】无。 */

/**
 * @param {string}   tag      日志前缀，比如 '[CombinedRealtime]'
 * @param {string}   name     这一步的中文名，出错时写进日志，方便看是哪一步挂了
 * @param {Function} fn       这一步要做的事（async 函数）
 * @param {*}        fallback 出错时这一步的返回值，要跟正常返回值同一种形状（数组给 []，对象/单值给 null）
 */
async function runStep(tag, name, fn, fallback) {
  try {
    return await fn()
  } catch (err) {
    console.error(`${tag} ${name}出错，本步跳过，后续步骤继续执行:`, err.message)
    return fallback
  }
}

module.exports = { runStep }
