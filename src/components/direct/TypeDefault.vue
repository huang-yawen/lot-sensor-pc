<!--
 * 【文件职责】
 * 指令配置组件，负责渲染对应控件并把用户输入交给指令状态仓库。
 * 【配置中心关联】
 * 控制字段由后端 t_direct_config.preffix 映射；离线暂存和补发结果由 useDirectStore 统一处理。
 * -->
<template>
  <el-input
    v-model="inputValue"
    placeholder="暂无组件类型"
    style="width: 200px;"
    size="small"
    disabled
  />
</template>

<script setup>
import { defineProps, defineEmits, ref, watch } from "vue";

const props = defineProps({
  node: {
    type: Object,
    required: true,
  },
  modelValue: {
    type: [String, Number],
    default: "",
  },
});

const emit = defineEmits(['update:modelValue']);

const inputValue = ref(props.modelValue);

watch(inputValue, (val) => {
  emit('update:modelValue', val);
});

watch(() => props.modelValue, (val) => {
  inputValue.value = val;
});
</script>
