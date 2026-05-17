import { defineStore } from 'pinia'
const PageStore = defineStore('page', {
  currentPage: ref('home'),
})
export default PageStore
