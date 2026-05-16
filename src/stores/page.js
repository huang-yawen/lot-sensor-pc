import { defineStore } from 'pinia'
const pageStore = defineStore('page', {
  currentPage: ref('home'),
})