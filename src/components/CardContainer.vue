<template>
  <div id="container">
    <el-select v-model="selectedValue" placeholder="请选择" style="margin-bottom: 20px; width: 200px;">
      <el-option v-for="opt in options" :key="opt.value" :label="opt.label" :value="opt.value" />
    </el-select>

    <div id="ul-wrapper">
      <div v-for="(obj, index) in filteredDataList" :key="index" class="data-card">
        <ul>
          <li v-for="[key, value] in visibleEntries(obj)" :key="key">
            <span class="key">{{ key }}：</span>
            <span class="val">{{ formatValue(key, value) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, computed, watch } from 'vue'
import { DisplayStore } from '@/stores/DisplayStore'

const displayStore = DisplayStore()

const props = defineProps({
  data: { type: Array, default: () => [] },
  fieldUnits: { type: Object, default: () => ({}) }
})

let dataList = ref([])
let options = ref([])
const selectedValue = ref('')

const formatValue = (key, value) => {
  if (key === '创立时间') return displayStore.formatTime(value)
  const unit = props.fieldUnits[key]
  return unit ? `${value} ${unit}` : value
}

// 卡片渲染前过滤字段，避免隐藏 id/编号时留下空行。
const visibleEntries = (obj) => Object.entries(obj).filter(([key]) => displayStore.isFieldVisible(key))

watch(
  () => props.data,
  (newVal) => {
    if (!Array.isArray(newVal) || !newVal.length) return

    dataList.value = newVal
    const firstKey = Object.keys(newVal[0])[0]
    options.value = newVal.map(item => ({
      value: item[firstKey],
      label: item[firstKey]
    }))

    selectedValue.value = newVal[0][firstKey]
  },
  { immediate: true }
)
const filteredDataList = computed(() => {
  if (!dataList.value.length) return []

  const firstKey = Object.keys(dataList.value[0])[0]
  return dataList.value.filter(item => item[firstKey] === selectedValue.value)
})
</script>
<style scoped>
#container {
  padding: 20px;
  background-color: #ffffff;
  min-height: 100%;
  display: block;
}

#ul-wrapper {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  justify-content: flex-start;
}

.data-card {
  background: white;
  border-radius: 12px;
  padding: 18px 20px;
  width: 250px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
}

.data-card li {
  display: flex;
  justify-content: space-between;
  line-height: 22px;
  border-bottom: 1px solid #f1f5f9;
  padding: 10px 0;
}

ul {
  padding: 0;
  list-style: none;
}

.data-card li:last-child {
  border-bottom: none;
}

.key {
  color: #475569;
  font-weight: 500;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.val {
  color: #334155;
  font-size: 14px;
  font-weight: 500;
}

.data-card li:first-child .val {
  color: #374270;
  font-weight: 600;
  font-size: 15px;
}
</style>
