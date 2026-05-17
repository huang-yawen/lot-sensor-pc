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
