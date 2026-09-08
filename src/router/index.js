/**
 * 【文件职责】
 * 前端路由定义，负责页面地址、组件懒加载和导航结构。
 * 【配置中心关联】
 * 路由不保存配置中心；页面根据最新场景配置决定可见内容。
 * */
import { createRouter, createWebHashHistory } from 'vue-router'
const routes=[
    {
        path:'/',
        component:()=>import('@/components/MainLayout.vue'),
        meta: { title: '首页' },
        children: [
            {
                path:'/',
                redirect:'/dashboard'
            },{
                path:'/dashboard',
                component:()=>import('@/views/Dashboard.vue'),
                meta: { title: '首页概览' }
            },{
                path:'/sensor-realtime',
                component:()=>import('@/views/SensorRealtime.vue'),
                meta: { title: '传感器数据/实时数据' }
            },{
                path:'/sensor-history',
                component:()=>import('@/views/SensorHistory.vue'),
                meta: { title: '传感器数据/汇总数据' }
            },{
                path:'/behavior-realtime',
                component:()=>import('@/views/BehaviorRealtime.vue'),
                meta: { title: '行为数据/实时数据' }
            },{
                path:'/behavior-history',
                component:()=>import('@/views/BehaviorHistory.vue'),
                meta: { title: '行为数据/汇总数据' }
            },{
                path:'/device-management',
                component:()=>import('@/views/DeviceManagement.vue'),
                meta: { title: '设备数据/设备管理' }
            },{
                path:'/device-setting',
                component:()=>import('@/views/DirectSetting.vue'),
                meta: { title: '设备数据/设备设置' }
            },{
                path:'/operation-history',
                component:()=>import('@/views/OperationHistory.vue'),
                meta: { title: '设备数据/操作历史' }
            },{
                path:'/history-charts',
                component:()=>import('@/views/HistoryCharts.vue'),
                meta: { title: '历史图表' }
            },{
                path:'/error-info',
                component:()=>import('@/views/ErrorInfo.vue'),
                meta: { title: '故障记录' }
            },{
                path:'/judgment-history',
                component:()=>import('@/views/JudgmentHistory.vue'),
                meta: { title: '智能判定记录' }
            }
        ]
    }
]
const router = createRouter({
    history:createWebHashHistory(),
    routes
})
export default router
