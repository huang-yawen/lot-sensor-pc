# PC端与移动端功能对齐 TODO

## 所有任务已完成 ✅

- [x] 1. 添加 WebSocket 实时推送功能 (utils/websocket.js)
- [x] 2. 添加菜单中心/首页概览页面 (设备在线状态)  
- [x] 3. 行为数据值转换 (开关/控制模式/空调模式)
- [x] 4. 传感器实时数据单位展示 (fieldUnits)
- [x] 5. DisplayStore 设置持久化 (localStorage)
- [x] 6. 设备管理添加分页功能
- [x] 7. 传感器/行为历史页 fieldUnits 支持
- [x] 8. 路由和侧边栏更新 (添加首页路由)

## 修改/新增文件清单

### 新增文件
- `src/utils/websocket.js` - WebSocket 客户端工具
- `src/utils/fieldTransform.js` - 行为数据字段值转换工具
- `src/views/Dashboard.vue` - 首页设备概览页面

### 修改文件
- `src/router/index.js` - 添加 /dashboard 路由、默认重定向改为首页
- `src/components/SideBar.vue` - 添加"首页"菜单项
- `src/stores/DisplayStore.js` - 添加 localStorage 持久化
- `src/stores/SensorStore.js` - 添加 fieldUnits 支持
- `src/stores/PaginationStore.js` - 添加 fieldUnits 支持
- `src/views/SensorRealtime.vue` - 接入 fieldUnits + WebSocket 实时推送
- `src/views/BehaviorRealtime.vue` - 接入行为数据值转换
- `src/views/BehaviorHistory.vue` - 接入行为数据值转换
- `src/views/DeviceManagement.vue` - 添加分页功能