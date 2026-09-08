<!--
 * 【文件职责】递归控制节点渲染器。
 * 根据 t_direct_config 的 f_type 动态选择开关、输入框、滑块或时间控件，并递归渲染
 * parent_id 子节点；本组件只向上冒泡一次保存事件。用 depth 区分层级做视觉样式（顶层是
 * 卡片，子层是嵌套面板），compact 用于顶部“快捷开关”一行式紧凑布局。
 * 【配置中心关联】f_type、parent_id、preffix 来自控制配置元数据；useDisplayStore 控制字段可见性。
 * 真实协议字段转换在后端完成，前端不可根据显示名称自行拼装 MQTT 载荷。
 * -->
<template>
  <div
    v-if="!shouldHideField(node?.t_name, visibility)"
    class="dynamic-node"
    :class="[compact ? 'compact' : `depth-${Math.min(depth, 2)}`]"
  >
    <div class="node-row">
      <div class="node-header">
        <span v-if="!compact && depth > 0" class="node-dot"></span>
        <span class="node-title">{{ node.t_name }}</span>
      </div>
      <div class="node-component">
        <component :is="getComponent(node.f_type)" :node="node" :model-value="formData[node.id]"
          @update:modelValue="val => handleLocalUpdate(node.id, val)"
          @save="val => $emit('save', node.id, val)" />
      </div>
    </div>

    <div class="node-children" v-if="matchedChildGroups.length">
      <div v-for="([refKey, children]) in matchedChildGroups" :key="refKey">
        <DynamicNode v-for="child in sortNodes(children)" :key="child.id" :node="child" :form-data="formData"
          :icons="icons" :id="props.id" :depth="depth + 1"
          @save="(id, val) => $emit('save', id, val)" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, markRaw, defineAsyncComponent } from 'vue'
import { useDisplayStore } from '@/stores/DisplayStore'

const visibility = useDisplayStore()

const props = defineProps({
  node: Object,
  formData: Object,
  icons: Object,
  id: [Number, String],
  depth: { type: Number, default: 0 },
  compact: { type: Boolean, default: false }
})

const emit = defineEmits(['save'])

// 本地暂存表单值
const handleLocalUpdate = (id, val) => {
  props.formData[id] = val
  // 开关没有独立的 save 事件，值变化即表示用户已确认。
  if (String(props.node.f_type) === '1') emit('save', id, val)
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
  margin-bottom: 14px;
}

.node-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-width: 140px;
}

.node-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #c0c4cc;
  flex-shrink: 0;
}

.node-title {
  font-weight: 600;
  font-size: 16px;
  white-space: nowrap;
  color: #333;
}

.node-children {
  margin-top: 12px;
}

/* ===== 顶层节点：卡片样式，视觉上是一个独立的功能区块 ===== */
.dynamic-node.depth-0 {
  padding: 16px 18px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.dynamic-node.depth-0 > .node-row .node-title {
  font-size: 18px;
  color: #1f2d3d;
}

/* ===== 子层节点：嵌套面板，左侧强调线 + 浅色背景，跟顶层卡片区分开 ===== */
.dynamic-node.depth-1,
.dynamic-node.depth-2 {
  padding: 10px 14px;
  margin-left: 4px;
  background: #f7f9fc;
  border-left: 3px solid #a0cfff;
  border-radius: 0 6px 6px 0;
}
.dynamic-node.depth-2 {
  background: #fbfbfd;
  border-left-color: #d3d9e2;
}
.dynamic-node.depth-1 .node-title,
.dynamic-node.depth-2 .node-title {
  font-size: 14px;
  color: #606266;
  font-weight: 500;
}

/* ===== 紧凑模式：顶部“快捷开关”一行式卡片，用于水泵/加热这类独立开关 ===== */
.dynamic-node.compact {
  margin-bottom: 0;
  padding: 12px 18px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  min-width: 180px;
}
.dynamic-node.compact .node-row {
  justify-content: space-between;
  gap: 16px;
}
.dynamic-node.compact .node-title {
  font-size: 16px;
  color: #1f2d3d;
}
</style>
