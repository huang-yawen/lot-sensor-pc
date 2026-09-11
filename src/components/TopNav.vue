<!--
 * 【文件职责】
 * 可复用界面组件，负责展示数据或组织页面布局。
 * 【配置中心关联】
 * 不持久化配置中心；需要展示场景信息时由父组件或状态仓库传入。
 * -->
<template>
  <div class="container">
    <div class="right-section">
      <div class="device-status-bar">
        <div class="device-status-list">
          <span
            class="device-chip"
            v-for="device in deviceStatusList"
            :key="device.deviceId"
            :class="{ online: device.online, offline: !device.online, invalid: device.configured === false }"
            :title="device.issue || device.deviceName || device.deviceId"
          >
            <span class="chip-dot"></span>
            <span class="chip-id">{{ device.deviceId }}</span>
          </span>
          <span v-if="deviceStatusList.length === 0" class="no-device-text">暂无{{ deviceLabel }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { connect, on } from '@/utils/websocket'
import { useSystemConfigStore } from '@/stores/useSystemConfigStore'
import api from '@/api'

// 设备在线状态列表
const deviceStatusList = ref([])
const systemStore = useSystemConfigStore()
const deviceLabel = computed(() => systemStore.config.DEVICE_LABEL || systemStore.config.TERMINOLOGY?.device || '设备')
let wsUnsubscribe = null

const applyDeviceStatuses = (payload) => {
  if (!Array.isArray(payload)) return
  // 即使后端重连或数据库返回顺序变化，也保持标签位置稳定。
  deviceStatusList.value = [...payload].sort((a, b) =>
    String(a.deviceId).localeCompare(String(b.deviceId), 'zh-CN', { numeric: true })
  )
}

onMounted(() => {
    systemStore.load().catch(error => console.error('[TopNav] 配置加载失败:', error))
    // 先读一次 t_device 同步状态；WebSocket 断开时也不会误报“暂无设备”。
    api.get('/api/device-status')
      .then(response => applyDeviceStatuses(response.data?.data))
      .catch(error => console.error('[TopNav] 设备状态加载失败:', error))
    // 连接 WebSocket，监听设备在线状态
    connect()
    wsUnsubscribe = on('device_status', (payload) => {
      applyDeviceStatuses(payload)
    })
})

onUnmounted(() => {
    // 不调用 close()：WebSocket 是全局单例连接，其他页面/组件（指令页面、实时数据页等）
    // 共用同一条连接，这里关掉会连带断开它们，且 close() 会置 isManualClose=true 导致
    // 不再自动重连。TopNav 常驻不会轻易卸载，卸载时只清理自己的订阅即可，跟其余用到
    // @/utils/websocket 的组件（SensorRealtime.vue 等）保持同样的约定。
    if (wsUnsubscribe) {
      wsUnsubscribe()
      wsUnsubscribe = null
    }
})
</script>

<style scoped>
.container{
    width: 100%;
    height: 70px;
    min-width: 0;
    background-color: #374270;
    display: flex;
    align-items: center;
    padding: 0 24px;
    box-sizing: border-box;
}

.right-section {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 1;
  min-width: 0;
  height: 100%;
  margin-left: auto;
}

.device-status-bar {
  width: min(720px, 100%);
  height: 42px;
  min-width: 0;
  display: flex;
  align-items: center;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.device-status-bar::-webkit-scrollbar { height: 0; }

.device-status-list {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: max-content;
  min-width: 100%;
  min-height: 36px;
  margin-left: auto;
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
  flex: 0 0 auto;
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
  margin-left: auto;
  font-size: 12px;
  color: #aaa;
}

.device-chip.invalid {
  color: #92400e;
  background: #fef3c7;
  border-color: #f59e0b;
}
</style>
