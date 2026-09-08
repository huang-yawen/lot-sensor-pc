/**
 * 【干什么】设备管理页的数据和增删改操作。列表加载时顺手把设备编号去重存进 ids，
 * 供"设备设置"页选择设备时复用。
 *
 * 【导出】useDeviceStore()
 * 【状态】deviceData（列表）、total、loading、ids（去重后的设备编号数组）
 * 【方法】
 *   fetchDeviceData({ currentPage, pageSize, input, searchMode })  → GET /api/deviceData
 *   handleAdd(item)     → POST /api/deviceData/add     （item: { 设备名称, 设备编号, 内部编号?, 备注? }）
 *   handleUpdate(item)  → POST /api/deviceData/update  （item 另带 oldId）
 *   handleDelete(id)    → POST /api/deviceData/delete
 * 【调的接口】GET /api/deviceData、POST /api/deviceData/{add,update,delete}
 * 【谁在用】DeviceManagement.vue（增删改）、DirectSetting.vue（拿 ids 做设备下拉）
 * 【依赖】DisplayStore.formatTime（格式化"创建时间"列）
 */
import { defineStore } from "pinia";
import { ref } from 'vue';
import api from '@/api';
import { useDisplayStore } from '@/stores/useDisplayStore';

export const useDeviceStore = defineStore('deviceStore', () => {
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
                            const displayStore = useDisplayStore()
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
