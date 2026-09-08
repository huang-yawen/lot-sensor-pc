<!--
 * 【文件职责】
 * 指令配置组件，负责渲染对应控件并把用户输入交给指令状态仓库。
 * 【配置中心关联】
 * 控制字段由后端 t_direct_config.preffix 映射；离线暂存和补发结果由 useDirectStore 统一处理。
 * -->
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
