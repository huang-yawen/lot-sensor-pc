0<!--
 * 【文件职责】设备指令面板容器。
 * 维护各控件的当前值，监听后端 WebSocket 的缓存补发事件，并确保同一字段同一值的并发操作
 * 不会重复触发“指令已暂存”提示。“控制模式”是 t_direct_config 里除“复位”外几乎所有
 * 指令项的父节点（ref_id 指向它），水泵/加热/各类阈值都是它的子项，按 ref_value 只在
 * 手动或自动模式下显示——级联逻辑全部在数据库配置和 DynamicNode.vue 里，本组件只按
 * “顶层节点有没有子项”分快捷开关/详情卡片两块展示，不掺任何跟控制模式相关的判断。
 * 【配置中心关联】控制字段由 t_direct_config.preffix 映射；SINGLE_DEVICE_MODE 影响设备选择；
 * 离线暂存、上线补发和消息文案均以后端/DirectStore 的结果为准，组件不能直接发布 MQTT。
 * -->
<template>
  <div class="container">
    <div class="quick-switches">
      <DynamicNode v-for="node in quickSwitches" :key="node.id" :node="node" :form-data="formData" :icons="icons"
        compact @save="handleSave" :id="prop.id" />
      <div class="status-card">
        <div class="status-indicator">
          <span class="status-dot" :class="isFault ? 'dot-red' : 'dot-green'"></span>
          <span class="status-text">{{ isFault ? '故障' : '正常' }}</span>
        </div>
      </div>
    </div>

    <div class="detail-nodes">
      <template v-for="node in detailNodes" :key="node.id">
        <DynamicNode :node="node" :form-data="formData" :icons="icons" @save="handleSave" :id="prop.id" />
        <div v-if="node.preffix === 'pid_enabled' && pidHeatingDurationText" class="pid-duration-hint">
          本周期加热时长：{{ pidHeatingDurationText }}
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, markRaw, watch, onUnmounted, ref, nextTick } from "vue";
import { ElMessage } from "element-plus";
import DynamicNode from "@/components/direct/DynamicNode.vue";
import * as Icons from "@element-plus/icons-vue";
import { connect as connectWebSocket, on as wsOn } from "@/utils/websocket";
import api from "@/api";

const prop = defineProps({
  storeData: { type: Array, default: () => [] },
  renderData: { type: Array, default: () => [] },
  handleUpdateData: { type: Function, required: true },
  fetchDirectData: { type: Function, required: true },
  handleRender: { type: Function, required: true },
  id: { type: [String, Number], default: "null" }
});

const data = computed(() => prop.storeData || []);

// 顶层节点里，没有子项的开关（f_type=1）归为一行“快捷开关”（水泵、加热等），
// 其余（带层级的、或非开关类型）走下面的详细卡片区域。
const hasChildren = (node) => Object.values(node.children || {}).some(arr => arr.length > 0);
const isQuickSwitch = (node) => String(node.f_type) === "1" && !hasChildren(node);
const quickSwitches = computed(() => data.value.filter(isQuickSwitch));
const detailNodes = computed(() => data.value.filter(node => !isQuickSwitch(node)));

const formData = reactive({});
const pendingUpdates = new Set();
// 以“设备编号+配置项+值”标识请求中的操作，拦截控件事件重复触发造成的双重下发。
let unsubscribePendingCommands = null;
let unsubscribeDirectUpdate = null;
let unsubscribeBehaviorSync = null;
let unsubscribePidHeating = null;
let unsubscribeHeaterBlocked = null;
let unsubscribeFaultTriggered = null;

// PID 本周期加热时长展示：跟 DirectSetting.vue 的定量停机进度一样订阅 sensor_data
// 里的 _pidHeating 字段，deviceNo 要匹配当前设备号才展示，避免多设备时显示成别的设备。
const pidHeatingStatus = ref(null);
const pidHeatingDurationText = computed(() => {
  if (!pidHeatingStatus.value) return null;
  const targetId = String(prop.id ?? "null");
  const infoId = pidHeatingStatus.value.deviceNo == null ? "null" : String(pidHeatingStatus.value.deviceNo);
  if (infoId !== targetId) return null;
  return (pidHeatingStatus.value.onDurationMs / 1000).toFixed(1) + "s";
});

// PID 恒温控制想开加热但水泵没开，被后端拦下来时提示一次：跟手动模式下点开关被
// 拒绝弹的 ElMessage 是同一件事，只是这次是自动模式下被 PID 自己拦下来的。
// pid_heater_blocked 是独立广播（不像 sensor_data 走节流合并），deviceNo 同样要匹配
// 当前设备号，避免多设备时把别的设备的提示当成自己的弹出来。
function handleHeaterBlocked(info) {
  const targetId = String(prop.id ?? "null");
  const infoId = info?.deviceNo == null ? "null" : String(info.deviceNo);
  if (infoId !== targetId) return;
  ElMessage.warning(info.message || "PID恒温控制：加热被拦截");
}

// 硬编码的开关 preffix ↔ t_behavior_field_mapper.f_name 映射：数据库里没有能直接
// 关联“指令项”和“行为数据字段”的字段，只能靠这份约定维护；如果以后改了水泵/加热
// 的中文名或 preffix，这里要同步改。只覆盖开关类字段，不碰目标温度等参数配置项。
const SWITCH_FIELD_MAP = { pump: "水泵", heater: "加热" };

// 收到设备行为数据上报时，把水泵/加热的真实开关状态同步进表单，这样即使设备状态是
// 被网页以外的方式（物理按钮、设备自身逻辑等）改变的，页面也能实时反映真实值，
// 不用手动刷新。只同步这两个开关字段，不影响用户正在编辑的其他参数。
const syncSwitchStates = async () => {
  try {
    const res = await api.get("/api/dataByType", { params: { type: "behavior", pageSize: 1, page: 1 } });
    const latest = res.data?.data?.list?.[0];
    if (!latest) return;
    prop.storeData.forEach((node) => {
      const fieldLabel = SWITCH_FIELD_MAP[node.preffix];
      if (!fieldLabel || latest[fieldLabel] == null) return;
      formData[node.id] = latest[fieldLabel] === "开" ? "on" : "off";
    });
  } catch (err) {
    console.error("[DeviceSetting] 同步开关真实状态失败:", err);
  }
};
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

// 表单初始化（程序化给 formData 批量赋值）期间，如果某个开关组件因为 model-value
// 变化意外把这次赋值当成"用户操作"往上冒泡了 save 事件（曾经真实发生过：找不到
// 对应渲染数据时，initNode 会把开关填成默认值 off，结果被当成用户把开关拨到了
// off 一样保存了出去），这里直接拦截，不管底层具体是什么机制触发的都挡住——
// 初始化阶段本来就不该产生任何保存请求。
const isInitializing = ref(false);

const initializeForm = async () => {
  isInitializing.value = true;
  try {
    const result = await prop.handleRender(prop.id);
    const latestRenderData = result.data || result || [];

    Object.keys(formData).forEach(key => delete formData[key]);

    if (prop.storeData && prop.storeData.length > 0 && latestRenderData) {
      prop.storeData.forEach(node => initNode(node, latestRenderData));
      console.log("[Frontend Init] 表单初始化完成，d_no: " + prop.id);
    } else {
      console.warn("[Frontend Init] 初始化失败");
    }
    // 等 DOM 更新完成后再多等一轮 tick，覆盖住子组件对 formData 变化做出响应、
    // 从而可能延迟一拍才触发的事件。
    await nextTick();
    await nextTick();
  } finally {
    isInitializing.value = false;
  }
};

const handleUpdate = async (id, value) => {
  if (isInitializing.value) {
    console.warn(`[Frontend] 表单初始化期间收到意外的保存请求，已忽略: id=${id}, value=${JSON.stringify(value)}`);
    return;
  }
  const previousValue = formData[id];
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
      // 复位按钮拨到 off 会走到这里（后端 HTTP 响应带 status:'fault_reset'，不广播），
      // 立刻拉一次故障状态，让「正常/故障」框和随后的 watch(isFault) 表单刷新不必等 5 秒轮询。
      loadFaultState();
    } else {
      // 后端拒绝（如故障锁定、水泵未开不允许开加热等）：开关已经乐观改成了新值，
      // 这里要回退，避免界面显示"已打开"但实际操作被拒绝、设备根本没变化。
      formData[id] = previousValue;
      ElMessage.error(result.message || "更新失败");
    }
  } catch (err) {
    formData[id] = previousValue;
    console.error("[Frontend] 保存失败:", err);
    ElMessage.error(err.message || "更新失败");
  } finally {
    pendingUpdates.delete(updateKey);
  }
};

const handleSave = async (id, value) => {
  await handleUpdate(id, value);
};

// 故障状态：轮询 /faultStatus/state，绿灯=正常，红灯=故障。
// 复位按钮由数据库里的 reset_button 开关承担（DynamicNode 渲染），
// 后端 updateDirectConfigAndPublish.js 拦截 reset_button=off 触发 handleResetButtonOff。
const faultState = reactive({ systemState: "NORMAL", resetButton: "off" });
const isFault = computed(() => faultState.systemState === "FAULT");
let faultTimer = null;

const loadFaultState = async () => {
  try {
    const d_no = prop.id === "null" ? undefined : prop.id;
    const resp = await api.get("/api/faultStatus/state", { params: { d_no } });
    if (resp.data?.data) Object.assign(faultState, resp.data.data);
  } catch { /* 静默失败，不打扰用户 */ }
};

// 故障状态变化时重新拉取指令数据：
// - 正常→故障：后端已把 reset_button 写为 on、执行器全关，刷新页面显示最新状态
// - 故障→正常：用户拨了 reset_button=off，后端从快照恢复，刷新页面显示恢复后的开关和参数
watch(isFault, async (fault, prev) => {
  if (fault !== prev) await initializeForm();
});

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

  unsubscribeDirectUpdate = wsOn('direct_data_updated', async (payload) => {
    const targetId = String(payload?.d_no ?? 'null')
    const myId = String(prop.id)
    if (targetId === myId || targetId === 'null' || payload?.reset) {
      await initializeForm()
    }
  })

  unsubscribeBehaviorSync = wsOn("behavior_data", syncSwitchStates);

  unsubscribePidHeating = wsOn("sensor_data", (payload) => {
    if (payload && payload._pidHeating) pidHeatingStatus.value = payload._pidHeating;
  });

  unsubscribeHeaterBlocked = wsOn("pid_heater_blocked", handleHeaterBlocked);

  // 故障触发是后端即时广播的（app.js 的 onFault）；原本这个状态框只靠下面的 5 秒轮询
  // 刷新，最多能延迟 5 秒。这里收到故障广播就立刻拉一次权威状态；复位（故障->正常）那边
  // 在 handleUpdate 里补了一次；5 秒轮询保留作兜底（漏收 WS、自动恢复、多标签页）。
  unsubscribeFaultTriggered = wsOn("fault_triggered", loadFaultState);

  if (prop.storeData.length === 0) {
    await prop.fetchDirectData();
  }
  await loadFaultState();
  faultTimer = setInterval(loadFaultState, 5000);
});

onUnmounted(() => {
  unsubscribePendingCommands?.();
  unsubscribeDirectUpdate?.();
  unsubscribeBehaviorSync?.();
  unsubscribePidHeating?.();
  unsubscribeHeaterBlocked?.();
  unsubscribeFaultTriggered?.();
  if (faultTimer) clearInterval(faultTimer);
});
</script>

<style scoped>
.container {
  padding: 8px 10px;
}

.quick-switches {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}

/* 跟 DynamicNode.vue 里 .compact 开关卡片保持同一套视觉样式，让状态指示跟水泵/加热并列显示 */
.status-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 180px;
  padding: 12px 18px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-green {
  background: #67c23a;
  box-shadow: 0 0 6px rgba(103, 194, 58, 0.5);
}

.dot-red {
  background: #f56c6c;
  box-shadow: 0 0 6px rgba(245, 108, 108, 0.5);
  animation: pulse 1s ease-in-out infinite;
}

.status-text {
  font-weight: 600;
  font-size: 16px;
  color: #1f2d3d;
  white-space: nowrap;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.detail-nodes {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pid-duration-hint {
  margin: -8px 0 0 4px;
  font-size: 12px;
  color: #909399;
}
</style>
