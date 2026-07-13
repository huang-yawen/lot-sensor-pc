<template>
  <div class="dynamic-node" v-if="!shouldHideField(node?.t_name, visibility)">
    <div class="node-row">
      <div class="node-header">
        <span class="node-title">{{ node.t_name }}</span>
      </div>
      <div class="node-component">
        <component :is="getComponent(node.f_type)" :node="node" :model-value="formData[node.id]"
          :is-manual-mode="isManualMode"
          @update:modelValue="val => handleLocalUpdate(node.id, val)"
          @change="val => $emit('update:modelValue', node.id, val)"
          @save="val => $emit('save', node.id, val)" />
      </div>
    </div>

    <div class="node-children" v-if="matchedChildGroups.length">
      <div v-for="([refKey, children]) in matchedChildGroups" :key="refKey">
        <DynamicNode v-for="child in sortNodes(children)" :key="child.id" :node="child" :form-data="formData"
          :icons="icons" :id="props.id" :is-manual-mode="isManualMode"
          @update:modelValue="(id, val) => $emit('update:modelValue', id, val)"
          @save="(id, val) => $emit('save', id, val)" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, markRaw, defineAsyncComponent } from 'vue'
import { DisplayStore } from '@/stores/DisplayStore'
import { ElMessage } from 'element-plus'

const visibility = DisplayStore()

const props = defineProps({
  node: Object,
  formData: Object, 
  icons: Object,
  id: [Number, String],
  isManualMode: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'save'])

// 本地暂存表单值
const handleLocalUpdate = (id, val) => {
  props.formData[id] = val
  ElMessage({ message: '指令已暂存', type: 'success', duration: 1500 })
}

// 与移动端 DirectNodeMobile.vue 一致的字段可见性判断
const shouldHideField = (field, settings) => {
  if (!settings) return false
  return !settings.isFieldVisible(field)
}

const compMap = markRaw({
  1: defineAsyncComponent(() => import('./Type1Select.vue')),
  2: defineAsyncComponent(() => import('./Type2Input.vue')),
  3: defineAsyncComponent(() => import('./Type3Slider.vue')),
  4: defineAsyncComponent(() => import('./Type4Time.vue')),
  6: defineAsyncComponent(() => import('./Type6Calibrate.vue')),
  default: defineAsyncComponent(() => import('./TypeDefault.vue'))
})

const getComponent = (type) => compMap[type] || compMap.default

const match = (parentVal, refVal) => {
  if (refVal === 'off&on') return true
  return String(parentVal) === String(refVal)
}

const matchedChildGroups = computed(() => {
  const val = props.formData[props.node.id] 
  const groups = props.node.children || {}
  return Object.entries(groups).filter(([refKey]) => match(val, refKey))
})

const sortNodes = (nodes) => [...nodes].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
</script>

<style scoped>
.dynamic-node {
  margin-bottom: 18px;
  padding-left: 14px;
  border-left: 1px dashed #ddd;
}

.node-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.node-header {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  min-width: 120px;
}

.node-title {
  font-weight: 600;
  font-size: 19px;
  white-space: nowrap;
  color: #333;
}

.node-children {
  margin-top: 10px;
}
</style>