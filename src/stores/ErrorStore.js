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
  // 饼图支持三种统计范围：全部（不带任何筛选）、当前筛选（跟表格同一批数据）、当前页
  // （前端按表格当前页聚合，不发请求）。前两种各存一份，切换范围时不用重新请求。
  const errTypeStatsAll = ref([]);
  const safetyData = ref([]);
  const safetyTotal = ref(0);
  const safetyLoading = ref(false);
  const safetyTypeStats = ref([]);
  const safetyTypeStatsAll = ref([]);
  const linkageData = ref([]);
  const linkageTotal = ref(0);
  const linkageLoading = ref(false);
  const linkageTypeStats = ref([]);
  const linkageTypeStatsAll = ref([]);
  const alarmData = ref([]);
  const alarmTotal = ref(0);
  const alarmLoading = ref(false);
  const alarmTypeStats = ref([]);
  const alarmTypeStatsAll = ref([]);

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
      const response = await api.get("/api/errData", {
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
      const response = await api.get("/api/errData", {
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

  // 联动控制记录：复用同一个 /errData 接口，传 category=linkage 只取联动控制类型，
  // 跟故障记录、安全联锁记录表格各自分开分页、互不影响。
  const fetchLinkageData = async (params = {}) => {
    linkageLoading.value = true;
    try {
      const response = await api.get("/api/errData", {
        params: {
          category: "linkage",
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
        linkageData.value = list.map((item) => ({
          ...item,
          "报警时间": displayStore.formatTime(item["报警时间"]),
        }));
        linkageTotal.value = res.data?.total || list.length;
      }
    } catch (error) {
      console.error("linkageData 请求失败:", error);
    } finally {
      linkageLoading.value = false;
    }
  };

  // 安全告警记录：复用同一个 /errData 接口，传 category=alarm 只取场景配置 ALARM_RULES
  // 触发的规则告警（比如"循环流量偏低预警"），跟故障记录、安全联锁记录、联动控制记录
  // 表格各自分开分页、互不影响。
  const fetchAlarmData = async (params = {}) => {
    alarmLoading.value = true;
    try {
      const response = await api.get("/api/errData", {
        params: {
          category: "alarm",
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
        alarmData.value = list.map((item) => ({
          ...item,
          "报警时间": displayStore.formatTime(item["报警时间"]),
        }));
        alarmTotal.value = res.data?.total || list.length;
      }
    } catch (error) {
      console.error("alarmData 请求失败:", error);
    } finally {
      alarmLoading.value = false;
    }
  };

  // scope='filtered'（默认）：复用列表筛选条件（关键字+时间范围），图表和表格看到同一批数据；
  // scope='all'：不带任何筛选条件，统计数据库里该类型的全部记录，存到单独一份 ref。
  const fetchErrTypeStats = async (params = {}, scope = "filtered") => {
    try {
      const query = scope === "all" ? {} : {
        keyword: params.keyword || "",
        startTime: formatDateTime(params.startTime),
        endTime: formatDateTime(params.endTime),
      };
      const response = await api.get("/api/errTypeStats", { params: query });

      const res = response.data;
      if (res.success) {
        if (scope === "all") errTypeStatsAll.value = res.data || [];
        else errTypeStats.value = res.data || [];
      }
    } catch (error) {
      console.error("errTypeStats 请求失败:", error);
    }
  };

  // 安全联锁类型统计：复用同一个 /errTypeStats 接口，传 category=safety 只统计安全联锁
  // 记录自己的数据，跟故障统计（errTypeStats）完全分开，互不影响。
  const fetchSafetyTypeStats = async (params = {}, scope = "filtered") => {
    try {
      const query = scope === "all" ? { category: "safety" } : {
        category: "safety",
        keyword: params.keyword || "",
        startTime: formatDateTime(params.startTime),
        endTime: formatDateTime(params.endTime),
      };
      const response = await api.get("/api/errTypeStats", { params: query });

      const res = response.data;
      if (res.success) {
        if (scope === "all") safetyTypeStatsAll.value = res.data || [];
        else safetyTypeStats.value = res.data || [];
      }
    } catch (error) {
      console.error("safetyTypeStats 请求失败:", error);
    }
  };

  // 联动控制类型统计：复用同一个 /errTypeStats 接口，传 category=linkage 只统计联动控制
  // 记录自己的数据，跟故障统计、安全联锁统计完全分开，互不影响。
  const fetchLinkageTypeStats = async (params = {}, scope = "filtered") => {
    try {
      const query = scope === "all" ? { category: "linkage" } : {
        category: "linkage",
        keyword: params.keyword || "",
        startTime: formatDateTime(params.startTime),
        endTime: formatDateTime(params.endTime),
      };
      const response = await api.get("/api/errTypeStats", { params: query });

      const res = response.data;
      if (res.success) {
        if (scope === "all") linkageTypeStatsAll.value = res.data || [];
        else linkageTypeStats.value = res.data || [];
      }
    } catch (error) {
      console.error("linkageTypeStats 请求失败:", error);
    }
  };

  // 安全告警类型统计：复用同一个 /errTypeStats 接口，传 category=alarm 只统计安全告警
  // 记录自己的数据，跟故障统计、安全联锁统计、联动控制统计完全分开，互不影响。
  const fetchAlarmTypeStats = async (params = {}, scope = "filtered") => {
    try {
      const query = scope === "all" ? { category: "alarm" } : {
        category: "alarm",
        keyword: params.keyword || "",
        startTime: formatDateTime(params.startTime),
        endTime: formatDateTime(params.endTime),
      };
      const response = await api.get("/api/errTypeStats", { params: query });

      const res = response.data;
      if (res.success) {
        if (scope === "all") alarmTypeStatsAll.value = res.data || [];
        else alarmTypeStats.value = res.data || [];
      }
    } catch (error) {
      console.error("alarmTypeStats 请求失败:", error);
    }
  };

  return {
    fetchErrData,
    fetchErrTypeStats,
    fetchSafetyData,
    fetchSafetyTypeStats,
    fetchLinkageData,
    fetchLinkageTypeStats,
    fetchAlarmData,
    fetchAlarmTypeStats,
    errData,
    errTypeStats,
    errTypeStatsAll,
    total,
    loading,
    safetyData,
    safetyTotal,
    safetyLoading,
    safetyTypeStats,
    safetyTypeStatsAll,
    linkageData,
    linkageTotal,
    linkageLoading,
    linkageTypeStats,
    linkageTypeStatsAll,
    alarmData,
    alarmTotal,
    alarmLoading,
    alarmTypeStats,
    alarmTypeStatsAll,
  };
});
