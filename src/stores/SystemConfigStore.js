import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export const useSystemConfigStore = defineStore('systemConfig', () => {
  const config = ref({
    SYSTEM_TITLE: '物联网数据管理中心',
    ENABLE_JUDGMENT_HISTORY: true,
    TERMINOLOGY: { sensor: '传感器数据', behavior: '运行状态', device: '设备', alarm: '告警记录', judgment: '智能判定' }
  })
  const loaded = ref(false)

  async function load(force = false) {
    if (loaded.value && !force) return config.value
    const response = await api.get('/api/system-config')
    if (response.data?.success) config.value = response.data.data
    loaded.value = true
    document.title = config.value.SYSTEM_TITLE || '物联网数据管理中心'
    return config.value
  }

  return { config, loaded, load }
})
