<!--
 * 【文件职责】
 * 指令配置组件，负责渲染对应控件并把用户输入交给指令状态仓库。
 * 【配置中心关联】
 * 控制字段由后端 t_direct_config.preffix 映射；离线暂存和补发结果由 useDirectStore 统一处理。
 * -->
<template>
  <div style="padding: 0 6px; width: 220px; flex-shrink: 0;">
    <el-slider
      :model-value="Number(modelValue || 0)"
      :min="Number(node.min || 0)"
      :max="Number(node.max || 100)"
      size="default"
      @input="val => $emit('update:modelValue', val)" 
      @change="val => $emit('save', val)"
    />
  </div>
</template>

<script setup>
defineProps({ node: Object, modelValue: [Number, String] })
defineEmits(['update:modelValue', 'save'])
</script>
