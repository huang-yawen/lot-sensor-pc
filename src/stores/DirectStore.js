/**
 * 【文件职责】指令配置与下发状态仓库。
 * 加载控制树和设备渲染值，提交单条/批量控制命令，并把后端返回的“已发送/已暂存”结果
 * 交给组件显示。它是避免多个控件重复下发、重复弹出消息的前端统一入口。
 * 【配置中心关联】SINGLE_DEVICE_MODE 由 /directRender 返回；实际 MQTT 主题、值转换和
 * t_direct_config.preffix 字段映射均在后端配置中心/数据库完成，前端只传 config_id、value、d_no。
 * */
import { defineStore } from "pinia";
import { ref } from "vue";
import api from "@/api";

export const DirectStore = defineStore("DirectStore", () => {
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
