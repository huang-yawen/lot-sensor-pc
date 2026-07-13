<template>
  <div class="container">
    <div class="right-section">
      <div class="device-status-bar">
        <span
          class="device-chip"
          v-for="device in deviceStatusList"
          :key="device.deviceId"
          :class="{ online: device.online, offline: !device.online }"
        >
          <span class="chip-dot"></span>
          <span class="chip-id">{{ device.deviceId }}</span>
        </span>
        <span v-if="deviceStatusList.length === 0" class="no-device-text">暂无设备</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { connect, on, close } from '@/utils/websocket'

// 设备在线状态列表
const deviceStatusList = ref([])
let wsUnsubscribe = null

onMounted(() => {
    // 连接 WebSocket，监听设备在线状态
    connect()
    wsUnsubscribe = on('device_status', (payload) => {
      if (Array.isArray(payload)) {
        deviceStatusList.value = payload
      }
    })
})

onUnmounted(() => {
    if (wsUnsubscribe) {
      wsUnsubscribe()
      wsUnsubscribe = null
    }
    close()
})
</script>

<style scoped>
.container{
    height: 50px;
    background-color: #374270;
    display: flex;
    align-items: center;
    padding: 0 20px;
}

.right-section {
  display: flex;
  align-items: center;
  height: 100%;
  margin-left: auto;
  margin-right: 30px;
}

.device-status-bar {
  display: flex;
  align-items: center;
  height: 100%;
  gap: 8px;
  flex-wrap: nowrap;
  max-width: 500px;
  overflow-x: auto;
}

.device-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.device-chip.online {
  background: #16a34a;
  color: #ffffff;
  border: 1px solid #15803d;
}

.device-chip.offline {
  background: #ffffff;
  color: #374151;
  border: 1px solid #d1d5db;
}

.chip-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.device-chip.online .chip-dot {
  background: #ffffff;
  box-shadow: 0 0 4px rgba(255, 255, 255, 0.5);
}

.device-chip.offline .chip-dot {
  background: #9ca3af;
}

.chip-id {
  font-size: 12px;
}

.no-device-text {
  font-size: 12px;
  color: #aaa;
}
</style>
