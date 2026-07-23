<template>
  <div class="calibrate-wrap">
    <!-- 模式指示 -->
    <div class="calibrate-mode-tip">
      <span class="mode-badge" :class="isManualMode ? 'mode-manual' : 'mode-auto'">
        {{ isManualMode ? '手动' : '自动' }}
      </span>
      <span class="mode-desc">{{ isManualMode ? '请选择校准时间' : '自动获取当前北京时间' }}</span>
    </div>

    <!-- 手动模式：显示完整日期时间选择器 -->
    <div v-if="isManualMode" class="datetime-picker-row">
      <el-date-picker
        v-model="manualDateTime"
        type="datetime"
        placeholder="选择校准日期时间"
        format="YYYY-MM-DD HH:mm:ss"
        value-format="YYYY-MM-DD HH:mm:ss"
        size="large"
        style="width: 100%"
        :disabled-date="disabledDate"
      />
    </div>

    <!-- 自动模式：显示当前北京时间（只读） -->
    <div v-else class="auto-time-display">
      <span class="auto-time-text">{{ beijingTimeStr }}</span>
    </div>

    <!-- 提交按钮（仅手动模式显示） -->
    <div class="cal-submit-row" v-if="isManualMode">
      <el-button
        type="primary"
        size="large"
        :loading="calSubmitting"
        :disabled="calSubmitting || !manualDateTime"
        @click="onCalibrateSubmit"
      >
        {{ calSubmitting ? '提交中...' : '校准时间' }}
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  node: Object,
  modelValue: [String, Number],
  isManualMode: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'save'])

const calSubmitting = ref(false)
const manualDateTime = ref(null)

// 日期时间数据
const weeks = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 当前北京时间字符串（自动模式显示用）
const beijingTimeStr = ref('')
let beijingTimer = null

function updateBeijingTimeStr() {
  const now = new Date()
  const bjOffset = 8 * 60
  const localOffset = now.getTimezoneOffset()
  const bjTime = new Date(now.getTime() + (bjOffset + localOffset) * 60000)

  const y = String(bjTime.getFullYear())
  const m = String(bjTime.getMonth() + 1).padStart(2, '0')
  const d = String(bjTime.getDate()).padStart(2, '0')
  const w = weeks[bjTime.getDay()]
  const h = String(bjTime.getHours()).padStart(2, '0')
  const min = String(bjTime.getMinutes()).padStart(2, '0')
  const s = String(bjTime.getSeconds()).padStart(2, '0')

  beijingTimeStr.value = `${y}-${m}-${d} ${w} ${h}:${min}:${s}`
}

// 禁用未来日期
const disabledDate = (time) => {
  return time.getTime() > Date.now()
}

onMounted(() => {
  updateBeijingTimeStr()
  beijingTimer = setInterval(updateBeijingTimeStr, 1000)
})

onUnmounted(() => {
  if (beijingTimer) {
    clearInterval(beijingTimer)
  }
})

const onCalibrateSubmit = async () => {
  if (calSubmitting.value || !manualDateTime.value) return
  calSubmitting.value = true

  try {
    // 手动模式：发送用户选择的时间
    // 格式：YYYY-MM-DD-周X HH:mm:ss
    const dateObj = new Date(manualDateTime.value)
    const weekNum = dateObj.getDay() === 0 ? 7 : dateObj.getDay()
    
    const datePart = manualDateTime.value.slice(0, 10)
    const timePart = manualDateTime.value.slice(11)
    const timeStr = `${datePart}-${weekNum} ${timePart}`
    
    const payload = { set: timeStr }
    emit('update:modelValue', JSON.stringify(payload))
    emit('save', JSON.stringify(payload))
  } catch (err) {
    console.error('[Calibrate] 提交失败:', err)
  } finally {
    calSubmitting.value = false
  }
}
</script>

<style scoped>
.calibrate-wrap {
  background: #f8faff;
  border: 1px solid #dbeafe;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 8px;
  max-width: 400px;
}

.calibrate-mode-tip {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.mode-badge {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 4px;
  font-weight: 500;
}

.mode-manual {
  background: #fef3c7;
  color: #d97706;
  border: 1px solid #fcd34d;
}

.mode-auto {
  background: #d1fae5;
  color: #059669;
  border: 1px solid #6ee7b7;
}

.mode-desc {
  font-size: 13px;
  color: #6b7280;
}

.datetime-picker-row {
  margin-bottom: 12px;
}

.auto-time-display {
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 8px;
  padding: 16px;
  text-align: center;
  margin-bottom: 12px;
}

.auto-time-text {
  font-size: 18px;
  font-weight: 600;
  color: #0369a1;
  font-family: monospace;
}

.cal-submit-row {
  display: flex;
  justify-content: center;
  margin-top: 8px;
}
</style>
