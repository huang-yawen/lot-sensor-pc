import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const backendProxy = {
  target: 'http://localhost:3000',
  changeOrigin: true,
  secure: false
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/data': backendProxy,
      '/dataByType': backendProxy,
      '/deviceData': backendProxy,
      '/errData': backendProxy,
      '/errTypeStats': backendProxy,
      '/directData': backendProxy,
      '/directRender': backendProxy,
      '/multipleDirectData': backendProxy,
      '/directData/update': backendProxy,
      '/intelligent/recognize': backendProxy,
      '/intelligent/judge': backendProxy,
      '/intelligent/records': backendProxy,
      '/api/system-config': backendProxy,
      '/api/operation-history': backendProxy,
      '/api/derived-metrics': backendProxy,
      '/api/mqtt/status': backendProxy,
      '/api/device-status': backendProxy,
      '/api/cumulative': backendProxy,
      '/api/time-window': backendProxy,
      '/api/pid-autotune/apply': backendProxy,
      '/ws': {
        ...backendProxy,
        ws: true
      }
    }
  }
})
