/**
 * 【干什么】两件事：① 全站统一的时间格式化（是否显示秒）；② 表格/卡片渲染时判断某一列
 * 要不要显示（隐藏 id 列 / 编号列）。这些开关值来自后端配置，本 store 缓存一份。
 *
 * 【导出】DisplayStore()
 * 【状态】hideIdFields、hideNumberFields、showSeconds（都来自 GET /api/system-config）
 * 【方法】
 *   loadDisplayConfig()          调 GET /api/system-config，填上面 3 个开关
 *   isFieldVisible(列名)          表格/卡片渲染前调，隐藏 id 列或编号列时返回 false
 *   formatTime(值)               把时间值格式化成统一字符串（按 showSeconds 决定要不要秒）—— 用得最多
 *   getTimeFormatOptions()       formatTime 内部用的 toLocaleString 选项
 * 【调的接口】GET /api/system-config
 * 【谁在用】组件 TableContainer / CardContainer / LineBarCharts / MainLayout / direct/DynamicNode；
 *        页面 Dashboard / DeviceManagement / OperationHistory / JudgmentHistory / ErrorInfo；
 *        以及 store DeviceStore / ErrorStore / PaginationStore（它们拿 formatTime 格式化列表时间）
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
