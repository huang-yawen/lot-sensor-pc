<!--
 * 【文件职责】
 * 指令配置组件，负责渲染对应控件并把用户输入交给指令状态仓库。
 * 【配置中心关联】
 * 控制字段由后端 t_direct_config.preffix 映射；离线暂存和补发结果由 DirectStore 统一处理。
 * -->
<template>
  <el-switch
    :model-value="String(modelValue)" 
    :active-text="activeText"
    :inactive-text="inactiveText"
    :active-value="activeValue"
    :inactive-value="inactiveValue"
    inline-prompt
    size="large"
    @change="val => $emit('update:modelValue', val)"
  />
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  node: Object,
  modelValue: [String, Number, Boolean]
})

defineEmits(['update:modelValue'])

const parse = (v) =>
  v?.split('|').map(i => {
    const [l, val] = i.split(':')
    return { label: l, value: val }
  }) || []

const options = computed(() => parse(props.node.f_value))
const inactive = computed(() => options.value[0] || { label: '关', value: 'off' })
const active   = computed(() => options.value[1] || { label: '开', value: 'on' })

const inactiveText = computed(() => inactive.value.label)
const activeText   = computed(() => active.value.label)
const inactiveValue = computed(() => String(inactive.value.value))
const activeValue   = computed(() => String(active.value.value))
</script>
