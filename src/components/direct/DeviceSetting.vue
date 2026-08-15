0<!--
 * 【文件职责】设备指令面板容器。
 * 维护各控件的当前值，监听后端 WebSocket 的缓存补发事件，并确保同一字段同一值的并发操作
 * 不会重复触发“指令已暂存”提示。
 * 【配置中心关联】控制字段由 t_direct_config.preffix 映射；SINGLE_DEVICE_MODE 影响设备选择；
 * 离线暂存、上线补发和消息文案均以后端/DirectStore 的结果为准，组件不能直接发布 MQTT。
 * -->
<template>
  <div class="container">
    <DynamicNode v-for="node in data" :key="node.id" :node="node" :form-data="formData" :icons="icons"
      @save="handleSave"
      :id="prop.id" />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, markRaw, watch, onUnmounted } from "vue";
import { ElMessage } from "element-plus";
import DynamicNode from "@/components/direct/DynamicNode.vue";
import * as Icons from "@element-plus/icons-vue";
import { connect as connectWebSocket, on as wsOn } from "@/utils/websocket";

const prop = defineProps({
  storeData: { type: Array, default: () => [] },
  renderData: { type: Array, default: () => [] },
  handleUpdateData: { type: Function, required: true },
  fetchDirectData: { type: Function, required: true },
  handleRender: { type: Function, required: true },
  id: { type: [String, Number], default: "null" }
});

const data = computed(() => prop.storeData || []);
const formData = reactive({});
const pendingUpdates = new Set();
// 以“设备编号+配置项+值”标识请求中的操作，拦截控件事件重复触发造成的双重下发。
let unsubscribePendingCommands = null;
const icons = markRaw({
  0: Icons.Pointer, 1: Icons.SwitchButton, 2: Icons.Edit,
  3: Icons.Operation, 4: Icons.Guide, 5: Icons.Memo
});

const initNode = (node, customRenderData) => {
  if (!node) return;

  const renderDataToUse = customRenderData || prop.renderData;
  const dbItem = renderDataToUse?.find(i => String(i.config_id) === String(node.id));

  let initialValue;
  if (dbItem && dbItem.value !== null && dbItem.value !== undefined) {
    initialValue = dbItem.value;
    console.log("[Frontend Init] Found value for ID " + node.id + ":", initialValue);
  } else {
    let def = "";
    if (node.f_value) {
      def = node.f_value.split("|")[0]?.split(":")[1] ?? "";
    }
    if (node.f_type === "2" || node.f_type === "3") {
      initialValue = Number(def || node.min || 0);
    } else {
      initialValue = def;
    }
    console.log("[Frontend Init] Using default value for ID " + node.id + ":", initialValue);
  }

  formData[node.id] = initialValue;

  if (node.children) {
    Object.values(node.children).flat().forEach(child => initNode(child, customRenderData));
  }
};

const initializeForm = async () => {
  const result = await prop.handleRender(prop.id);
  const latestRenderData = result.data || result || [];

  Object.keys(formData).forEach(key => delete formData[key]);

  if (prop.storeData && prop.storeData.length > 0 && latestRenderData) {
    prop.storeData.forEach(node => initNode(node, latestRenderData));
    console.log("[Frontend Init] 表单初始化完成，d_no: " + prop.id);
  } else {
    console.warn("[Frontend Init] 初始化失败");
  }
};

const handleUpdate = async (id, value) => {
  formData[id] = value;
  const updateKey = String(id) + ":" + JSON.stringify(value);
  if (pendingUpdates.has(updateKey)) {
    console.warn("[Frontend] 忽略重复提交: " + updateKey);
    return;
  }

  pendingUpdates.add(updateKey);
  try {
    console.log("[Frontend] 开始保存配置: id=" + id + ", value=" + value + ", d_no=" + prop.id);
    const result = await prop.handleUpdateData({ id, value, d_no: prop.id });
    console.log("[Frontend] 配置保存结果:", result);

    if (result.cached) {
      ElMessage({
        message: "指令已暂存",
        type: "warning",
        duration: 2000
      });
      console.log("[Frontend] 显示缓存消息");
    } else if (result.success) {
      ElMessage.success("指令已发送");
      console.log("[Frontend] 显示成功消息");
    } else {
      ElMessage.error(result.message || "更新失败");
    }
  } catch (err) {
    console.error("[Frontend] 保存失败:", err);
    ElMessage.error(err.message || "更新失败");
  } finally {
    pendingUpdates.delete(updateKey);
  }
};

const handleSave = async (id, value) => {
  await handleUpdate(id, value);
};

watch(
  () => prop.id,
  async (newId) => {
    if (newId) {
      if (prop.storeData.length === 0) {
        await prop.fetchDirectData();
      }
      await initializeForm();
    }
  },
  { immediate: true }
);

onMounted(async () => {
  unsubscribePendingCommands = wsOn("pending_commands_flushed", async (payload) => {
    if (String(payload?.deviceId) !== String(prop.id)) return;
    await initializeForm();
    ElMessage.success("缓存指令已发送");
  });
  connectWebSocket();

  if (prop.storeData.length === 0) {
    await prop.fetchDirectData();
  }
});

onUnmounted(() => {
  unsubscribePendingCommands?.();
});
</script>

<style scoped>
.container {
  padding: 8px 10px;
}
</style>
