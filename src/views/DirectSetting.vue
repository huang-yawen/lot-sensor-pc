<template>
  <div class="main-container">
    <div class="panel global-panel">
      <h3 class="panel-title">全局指令配置</h3>
      <DeviceSetting :storeData="store.data" :renderData="store.renderData" :handleUpdateData="store.handleUpdateData"
        :fetchDirectData="store.fetchDirectData" :handleRender="store.handleRender" :id="'null'" />
    </div>

    <div class="panel device-panel">
      <h3 class="panel-title">多设备指令配置</h3>
      
      <div class="device-selector">
        <span class="selector-label">选择设备：</span>
        <el-dropdown @command="handleCommand" trigger="click">
          <span class="el-dropdown-link">
            {{ selectedDeviceId || '请选择设备' }}
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

      <div class="device-content">
        <DeviceSetting v-if="selectedDeviceId" :storeData="store.data" :renderData="store.renderData"
          :handleUpdateData="store.handleUpdateData" :fetchDirectData="store.fetchDirectData"
          :handleRender="store.handleRender" :id="selectedDeviceId" />
        <div v-else class="empty-tip">请从上方下拉菜单选择设备</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import DeviceSetting from '@/components/direct/DeviceSetting.vue'
import { DirectStore } from '@/stores/DirectStore'
import { DeviceStore } from '@/stores/DeviceStore' 
import { computed, ref, onMounted } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'

const store = DirectStore()
const dStore = DeviceStore() 

const selectedDeviceId = ref(null)
const ids = computed(() => dStore.ids || [])


const handleCommand = (command) => {
  selectedDeviceId.value = command
}

onMounted(async () => {
  await dStore.fetchDeviceData({ currentPage: 1, pageSize: 999 })
  await store.fetchDirectData()
})
</script>

<style scoped>
.main-container {
  display: flex;
  gap: 20px;
  padding: 16px;
  height: calc(100vh - 100px);
  overflow:hidden;

}

.panel {
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  padding: 16px;
  width: calc(50% - 35px);
  max-width: calc(50% - 35px);
  display: flex;
  flex-direction: column;
}

.global-panel {
  flex-shrink: 0;
}

.device-panel {
  flex-shrink: 0;
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

.empty-tip {
  padding: 30px 20px;
  text-align: center;
  color: #909399;
  font-size: 14px;
}
</style>