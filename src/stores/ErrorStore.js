/**
 * 【文件职责】
 * Pinia 状态仓库，集中管理前端共享状态和异步业务操作。
 * 【配置中心关联】
 * 如读取配置中心，必须通过接口或 SystemConfigStore 获取最新值，不能长期写死场景参数。
 * */
import { defineStore } from "pinia";
import { ref } from "vue";
import api from '@/api';
import { DisplayStore } from '@/stores/DisplayStore';

export const ErrorStore = defineStore("ErrorStore", () => {
  const errData = ref([]);
  const total = ref(0);
  const loading = ref(false);
  const errTypeStats = ref([]);
  const safetyData = ref([]);
  const safetyTotal = ref(0);
  const safetyLoading = ref(false);
  const safetyTypeStats = ref([]);

  const formatDateTime = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const pad = (num) => String(num).padStart(2, "0");
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
    ].join("-") + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };

  // 异步获取数据
  const fetchErrData = async (params = {}) => {
    loading.value = true;
    try {
      // 故障列表支持关键字、时间范围和分页筛选，时间先转成后端可比较的字符串。
      const response = await api.get("/errData", {
        params: {
          page: params.currentPage || 1,
          keyword: params.keyword || "",
          pageSize: params.pageSize || 5,
          startTime: formatDateTime(params.startTime),
          endTime: formatDateTime(params.endTime),
        },
      });

      const res = response.data;
      if (res.success) {
        const list = res.data?.list || [];

        // 时间格式化
        const displayStore = DisplayStore()
        errData.value = list.map((item) => ({
          ...item,
          "报警时间": displayStore.formatTime(item["报警时间"]),
        }));

        total.value = res.data?.total || list.length;
      }
    } catch (error) {
      console.error("errMsgStore 请求失败:", error);
    } finally {
      loading.value = false;
    }
  };

  // 安全联锁记录：复用同一个 /errData 接口，传 category=safety 只取安全联锁/安全告警类型，
  // 跟故障记录表格分开分页、互不影响。
  const fetchSafetyData = async (params = {}) => {
    safetyLoading.value = true;
    try {
      const response = await api.get("/errData", {
        params: {
          category: "safety",
          page: params.currentPage || 1,
          keyword: params.keyword || "",
          pageSize: params.pageSize || 5,
          startTime: formatDateTime(params.startTime),
          endTime: formatDateTime(params.endTime),
        },
      });

      const res = response.data;
      if (res.success) {
        const list = res.data?.list || [];
        const displayStore = DisplayStore()
        safetyData.value = list.map((item) => ({
          ...item,
          "报警时间": displayStore.formatTime(item["报警时间"]),
        }));
        safetyTotal.value = res.data?.total || list.length;
      }
    } catch (error) {
      console.error("safetyData 请求失败:", error);
    } finally {
      safetyLoading.value = false;
    }
  };

  const fetchErrTypeStats = async (params = {}) => {
    try {
      // 统计接口复用列表筛选条件，保证图表和表格看到的是同一批故障数据。
      const response = await api.get("/errTypeStats", {
        params: {
          keyword: params.keyword || "",
          startTime: formatDateTime(params.startTime),
          endTime: formatDateTime(params.endTime),
        },
      });

      const res = response.data;
      if (res.success) {
        errTypeStats.value = res.data || [];
      }
    } catch (error) {
      console.error("errTypeStats 请求失败:", error);
    }
  };

  // 安全联锁类型统计：复用同一个 /errTypeStats 接口，传 category=safety 只统计安全联锁
  // 记录自己的数据，跟故障统计（errTypeStats）完全分开，互不影响。
  const fetchSafetyTypeStats = async (params = {}) => {
    try {
      const response = await api.get("/errTypeStats", {
        params: {
          category: "safety",
          keyword: params.keyword || "",
          startTime: formatDateTime(params.startTime),
          endTime: formatDateTime(params.endTime),
        },
      });

      const res = response.data;
      if (res.success) {
        safetyTypeStats.value = res.data || [];
      }
    } catch (error) {
      console.error("safetyTypeStats 请求失败:", error);
    }
  };

  return {
    fetchErrData,
    fetchErrTypeStats,
    fetchSafetyData,
    fetchSafetyTypeStats,
    errData,
    errTypeStats,
    total,
    loading,
    safetyData,
    safetyTotal,
    safetyLoading,
    safetyTypeStats,
  };
});
