/**
 * 【干什么】"设备设置"页（指令中心）的统一入口：加载指令项树、加载某设备的当前值、
 * 下发一条控制指令。所有控件都走这里，避免多个控件各自重复下发、重复弹提示。
 *
 * 【导出】useDirectStore()
 * 【状态】data（指令项树）、renderData（当前设备各指令项的值）、loading
 * 【方法】
 *   fetchDirectData()          → GET /api/directData     加载指令项树
 *   handleRender(d_no)         → GET /api/directRender    加载该设备各指令项当前值，
 *                                返回 { data, singleDeviceMode }
 *   handleUpdateData({ id, value, d_no })  → POST /api/directData/update
 *                                下发一条指令。后端决定：设备在线立即发 MQTT / 离线只暂存；
 *                                返回带 cached 标记（true=只暂存了）。在线时会自动 handleRender 刷新。
 * 【调的接口】GET /api/directData、GET /api/directRender、POST /api/directData/update
 * 【谁在用】DirectSetting.vue（唯一）
 * 【说明】前端只传 config_id / value / d_no；MQTT 主题、值转换、preffix 映射都在后端做。
 */
import { defineStore } from "pinia";
import { ref } from "vue";
import api from "@/api";

export const useDirectStore = defineStore('directStore', () => {
  const data = ref([]);
  const renderData = ref([]);
  const loading = ref(false);

  const fetchDirectData = async () => {
    loading.value = true;
    try {
      const res = await api.get("/api/directData");
      if (res.data.success) {
        data.value = res.data.data || [];
        console.log("[DirectStore] 指令数据加载成功");
      }
    } catch (err) {
      console.error("[DirectStore] 获取指令数据失败:", err);
    } finally {
      loading.value = false;
    }
  };

  const handleRender = async (d_no) => {
    try {
      const res = await api.get("/api/directRender", { params: { d_no } });
      if (res.data.success) {
        renderData.value = res.data.data || [];
        return {
          data: renderData.value,
          singleDeviceMode: res.data.singleDeviceMode !== undefined ? res.data.singleDeviceMode : true
        };
      }
      return { data: [], singleDeviceMode: true };
    } catch (err) {
      console.error("[DirectStore] 获取渲染数据失败:", err);
      return { data: [], singleDeviceMode: true };
    }
  };

  const handleUpdateData = async ({ id, value, d_no }) => {
    try {
      console.log("[DirectStore] 开始更新数据:", { id, value, d_no });

      // 以后端响应为准：在线设备立即发送，离线设备仅暂存，组件不能自行二次发布 MQTT。
      const res = await api.post("/api/directData/update", {
        config_id: id,
        value,
        d_no
      });

      console.log("[DirectStore] 后端响应:", res.data);

      if (res.data.success) {
        const cached = res.data.data?.status === "queued";
        if (!cached) await handleRender(d_no);
        return { ...res.data, cached };
      } else {
        throw new Error(res.data.message || "更新失败");
      }
    } catch (err) {
      console.error("[DirectStore] 更新数据失败:", err);

      if (err.response) {
        throw new Error(err.response.data?.message || "服务器错误");
      } else if (err.request) {
        throw new Error("网络错误，指令未能暂存");
      } else {
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
