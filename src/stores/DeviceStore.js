import { defineStore } from "pinia";
import { ref } from 'vue';
import api from '@/api';

export const DeviceStore = defineStore('deviceStore', () => {
    const deviceData = ref([]);
    const loading = ref(false);
    const total = ref(5);
    const ids = ref([]) 

    const fetchDeviceData = async (params = {}) => {
        loading.value = true;
        try {
            console.log('[deviceStore] 发送搜索请求，参数:', params);
            // 设备管理页按关键字拉取列表，同时加时间戳避开浏览器缓存。
            const response = await api.get('/deviceData', {
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
                
                ids.value = [];
                const rawIds = [];

                // 列表数据顺手提取设备编号，供指令设置页选择设备时复用。
                fullList.forEach(item => {
                    console.log('[deviceStore] 单条数据:', item);
                    rawIds.push(item['设备编号'])
                    if (item['创建时间']) {
                        try {
                            item['创建时间'] = new Date(item['创建时间']).toLocaleString('zh-CN', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false
                            });
                        } catch (e) {
                            console.error("日期格式化错误:", e);
                        }
                    }
                });

                ids.value = [...new Set(rawIds)];
                console.log("[deviceStore] 已获取并去重后的设备ID列表:", ids.value);
                deviceData.value = fullList;
            }
        } catch (error) {
            console.error('[deviceStore] 请求失败:', error);
        } finally {
            loading.value = false;
        }
    };

    const handleDelete = async (id) => {
        return await api.post('/deviceData/delete', { id });
    };

    const handleAdd = async (item) => {
        return await api.post('/deviceData/add', item);
    };

    const handleUpdate = async (item) => {
        return await api.post('/deviceData/update', item);
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
