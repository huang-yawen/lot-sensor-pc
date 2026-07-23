/**
 * 【文件职责】配置中心前端缓存。
 * 负责从 /api/system-config 读取场景配置，供标题、设备名称、单设备模式、菜单和页面开关使用。
 * 【配置中心关联】config 是后端配置中心的前端镜像；load(true) 强制刷新。加载成功后同步
 * SYSTEM_TITLE 到浏览器标题。业务页面应读取此仓库，不能复制配置后长期缓存。
 * */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export const useSystemConfigStore = defineStore('systemConfig', () => {
  const config = ref({
    SYSTEM_TITLE: '物联网数据管理中心',
    DEVICE_LABEL: '设备',
    SINGLE_DEVICE_MODE: true,
    HIDE_DEVICE_SELECTOR: false,
    ENABLE_CHARTS: true,
    ENABLE_SENSOR_RECOGNIZE: true,
    ENABLE_BEHAVIOR_RECOGNIZE: true,
    ENABLE_JUDGMENT_HISTORY: true,
    DEFAULT_PAGE_SIZE: 5,
    REALTIME_REFRESH_INTERVAL: 3000,
    TERMINOLOGY: { sensor: '传感器数据', behavior: '运行状态', device: '设备', alarm: '告警记录', judgment: '智能判定' }
  })
  const loaded = ref(false)

  async function load(force = false) {
    // 避免同一页面多组件重复请求；场景保存或切换后传 true 强制重新获取。
    if (loaded.value && !force) return config.value
    const response = await api.get('/api/system-config')
    if (response.data?.success) config.value = response.data.data
    loaded.value = true
    document.title = config.value.SYSTEM_TITLE || '物联网数据管理中心'
    return config.value
  }

  return { config, loaded, load }
})
