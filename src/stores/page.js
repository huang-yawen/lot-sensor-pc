/**
 * 【文件职责】
 * Pinia 状态仓库，集中管理前端共享状态和异步业务操作。
 * 【配置中心关联】
 * 如读取配置中心，必须通过接口或 SystemConfigStore 获取最新值，不能长期写死场景参数。
 * */
import { defineStore } from 'pinia'
import { ref } from 'vue'
const PageStore = defineStore('page', () => {
  return { currentPage: ref('home') }
})
export default PageStore
