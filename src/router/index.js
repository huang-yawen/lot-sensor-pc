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
                // 「合并版」数据页：传感器与行为永远是同一条上报消息里的数据，合成一整套页面。
                // 一条消息 = 数据库一行 = 页面一行，不再分"传感器数据/行为数据"两套。
                path:'/combined-realtime',
                component:()=>import('@/views/CombinedRealtime.vue'),
                meta: { title: '实时数据' }
            },{
                path:'/combined-history',
                component:()=>import('@/views/CombinedHistory.vue'),
                meta: { title: '汇总数据' }
            }
            // 分开版的 4 个旧地址保留重定向：老书签 / 老文档 / 老演示链接点了不会 404，
            // 统一落到合并后的页面上（与旧页面是同一份数据，只是列多了行为那几列）。
            ,{
                path:'/sensor-realtime', redirect:'/combined-realtime'
            },{
                path:'/sensor-history', redirect:'/combined-history'
            },{
                path:'/behavior-realtime', redirect:'/combined-realtime'
            },{
                path:'/behavior-history', redirect:'/combined-history'
            }
            // ,{
            //     path:'/device-management',
            //     component:()=>import('@/views/DeviceManagement.vue'),
            //     meta: { title: '设备数据/设备管理' }
            // }
            ,{
                path:'/device-setting',
                component:()=>import('@/views/DirectSetting.vue'),
                meta: { title: '设备数据/设备设置' }
            }
            ,{
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
            },{
                path:'/auto-judgment',
                component:()=>import('@/views/AutoJudgment.vue'),
                meta: { title: '自动判定' }
            }
        ]
    }
]
const router = createRouter({
    history:createWebHashHistory(),
    routes
})
export default router
