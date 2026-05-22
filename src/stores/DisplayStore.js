import { defineStore } from 'pinia'
import { ref } from 'vue'

export const DisplayStore = defineStore('displayStore', () => {
  const hideIdFields = ref(false)
  const hideNumberFields = ref(false)

  const isIdField = (key) => String(key).trim().toLowerCase() === 'id'

  const isNumberField = (key) => {
    const rawKey = String(key).trim()
    const lowerKey = rawKey.toLowerCase()
    return rawKey.includes('编号') || ['d_no', 'device_no', 'deviceid', 'device_id'].includes(lowerKey)
  }

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
