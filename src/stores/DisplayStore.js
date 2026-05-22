import { defineStore } from 'pinia'
import { ref } from 'vue'

export const DisplayStore = defineStore('displayStore', () => {
  // 侧边栏两个按钮控制这两个开关。
  const hideIdFields = ref(false)
  const hideNumberFields = ref(false)

  const isIdField = (key) => String(key).trim().toLowerCase() === 'id'

  // “编号”字段可能是中文列名，也可能是后端传来的 d_no/device_id。
  const isNumberField = (key) => {
    const rawKey = String(key).trim()
    const lowerKey = rawKey.toLowerCase()
    return rawKey.includes('编号') || ['d_no', 'device_no', 'deviceid', 'device_id'].includes(lowerKey)
  }

  // 表格和卡片渲染前都用这个函数判断字段是否显示。
  const isFieldVisible = (key) => {
    if (hideIdFields.value && isIdField(key)) return false
    if (hideNumberFields.value && isNumberField(key)) return false
    return true
  }

  const toggleIdFields = () => {
    hideIdFields.value = !hideIdFields.value
  }

  const toggleNumberFields = () => {
    hideNumberFields.value = !hideNumberFields.value
  }

  return {
    hideIdFields,
    hideNumberFields,
    isFieldVisible,
    toggleIdFields,
    toggleNumberFields
  }
})
