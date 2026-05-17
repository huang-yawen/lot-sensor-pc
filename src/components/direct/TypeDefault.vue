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