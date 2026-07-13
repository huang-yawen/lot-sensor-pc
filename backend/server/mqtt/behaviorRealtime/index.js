const { BEHAVIOR_TOPIC, handleMessage, parsePayload } = require('./behaviorRealtimeHandler')
const { saveBehaviorData, getBehaviorDataByDevice } = require('./behaviorRealtimeRepository')

module.exports = {
    BEHAVIOR_TOPIC,
    handleMessage,
    parsePayload,
    saveBehaviorData,
    getBehaviorDataByDevice
}
