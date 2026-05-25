<template>
  <div class="dynamic-node">
    <div class="node-row">
      <div class="node-header">
        <component v-if="icons[node.id]" :is="icons[node.id]" class="icon" />
        <span class="node-title">{{ node.t_name }}</span>
      </div>
      <div class="node-component">
        <component :is="getComponent(node.f_type)" :node="node" :model-value="formData[node.id]"
          @update:modelValue="val => formData[node.id] = val" @change="val => $emit('update:modelValue', node.id, val)" />
      </div>
    </div>

    <div class="node-children" v-if="matchedChildGroups.length">
      <div v-for="([refKey, children]) in matchedChildGroups" :key="refKey">
        <DynamicNode v-for="child in sortNodes(children)" :key="child.id" :node="child" :form-data="formData"
          :icons="icons" :id="props.id" @update:modelValue="(id, val) => $emit('update:modelValue', id, val)" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, markRaw, defineAsyncComponent } from 'vue'

const props = defineProps({
  node: Object,
  formData: Object, 
  icons: Object,
  id: [Number, String] 
})

const emit = defineEmits(['update:modelValue'])

const compMap = markRaw({
  1: defineAsyncComponent(() => import('./Type1Select.vue')),
  2: defineAsyncComponent(() => import('./Type2Input.vue')),
  3: defineAsyncComponent(() => import('./Type3Slider.vue')),
  default: defineAsyncComponent(() => import('./TypeDefault.vue'))
})

const getComponent = (type) => compMap[type] || compMap.default

const match = (parentVal, refVal) => {
  // off&on 表示子节点不受父节点取值限制，其余情况必须和父值一致。
  if (refVal === 'off&on') return true
  return String(parentVal) === String(refVal)
}

const matchedChildGroups = computed(() => {
  const val = props.formData[props.node.id] 
  const groups = props.node.children || {}
  // 只渲染当前父节点取值命中的子节点分组。
  return Object.entries(groups).filter(([refKey]) => match(val, refKey))
})//[ ["on", [...] ], ["off", [...] ] ]，entries是把对象转换为前面那样子的数组

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
  margin-left: 7px;
  font-size: 16px;
  white-space: nowrap;
  color: #333;
}

.icon {
  width: 1.2em;
  height: 1.2em;
  color: #409eff;
  flex-shrink: 0;
}

.node-children {
  margin-top: 10px;
}
</style>
