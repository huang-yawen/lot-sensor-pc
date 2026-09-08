<!--
 * 【文件职责】
 * 指令配置组件，负责渲染对应控件并把用户输入交给指令状态仓库。
 * 【配置中心关联】
 * 控制字段由后端 t_direct_config.preffix 映射；离线暂存和补发结果由 useDirectStore 统一处理。
 * -->
<template>
  <div class="time-picker-wrap">
    <el-time-picker
      v-model="time"
      format="HH:mm:ss"
      placeholder="选择时间"
      size="large"
      style="width: 160px"
      @change="onChange"
    />
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  node: Object,
  modelValue: [String, Number]
})

const emit = defineEmits(['update:modelValue', 'save'])

// prop 变化时同步到本地
const time = ref(propToDate(props.modelValue))

watch(() => props.modelValue, (val) => {
  time.value = propToDate(val)
})

function propToDate(val) {
  const str = String(val || '')
  const parts = str.split(':')
  const d = new Date()
  d.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, Number(parts[2]) || 0, 0)
  return d
}

function onChange(val) {
  const t = val || new Date()
  const hh = String(t.getHours()).padStart(2, '0')
  const mm = String(t.getMinutes()).padStart(2, '0')
  const ss = String(t.getSeconds()).padStart(2, '0')
  const str = `${hh}:${mm}:${ss}`
  emit('update:modelValue', str)
  emit('save', str)
}
</script>

<style scoped>
.time-picker-wrap {
  display: inline-block;
}
</style>
