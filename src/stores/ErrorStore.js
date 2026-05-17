import { defineStore } from "pinia";
import axios from "axios";
import { ref } from "vue";

export const ErrorStore = defineStore("ErrorStore", () => {
  const errData = ref([]);
  const total = ref(0);
  const loading = ref(false);

  // 异步获取数据
  const fetchErrData = async (params = {}) => {
    loading.value = true;
    try {
      // axios会自动将响应数据解析为JSON,所以不用.json,但是fetch不行，所以要自己去.json
      const response = await axios.get("http://localhost:3000/errData", {
        params: {
          page: params.currentPage || 1,
          keyword: params.keyword || "",
          pageSize: params.pageSize || 5,
        },
        headers: {
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        },
      });

      const res = response.data;
      if (res.success) {
        const list = res.data?.list || [];

        // 时间格式化
        errData.value = list.map((item) => ({
          ...item,
          "报错时间": item["报错时间"]
            ? new Date(item["报错时间"]).toLocaleString("zh-CN", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })
            : "未知时间",
        }));

        total.value = res.data?.total || list.length;
      }
    } catch (error) {
      console.error("errMsgStore 请求失败:", error);
    } finally {
      loading.value = false;
    }
  };

  return {
    fetchErrData,
    errData,
    total,
    loading,
  };
});
