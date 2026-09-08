/**
 * 【干什么】全站配置的前端缓存。整个应用共用这一份 —— 页面标题、术语、单设备模式、
 * 分页大小、各页面显示开关、智能判定按钮显隐 都从这里读。
 *
 * 【导出】useSystemConfigStore()
 * 【状态】config（整份配置对象，字段见后端 config/appSettings.js 等）、loaded
 * 【方法】load(force=false)  首次调后端 GET /api/system-config 填充 config，并把 SYSTEM_TITLE
 *        写进 document.title；已加载后再调直接返回缓存，force=true 强制重新拉。
 * 【调的接口】GET /api/system-config（只读，后端配置是代码常量）
 * 【谁在用】几乎所有页面：SideBar / TopNav / Dashboard / SensorRealtime / SensorHistory /
 *        BehaviorRealtime / BehaviorHistory / DeviceManagement / DirectSetting / HistoryCharts /
 *        OperationHistory / JudgmentHistory / ErrorInfo
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export const useSystemConfigStore = defineStore('systemConfigStore', () => {
  const config = ref({
    SYSTEM_TITLE: '物联网数据管理中心',
    DEVICE_LABEL: '设备',
    SINGLE_DEVICE_MODE: true,
    HIDE_DEVICE_SELECTOR: false,
    ENABLE_CHARTS: true,
    DEFAULT_PAGE_SIZE: 5,
    REALTIME_REFRESH_INTERVAL: 3000,
    TERMINOLOGY: { sensor: '传感器数据', behavior: '运行状态', device: '设备', alarm: '告警记录', judgment: '智能判定' },
    INTELLIGENT_JUDGMENT: { showOnSensorPage: true, showOnBehaviorPage: true, showHistoryMenu: true }
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
