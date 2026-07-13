import { createRouter, createWebHashHistory } from 'vue-router'
const routes=[
    {
        path:'/',
        component:()=>import('@/components/MainLayout.vue'),
        meta: { title: '首页' },
        children: [
            {
                path:'/',
                redirect:'/sensor-realtime'
            },{
                path:'/sensor-realtime',
                component:()=>import('@/views/SensorRealtime.vue'),
                meta: { title: '传感器数据/实时数据' }
            },{
                path:'/sensor-history',
                component:()=>import('@/views/SensorHistory.vue'),
                meta: { title: '传感器数据/历史数据' }
            },{
                path:'/behavior-realtime',
                component:()=>import('@/views/BehaviorRealtime.vue'),
                meta: { title: '行为数据/实时数据' }
            },{
                path:'/behavior-history',
                component:()=>import('@/views/BehaviorHistory.vue'),
                meta: { title: '行为数据/历史数据' }
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
                path:'/error-info',
                component:()=>import('@/views/ErrorInfo.vue'),
                meta: { title: '故障记录' }         
            }
        ]
    }
]
const router = createRouter({
    history:createWebHashHistory(),
    routes
})
export default router
