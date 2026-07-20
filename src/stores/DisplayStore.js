/**
 * 显示控制 Store
 * 
 * 【说明】
 * 之前 SideBar 上的"显示ID/隐藏编号"按钮已被移除，
 * 字段可见性改由后端 systemConfig.js 统一控制。
 * 
 * 此 store 目前保留 isFieldVisible 函数供前端表格/卡片过滤字段使用，
 * 并新增 showSeconds 控制全局时间格式是否显示秒。
 * 默认所有字段都显示（true），用户如需隐藏字段则通过后端 API 设置。
 * 
 * 后续如需完全由后端控制字段可见性，可在 isFieldVisible 中调用后端API，
 * 但目前先保持简单——所有字段默认显示。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export const DisplayStore = defineStore('displayStore', () => {
  // 字段可见性现在由后端 systemConfig.js 统一控制，
  // 前端不再提供切换按钮，默认全部显示。
  const hideIdFields = ref(false)
  const hideNumberFields = ref(false)

  /**
   * 是否显示秒
   * true  - 时间格式显示到秒，如 "2026/07/20 11:51:03"
   * false - 时间格式不显示秒，如 "2026/07/20 11:51"
   */
  const showSeconds = ref(true)

  const loadDisplayConfig = async () => {
    const response = await api.get('/api/system-config')
    if (response.data?.success) {
      hideIdFields.value = response.data.data.HIDE_ID_FIELDS === true
      hideNumberFields.value = response.data.data.HIDE_NUMBER_FIELDS === true
      showSeconds.value = response.data.data.SHOW_SECONDS !== false
    }
  }

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

  /**
   * 获取全局统一的 toLocaleString 格式化选项
   * 根据 showSeconds 自动切换是否显示秒
   */
  const getTimeFormatOptions = () => {
    const options = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }
    if (showSeconds.value) {
      options.second = '2-digit'
    }
    return options
  }

  /**
   * 快捷方法：格式化时间为统一格式的字符串
   * @param {string|number|Date} value - 时间值
   * @returns {string} 格式化后的时间字符串
   */
  const formatTime = (value) => {
    if (!value) return '未知时间'
    try {
      return new Date(value).toLocaleString('zh-CN', getTimeFormatOptions())
    } catch (e) {
      console.error('时间格式化错误:', e)
      return '未知时间'
    }
  }

  return {
    hideIdFields,
    hideNumberFields,
    showSeconds,
    isFieldVisible,
    loadDisplayConfig,
    getTimeFormatOptions,
    formatTime,
  }
})
