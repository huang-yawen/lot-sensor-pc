# 操作指南

> 只记录我问过并让你写下来的操作流程。

---

## 一、把 app.js 里散落的路由迁移到路由文件

**什么时候做**：app.js 里直接写了 `app.get(...)` / `app.post(...)` 这种路由定义，而不是统一放在 `routes/sensorRoutes.js` 里。

**操作步骤**：

1. **找出所有散落的路由**。在 app.js 里搜索 `app.get(` / `app.post(` / `app.delete(`，这些就是散落的。

2. **在 sensorRoutes.js 顶部补 require**。把 app.js 里这些路由用到的 controller / service / 工具函数，在 sensorRoutes.js 顶部补上对应的 require。比如：
   - 路由里用了 `configController` → `const configController = require('../controllers/system/configController')`
   - 路由里用了 `mqttClient.isConnected` → `const mqttClient = require('../mqtt/index')`
   - 路由里用了匿名函数里的局部变量（如 app.js 里的 `mqttClient`、`getLatestComputed`），同样补 require

3. **把路由定义搬进 sensorRoutes.js**。路径**必须保持原样**不能改，因为前端是按这个路径请求的。按功能分组加注释分隔线，比如：
   ```js
   /* ============================================================
    * 系统配置接口
    * ============================================================ */
   router.get('/api/system-config', configController.getConfig)
   router.post('/api/system-config', configController.updateConfig)
   ```

4. **从 app.js 删除散落的路由** 和不再需要的 require（注意别删了 WebSocket/MQTT 集成用的）。app.js 只保留：Express 配置 + `app.use('/', sensorRoutes)` + WebSocket/MQTT 集成 + 初始化逻辑。

5. **重启后端验证**：
   ```powershell
   # 杀掉旧进程
   netstat -ano | findstr ":3000"     # 找到占用端口的 PID
   taskkill /PID <pid> /F

   # 启动
   cd backend/server
   node app.js
   ```
   然后浏览器访问几个迁移过的接口确认 200，比如 `http://localhost:3000/api/system-config`、`http://localhost:3000/api/mqtt/status`。

**注意**：sensorRoutes.js 的挂载点是 `app.use('/', sensorRoutes)`，所以路由里的路径**本来就以 `/api` 开头**，不需要再加前缀。

---

## 二、给页面添加 WebSocket 实时数据展示

**什么时候做**：页面需要实时显示传感器数据、设备状态、故障告警等，不想让用户手动刷新。

### 后端已经在广播的消息类型

后端 app.js 里已经 broadcast 了这些类型，前端可以直接监听，**不需要改后端**：

| 类型 | 什么时候推 | 频率 | 节流？ |
|------|-----------|------|--------|
| `sensor_data` | MQTT 收到传感器数据并处理完 | 每次上报 | ✅ 按 REALTIME_REFRESH_INTERVAL 合并 |
| `behavior_data` | MQTT 收到行为数据并处理完 | 每次上报 | ✅ 同上 |
| `device_status` | 定时推送设备在线状态 | 每 2 秒 | ❌ |
| `fault_triggered` | 检测到新故障的瞬间 | 即时 | ❌ |
| `pending_commands_flushed` | 指令暂存确认 | 指令批量发送后 | ❌ |

### 模式 A：直接用 payload 更新页面（payload 就是页面要的数据）

```vue
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { connect, on as wsOn } from '@/utils/websocket'
import api from '@/api'

const myData = ref([])
let unsubscribe = null

onMounted(async () => {
  // 先 HTTP 拉一次兜底，防止 WebSocket 断开时页面空白
  const res = await api.get('/api/device-status')
  myData.value = res.data?.data || []

  connect()                                    // 全局只建一次连接
  unsubscribe = wsOn('device_status', (payload) => {
    myData.value = payload                     // payload 就是后端 broadcast 的原始数据
  })
})

onUnmounted(() => {
  unsubscribe?.()                              // 只取消自己的监听
  // 注意：别调 close()！其他页面可能还在用
})
</script>
```

### 模式 B：payload 触发 HTTP 静默刷新（需要后端聚合数据）

后端 payload 是原始 MQTT 数据，页面需要的是聚合后的结果时用这个。

```vue
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { connect, on as wsOn } from '@/utils/websocket'
import api from '@/api'

const displayData = ref({})
const loading = ref(false)
let unsubSensor = null

async function loadDisplay(showLoading = true) {
  if (showLoading) loading.value = true       // 首次：显示 loading
  try {
    const res = await api.get('/api/my-aggregated-data')
    displayData.value = res.data
  } finally {
    if (showLoading) loading.value = false
  }
}

onMounted(() => {
  loadDisplay(true)                           // 首次进入
  connect()
  unsubSensor = wsOn('sensor_data', () => loadDisplay(false))  // 静默刷新，不闪 loading
})

onUnmounted(() => {
  unsubSensor?.()
})
</script>
```

**为什么传 `false`？** 每次 WebSocket 推送都切换 loading 会疯狂闪。所以首次用 `true`，后续 WebSocket 推送触发的刷新用 `false` 静默更新。

### 模式 C：后端没有这个类型，需要先加广播

99% 的情况在 app.js 里的某个回调里加一行 `broadcast` 就行，不需要改 Service。

比如想在 MQTT 处理链末尾加一个新类型：

```js
// app.js 里的 mqttClient.on('processedMessage', ...) 回调末尾
mqttClient.on('processedMessage', (topic, data) => {
  // ... 原有的 broadcastThrottled('sensor_data', data) 等 ...

  // 加你的新广播
  broadcast('clean_fields', {
    temp: data.temp_out,
    flow: data.flow,
    pressure: data.pressure,
    timestamp: data.c_time,
  })
})
```

前端正常监听：
```js
wsOn('clean_fields', (payload) => {
  console.log(payload.temp, payload.flow)
})
```

### 三个容易踩的坑

| 坑 | 解决 |
|----|------|
| 多个组件同时调 `connect()` 会不会建多个连接？ | 不会。websocket.js 内部判断已连接就跳过，全局只有一个。 |
| 什么时候调 `close()`？ | 谨慎。会断开整个连接，其他页面的监听全没了。单页面卸载时**别调 close()**，只 `unsubscribe?.()`。 |
| 想看 payload 里到底有什么？ | 前端加临时调试：`wsOn('*', (data) => console.log('[WS]', data.type, data.payload))` |

### 项目里已有的 WebSocket 消费点（参考）

| 组件 | 监听的 type | 模式 |
|------|-------------|------|
| TopNav.vue | `device_status` | A 直接赋值 |
| Dashboard.vue | `device_status` + `sensor_data` + `error_data` | B 静默刷新 |
| FaultAlertDialog.vue | `fault_triggered` | A 直接赋值（弹窗） |
| SensorHistory.vue | — | B 静默刷新 |
| DeviceSetting.vue | — | B 静默刷新 |
