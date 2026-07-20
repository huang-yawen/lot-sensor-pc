import { defineStore } from 'pinia'
import { ref } from 'vue'
const PageStore = defineStore('page', () => {
  return { currentPage: ref('home') }
})
export default PageStore
