import { defineStore } from "pinia";
import { ref } from 'vue';
import api from '@/api';

export const DirectStore = defineStore('DirectStore', () => {
  const data = ref([]);
  const renderData = ref([]);
  const loading = ref(false);        

  const fetchDirectData = async () => {
    loading.value = true;
    try {
      const res = await api.get('/directData');
      if (res.data.success) {
        // 后端返回的数据结构已经是正确的分组结构了
        // treeData['null'] 是第一层的数组
        data.value = res.data.data || [];
        console.log('[DirectStore] 指令数据加载成功');
      }
    } catch (err) {
      console.error('[DirectStore] 获取指令数据失败:', err);
    } finally {
      loading.value = false;
    }
  };

  const handleRender = async (d_no) => {
    try {
      // 渲染数据会把全局默认值和设备专属值合并后返回。
      const res = await api.get('/directRender', { params: { d_no } });
      if (res.data.success) {
        renderData.value = res.data.data || [];
        // 返回包含 data 和 singleDeviceMode 的对象（与移动端一致）
        return {
          data: renderData.value,
          singleDeviceMode: res.data.singleDeviceMode !== undefined ? res.data.singleDeviceMode : true
        };
      }
      return { data: [], singleDeviceMode: true };
    } catch (err) {
      console.error('[DirectStore] 获取渲染数据失败:', err);
      return { data: [], singleDeviceMode: true };
    }
  };

  const handleUpdateData = async ({ id, value, d_no }) => {
    try {
      console.log('[DirectStore] 开始更新数据:', { id, value, d_no });
      // 保存设备设置；后端会同时写库并发布 MQTT。
      const res = await api.post('/directData/update', {
        config_id: id,
        value,
        d_no
      });
      console.log('[DirectStore] 后端响应:', res.data);
      if (res.data.success) {
        console.log('[DirectStore] 数据更新成功');
        // 更新后重新拉取当前设备渲染数据，保证页面值和数据库一致。
        await handleRender(d_no);
        return res.data;
      } else {
        throw new Error(res.data.message || '更新失败');
      }
    } catch (err) {
      console.error('[DirectStore] 更新数据失败:', err);
      // 检查是否是 axios 错误
      if (err.response) {
        // 服务器返回错误状态码
        throw new Error(err.response.data?.message || '服务器错误');
      } else if (err.request) {
        // 请求发出但没有收到响应
        throw new Error('网络错误，请检查服务器是否正常运行');
      } else {
        // 其他错误
        throw err;
      }
    }
  };

  return {
    data,
    renderData,
    loading,
    fetchDirectData,
    handleRender,
    handleUpdateData
  };
});
