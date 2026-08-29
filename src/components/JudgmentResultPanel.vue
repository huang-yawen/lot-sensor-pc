<!--
 * 【文件职责】
 * 智能判定结果的可视化展示：结论 + 置信度进度条做成醒目的结果卡片，
 * 原始 JSON 响应折叠在下面留作详情/调试，供 SensorHistory/BehaviorHistory 共用。
 * 【配置中心关联】无直接读取；展示内容完全来自调用方传入的判定结果。
 * -->
<template>
  <div v-if="result" class="judgment-result">
    <el-tag v-if="result.mock" type="warning" class="mock-tag">本地占位判定（服务未启用，不是真实结果）</el-tag>
    <div class="judgment-summary" :class="isNegative ? 'is-negative' : 'is-normal'">
      <div class="judgment-conclusion">{{ conclusion ?? '（未取到结论，请检查“智能判定”配置里的结果解析设置）' }}</div>
      <div v-if="confidencePercent != null" class="judgment-confidence">
        <span>置信度</span>
        <el-progress :percentage="confidencePercent" :color="isNegative ? '#f56c6c' : '#67c23a'" :stroke-width="10" style="flex: 1" />
        <span class="confidence-number">{{ confidencePercent }}%</span>
      </div>
    </div>
    <el-collapse>
      <el-collapse-item title="查看原始响应数据">
        <pre class="raw-json">{{ JSON.stringify(result, null, 2) }}</pre>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  // 判定接口返回的 data 对象：{ results, conclusion, confidence, mock }
  result: { type: Object, default: null },
})

const conclusion = computed(() => props.result?.conclusion)

// 置信度可能是 0~1 的小数（常见约定），也可能服务直接返回 0~100 的百分比数值，
// 这里做个兼容：大于 1 就当作已经是百分比，不再乘 100。
const confidencePercent = computed(() => {
  const raw = Number(props.result?.confidence)
  if (!Number.isFinite(raw)) return null
  const percent = raw <= 1 ? raw * 100 : raw
  return Math.max(0, Math.min(100, Math.round(percent)))
})

// 结论文字本身可能是任意分类标签（不一定是"正常/异常"这种二元结果），所以不猜测
// 语义、只按常见的负面关键词做红/绿区分；命中不了任何关键词时按"正常"色（中性偏绿）
// 展示，避免看起来像误报异常。
const NEGATIVE_KEYWORDS = ['异常', '故障', '失败', '错误', 'abnormal', 'error', 'fail', 'fault']
const isNegative = computed(() => {
  const text = String(conclusion.value ?? '').toLowerCase()
  return NEGATIVE_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))
})
</script>

<style scoped>
.mock-tag { margin-bottom: 10px; }
.judgment-summary { padding: 20px; border-radius: 10px; margin-bottom: 14px; }
.judgment-summary.is-negative { background: #fef0f0; border: 1px solid #fbc4c4; }
.judgment-summary.is-normal { background: #f0f9eb; border: 1px solid #c2e7b0; }
.judgment-conclusion { font-size: 22px; font-weight: 700; color: #303133; margin-bottom: 12px; }
.judgment-confidence { display: flex; align-items: center; gap: 10px; color: #606266; font-size: 14px; }
.confidence-number { font-weight: 600; color: #303133; min-width: 42px; text-align: right; }
.raw-json { background: #f5f5f5; padding: 16px; border-radius: 8px; font-size: 13px; max-height: 300px; overflow: auto; white-space: pre-wrap; word-break: break-all; margin: 0; }
</style>
