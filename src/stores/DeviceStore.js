/**
 * 【文件职责】
 * Pinia 状态仓库，集中管理前端共享状态和异步业务操作。
 * 【配置中心关联】
 * 如读取配置中心，必须通过接口或 SystemConfigStore 获取最新值，不能长期写死场景参数。
 * */
import { defineStore } from "pinia";
import { ref } from 'vue';
import api from '@/api';
import { DisplayStore } from '@/stores/DisplayStore';

export const DeviceStore = defineStore('deviceStore', () => {
    const deviceData = ref([]);
    const loading = ref(false);
    const total = ref(0);
    const ids = ref([]) 

    const fetchDeviceData = async (params = {}) => {
        loading.value = true;
        try {
            console.log('[deviceStore] 发送搜索请求，参数:', params);
            // 设备管理页按关键字拉取列表，同时加时间戳避开浏览器缓存。
            const response = await api.get('/api/deviceData', {
                params: {
                    currentPage: params.currentPage || 1,
                    pageSize: params.pageSize || 5,
                    input: params.input || '',
                    searchMode: params.searchMode || 'all',
                    timestamp: Date.now()
                },
            });

            console.log('[deviceStore] 收到完整响应:', response);

            if (response.data.success) {
                const fullList = Array.isArray(response.data.data.list) ? response.data.data.list : [];
                console.log('[deviceStore] 原始数据列表:', fullList);
                
                const rawIds = [];

                // 列表数据顺手提取设备编号，供指令设置页选择设备时复用。
                fullList.forEach(item => {
                    console.log('[deviceStore] 单条数据:', item);
                    const deviceNumber = String(item['设备编号'] ?? '').trim()
                    if (deviceNumber) rawIds.push(deviceNumber)
                    if (item['创建时间']) {
                        try {
                            const displayStore = DisplayStore()
                            item['创建时间'] = displayStore.formatTime(item['创建时间'])
                        } catch (e) {
                            console.error("日期格式化错误:", e);
                        }
                    }
                });

                ids.value = [...new Set(rawIds)];
                total.value = Number(response.data.data.total) || 0;
                console.log("[deviceStore] 已获取并去重后的设备ID列表:", ids.value);
                deviceData.value = fullList;
            }
        } catch (error) {
            console.error('[deviceStore] 请求失败:', error);
            deviceData.value = [];
            ids.value = [];
            total.value = 0;
        } finally {
            loading.value = false;
        }
    };

    const handleDelete = async (id) => {
        return await api.post('/api/deviceData/delete', { id });
    };

    const handleAdd = async (item) => {
        return await api.post('/api/deviceData/add', item);
    };

    const handleUpdate = async (item) => {
        return await api.post('/api/deviceData/update', item);
    };

    return {
        deviceData,
        fetchDeviceData,
        total,
        loading,
        handleDelete,
        handleAdd,
        handleUpdate,
        ids
    };
});
