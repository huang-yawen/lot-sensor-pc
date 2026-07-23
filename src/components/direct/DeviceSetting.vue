<template>
  <div class="container">
    <DynamicNode v-for="node in data" :key="node.id" :node="node" :form-data="formData" :icons="icons"
      :is-manual-mode="isManualMode"
      @update:modelValue="handleUpdate"
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
let unsubscribePendingCommands = null;
const icons = markRaw({
  0: Icons.Pointer, 1: Icons.SwitchButton, 2: Icons.Edit,
  3: Icons.Operation, 4: Icons.Guide, 5: Icons.Memo
});

// 判断校准组件是否为手动模式
const isManualMode = computed(() => {
  return String(formData[0] || "off") === "off";
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
