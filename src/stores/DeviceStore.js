import { defineStore } from "pinia";
import { ref } from 'vue';
import axios from "axios";

export const DeviceStore = defineStore('deviceStore', () => {
    const deviceData = ref([]);
    const loading = ref(false);
    const total = ref(5);
    const ids = ref([]) 

    const fetchDeviceData = async (params = {}) => {
        loading.value = true;
        try {
            console.log('[deviceStore] 发送搜索请求，参数:', params);
            const response = await axios.get('http://localhost:3000/deviceData', {
                params: {
                    currentPage: params.currentPage || 1,
                    pageSize: params.pageSize || 5,
                    input: params.input || '',
                    timestamp: Date.now()
                },
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });

            console.log('[deviceStore] 收到完整响应:', response);

            if (response.data.success) {
                const fullList = Array.isArray(response.data.data.list) ? response.data.data.list : [];
                console.log('[deviceStore] 原始数据列表:', fullList);
                
                ids.value = [];
                const rawIds = [];

                fullList.forEach(item => {
                    console.log('[deviceStore] 单条数据:', item);
                    rawIds.push(item['电车编号id'])
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
        return await axios.post('http://localhost:3000/deviceData/delete', { id });
    };

    const handleAdd = async (item) => {
        return await axios.post('http://localhost:3000/deviceData/add', item);
    };

    const handleUpdate = async (item) => {
        return await axios.post('http://localhost:3000/deviceData/update', item);
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