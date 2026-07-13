/**
 * 显示控制 Store
 * 
 * 【说明】
 * 之前 SideBar 上的"显示ID/隐藏编号"按钮已被移除，
 * 字段可见性改由后端 systemConfig.js 统一控制。
 * 
 * 此 store 目前仅保留 isFieldVisible 函数供前端表格/卡片过滤字段使用，
 * 默认所有字段都显示（true），用户如需隐藏字段则通过后端 API 设置。
 * 
 * 后续如需完全由后端控制字段可见性，可在 isFieldVisible 中调用后端API，
 * 但目前先保持简单——所有字段默认显示。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const DisplayStore = defineStore('displayStore', () => {
  // 字段可见性现在由后端 systemConfig.js 统一控制，
  // 前端不再提供切换按钮，默认全部显示。
  const hideIdFields = ref(false)
  const hideNumberFields = ref(false)

  const isIdField = (key) => String(key).trim().toLowerCase() === 'id'

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

  return {
    hideIdFields,
    hideNumberFields,
    isFieldVisible,
  }
})