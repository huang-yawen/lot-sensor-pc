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
      const res = await api.get("/directData");
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
      const res = await api.get("/directRender", { params: { d_no } });
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

      const res = await api.post("/directData/update", {
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
