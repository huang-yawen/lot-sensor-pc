<template>
  <div class="container">
    <DynamicNode v-for="node in data" :key="node.id" :node="node" :form-data="formData" :icons="icons"
      @update:modelValue="handleUpdate" :id="prop.id" />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, markRaw, watch } from 'vue'
import DynamicNode from '@/components/direct/DynamicNode.vue'
import * as Icons from '@element-plus/icons-vue'

const prop = defineProps({
  storeData: { type: Array, default: () => [] },
  renderData: { type: Array, default: () => [] },
  handleUpdateData: { type: Function, required: true },
  fetchDirectData: { type: Function, required: true },
  handleRender: { type: Function, required: true },
  id: { type: [Number, String], default: 'null' }
})

const data = computed(() => prop.storeData || [])
const formData = reactive({})
const icons = markRaw({
  0: Icons.Pointer, 1: Icons.SwitchButton, 2: Icons.Edit,
  3: Icons.Operation, 4: Icons.Guide, 5: Icons.Memo
})

const initNode = (node, customRenderData) => {
  if (!node) return

  const renderDataToUse = customRenderData || prop.renderData;

  const dbItem = renderDataToUse?.find(i => String(i.config_id) === String(node.id))

  let initialValue;
  if (dbItem && dbItem.value !== null && dbItem.value !== undefined) {
    initialValue = dbItem.value
    console.log(`[Frontend Init] Found value for ID ${node.id} (${prop.id}):`, initialValue);
  } else {
    let def = '';
    if (node.f_value) {
      def = node.f_value.split('|')[0]?.split(':')[1] ?? ''
    }
    if (node.f_type === '2' || node.f_type === '3') {
      initialValue = Number(def || node.min || 0)
    } else {
      initialValue = def
    }
    console.log(`[Frontend Init] Using default value for ID ${node.id} (${prop.id}):`, initialValue);
  }

  formData[node.id] = initialValue

  if (node.children) {
    Object.values(node.children).flat().forEach(child => initNode(child, customRenderData))
  }
}

const initializeForm = async () => {
  const latestRenderData = await prop.handleRender(prop.id);

  Object.keys(formData).forEach(key => delete formData[key]);

  if (prop.storeData && prop.storeData.length > 0 && latestRenderData) {
    prop.storeData.forEach(node => initNode(node, latestRenderData));
    console.log(`[Frontend Init] 表单初始化完成，d_no: ${prop.id}`);
  } else {
    console.warn(`[Frontend Init] 初始化失败: storeData (${prop.storeData.length}) 或 latestRenderData 为空。`);
  }
}

const handleUpdate = async (id, value) => {
  formData[id] = value;
  try {
    await prop.handleUpdateData({ id, value, d_no: prop.id });
  } catch (err) {
    console.error('保存失败:', err);
  }
}

watch(() => prop.id, async (newId) => {
  if (newId) {
    if (prop.storeData.length === 0) {
      await prop.fetchDirectData();
    }
    await initializeForm();
  }
}, { immediate: true });

onMounted(async () => {
  if (prop.storeData.length === 0) {
    await prop.fetchDirectData();
  }
});
</script>

<style scoped>
.container {
  padding: 8px 10px;
}
</style>