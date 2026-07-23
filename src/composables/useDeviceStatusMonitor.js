import { ref, onUnmounted, watch } from "vue";
import { ElMessage } from "element-plus";
import { DirectStore } from "@/stores/DirectStore";
import api from "@/api";

export function useDeviceStatusMonitor(deviceId) {
  const store = DirectStore();

  const isMonitoring = ref(false);
  const pollInterval = ref(null);
  const lastKnownStatus = ref(null);
  const cacheCount = ref(0);

  const checkDeviceStatus = async () => {
    if (!deviceId.value || deviceId.value === "null") return false;

    try {
      const res = await api.get("/api/deviceStatus", {
        params: { d_no: deviceId.value }
      });

      if (res.data && res.data.success !== undefined) {
        const isOnline = res.data.isOnline;
        const wasOffline = lastKnownStatus.value === false;
        const becameOnline = wasOffline && isOnline;

        lastKnownStatus.value = isOnline;

        console.log("[DeviceStatusMonitor] 设备 " + deviceId.value + " 状态: " + (isOnline ? "在线" : "离线"));

        if (becameOnline) {
          console.log("[DeviceStatusMonitor] 设备 " + deviceId.value + " 已上线，准备发送缓存指令");
          await sendPendingCommands();
        }

        return isOnline;
      }
    } catch (err) {
      console.error("[DeviceStatusMonitor] 检查设备状态失败:", err);
    }

    return true;
  };

  const sendPendingCommands = async () => {
    const cache = store.commandCache[deviceId.value];
    if (!cache || cache.length === 0) {
      console.log("[DeviceStatusMonitor] 设备 " + deviceId.value + " 没有缓存指令");
      return { cached: false, count: 0 };
    }

    const result = await store.flushCache(deviceId.value);
    if (result.cached && result.count > 0 && result.shouldShowMessage) {
      ElMessage.success("缓存指令已发送 (" + result.count + "条)");
      console.log("[DeviceStatusMonitor] 显示缓存已发送消息（仅一次）");
      cacheCount.value = 0;
    }

    return result;
  };

  const startMonitoring = (interval = 5000) => {
    if (isMonitoring.value) {
      console.warn("[DeviceStatusMonitor] 监控已启动");
      return;
    }

    console.log("[DeviceStatusMonitor] 启动监控，间隔 " + interval + "ms");

    isMonitoring.value = true;
    pollInterval.value = setInterval(() => {
      checkDeviceStatus();
    }, interval);
  };

  const stopMonitoring = () => {
    if (pollInterval.value) {
      clearInterval(pollInterval.value);
      pollInterval.value = null;
    }
    isMonitoring.value = false;
    console.log("[DeviceStatusMonitor] 已停止监控");
  };

  const getCacheSize = () => {
    return store.commandCache[deviceId.value]?.length || 0;
  };

  watch(deviceId, (newDeviceId) => {
    if (newDeviceId && newDeviceId !== "null") {
      lastKnownStatus.value = null;
      cacheCount.value = getCacheSize();

      if (isMonitoring.value) {
        stopMonitoring();
        startMonitoring();
      }
    } else {
      stopMonitoring();
    }
  });

  onUnmounted(() => {
    stopMonitoring();
  });

  return {
    isMonitoring,
    lastKnownStatus,
    cacheCount,
    checkDeviceStatus,
    sendPendingCommands,
    startMonitoring,
    stopMonitoring,
    getCacheSize
  };
}
