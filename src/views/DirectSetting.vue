<!--
 * 【文件职责】
 * 业务页面，负责组合数据、状态和用户操作，呈现完整功能界面。
 * 【配置中心关联】
 * 页面通过状态仓库读取配置中心；场景开关保存后，相关显示与交互按最新配置更新。
 * -->
<template>
  <div class="main-container">
    <!-- ========== 全局指令配置（多设备时显示） ========== -->
    <div class="panel global-panel" v-if="!singleDeviceMode">
      <h3 class="panel-title">全局指令配置</h3>
      <DeviceSetting :storeData="store.data" :renderData="store.renderData" :handleUpdateData="store.handleUpdateData"
        :fetchDirectData="store.fetchDirectData" :handleRender="store.handleRender" :id="'null'" />
    </div>

    <!-- ========== 设备指令配置 ========== -->
    <div class="panel device-panel">
      <h3 class="panel-title">{{ deviceLabel }}指令配置</h3>
      
      <!-- 设备选择器（单设备模式隐藏） -->
      <div class="device-selector" v-if="!hideDevicePicker">
        <span class="selector-label">{{ deviceLabel }}编号：</span>
        <el-dropdown @command="handleCommand" trigger="click">
          <span class="el-dropdown-link">
            {{ selectedDeviceId || `请选择${deviceLabel}` }}
            <el-icon class="el-icon--right"><arrow-down /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="id in ids" :key="id" :command="id">
                {{ id }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <div class="state" v-if="!selectedDeviceId && !hideDevicePicker">请选择{{ deviceLabel }}以配置指令</div>
      <div class="state" v-else-if="loading">加载中...</div>
      <div class="device-content" v-else>
        <div v-if="qtyMatchedProgress" class="qty-progress-card">
          <div class="qty-progress-title">定量停机 · 本轮实时进度</div>
          <el-progress :percentage="qtyProgressPercentage" :status="qtyMatchedProgress.reached ? 'success' : undefined" />
          <div class="qty-progress-text">
            已累计 {{ qtyMatchedProgress.accumulated }} L / 目标 {{ qtyMatchedProgress.target }} L
            <span v-if="qtyMatchedProgress.reached">（已达标，本轮已自动停机）</span>
          </div>
        </div>
        <DeviceSetting :storeData="store.data" :renderData="store.renderData"
          :handleUpdateData="store.handleUpdateData" :fetchDirectData="store.fetchDirectData"
          :handleRender="store.handleRender" :id="selectedDeviceId || 'null'" />
      </div>
    </div>
  </div>
</template>

<script setup>
import DeviceSetting from '@/components/direct/DeviceSetting.vue'
import { DirectStore } from '@/stores/DirectStore'
import { DeviceStore } from '@/stores/DeviceStore' 
import { useSystemConfigStore } from '@/stores/SystemConfigStore'
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import { connect as connectQtyWs, on as qtyWsOn } from '@/utils/websocket'

const store = DirectStore()
const dStore = DeviceStore() 
const systemStore = useSystemConfigStore()

const selectedDeviceId = ref(null)
const ids = computed(() => dStore.ids || [])
const loading = ref(false)
const singleDeviceMode = computed(() => systemStore.config.SINGLE_DEVICE_MODE === true)
const deviceLabel = computed(() => systemStore.config.DEVICE_LABEL || systemStore.config.TERMINOLOGY?.device || '设备')

// 选择器与编号列是两个独立开关，避免隐藏编号列时意外禁用多设备选择。
const hideDevicePicker = computed(() => singleDeviceMode.value || systemStore.config.HIDE_DEVICE_SELECTOR === true)

const handleCommand = (command) => {
  selectedDeviceId.value = command
}

// 定量停机本轮实时进度：跟 QuantityShutdownConfig.vue 一样订阅 sensor_data 里的
// _quantityShutdown 字段；deviceNo 要匹配当前选中的设备号才展示，避免多设备时
// 显示成别的设备的进度。只有真正收到推送（代表功能确实开着）才有值，配合模板
// 里的 v-if 做到“定量停机关闭就完全不显示”这条要求。
const qtyProgress = ref(null)
const qtyMatchedProgress = computed(() => {
  if (!qtyProgress.value) return null
  const targetId = String(selectedDeviceId.value || 'null')
  const progId = qtyProgress.value.deviceNo == null ? 'null' : String(qtyProgress.value.deviceNo)
  return progId === targetId ? qtyProgress.value : null
})
const qtyProgressPercentage = computed(() => {
  if (!qtyMatchedProgress.value || !qtyMatchedProgress.value.target) return 0
  return Math.min(100, Math.round((qtyMatchedProgress.value.accumulated / qtyMatchedProgress.value.target) * 100))
})
let unsubscribeQtyProgress = null

onMounted(async () => {
  loading.value = true
  try {
    await systemStore.load()
    await dStore.fetchDeviceData({ currentPage: 1, pageSize: 999 })
    await store.fetchDirectData()
    await store.handleRender('null')
    
    // 单设备模式：自动选中第一个设备
    if (singleDeviceMode.value && ids.value.length > 0) {
      selectedDeviceId.value = ids.value[0]
    }
  } finally {
    loading.value = false
  }
})

onMounted(() => {
  connectQtyWs()
  unsubscribeQtyProgress = qtyWsOn('sensor_data', (payload) => {
    if (payload && payload._quantityShutdown) qtyProgress.value = payload._quantityShutdown
  })
})

onUnmounted(() => {
  unsubscribeQtyProgress?.()
})
</script>

<style scoped>
.main-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px;
  height: calc(100vh - 100px);
  overflow-y: auto;
}

.panel {
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  padding: 16px;
}

.panel-title {
  font-size: 18px;
  font-weight: 600;
  color: #374270;
  margin: 0 0 12px 0;
  padding-bottom: 10px;
  border-bottom: 2px solid #e4e7ed;
}

.device-selector {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 14px;
  background: #f5f7fa;
  border-radius: 6px;
}

.selector-label {
  font-size: 14px;
  font-weight: 600;
  color: #606266;
  white-space: nowrap;
}

.el-dropdown-link {
  cursor: pointer;
  color: #409eff;
  display: flex;
  align-items: center;
  font-size: 14px;
  padding: 6px 10px;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 5px;
  transition: all 0.2s;
  min-width: 180px;
}

.el-dropdown-link:hover {
  color: #66b1ff;
  border-color: #c6e2ff;
  background: #ecf5ff;
}

.device-content {
  flex: 1;
}

.qty-progress-card {
  margin-bottom: 16px;
  padding: 14px 18px;
  background: #f5f7fa;
  border-radius: 8px;
}

.qty-progress-title {
  font-size: 14px;
  font-weight: 600;
  color: #374270;
  margin-bottom: 8px;
}

.qty-progress-text {
  margin-top: 8px;
  color: #64748b;
  font-size: 14px;
}

.state {
  padding: 30px 20px;
  text-align: center;
  color: #909399;
  font-size: 14px;
}
</style>
