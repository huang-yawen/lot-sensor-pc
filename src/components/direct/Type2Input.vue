<template>
  <el-input
    type="number"
    :model-value="modelValue"
    size="large"
    style="width:150px"
    @input="val => $emit('update:modelValue', val)" 
    @change="val => $emit('save', val)"
  />
</template>

<script setup>
const props = defineProps({ node: Object, modelValue: [Number, String] })
// 我们多定义一个 save 事件，用来告诉父组件：该写数据库了
defineEmits(['update:modelValue', 'save'])
</script>