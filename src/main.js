/**
 * 【文件职责】
 * 前端启动入口，创建 Vue 应用并注册路由、状态仓库及全局样式。
 * 【配置中心关联】
 * 不写死场景业务配置；运行模式与配置中心由运行时模块和状态仓库负责。
 * */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from '@/App.vue'
import router from '@/router/index'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/element-theme.css'
import axios from 'axios'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.use(ElementPlus)

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.mount('#app')
// .use(router)
