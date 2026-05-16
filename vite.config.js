import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    proxy: {
      '/data': {
        target: 'http://localhost:3000',//后端接口地址
        changeOrigin: true,
        secure: false
      }
    }
  }
})
