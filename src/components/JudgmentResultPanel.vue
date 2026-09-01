<!--
 * 【文件职责】
 * 智能判定结果的可视化展示：结论 + 置信度做成简洁的结果区块，
 * 原始 JSON 响应折叠在下面留作详情/调试，供 SensorHistory/BehaviorHistory 共用。
 * 【配置中心关联】无直接读取；展示内容完全来自调用方传入的判定结果。
 * -->
<template>
  <div v-if="result" class="judgment-result">
    <el-tag v-if="result.mock" type="warning" class="mock-tag" effect="plain" size="small">本地占位判定（服务未启用，不是真实结果）</el-tag>
    <div class="judgment-summary">
      <div class="summary-head">
        <span class="status-dot" :class="isNegative ? 'is-negative' : 'is-normal'"></span>
        <span class="judgment-conclusion">{{ conclusion ?? '（未取到结论，请检查“智能判定”配置里的结果解析设置）' }}</span>
      </div>
      <div v-if="confidencePercent != null" class="judgment-confidence">
        <span class="confidence-label">置信度</span>
        <el-progress :percentage="confidencePercent" :color="isNegative ? '#ef4444' : '#22c55e'" :stroke-width="4" :show-text="false" style="flex: 1" />
        <span class="confidence-number">{{ confidencePercent }}%</span>
      </div>
    </div>
    <el-collapse class="raw-collapse">
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
.mock-tag { margin-bottom: 12px; }

.judgment-summary {
  padding: 4px 0 18px;
  margin-bottom: 16px;
  border-bottom: 1px solid #f4f4f5;
}

.summary-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.is-negative { background: #ef4444; }
.status-dot.is-normal { background: #22c55e; }

.judgment-conclusion { font-size: 18px; font-weight: 600; color: #18181b; letter-spacing: -0.01em; }

.judgment-confidence { display: flex; align-items: center; gap: 10px; color: #71717a; font-size: 12px; padding-left: 17px; }
.confidence-label { flex-shrink: 0; }
.confidence-number { font-weight: 500; color: #52525b; min-width: 34px; text-align: right; }

.raw-collapse { border-top: none; }
.raw-collapse :deep(.el-collapse-item__header) { font-size: 13px; color: #a1a1aa; border-bottom: none; }
.raw-collapse :deep(.el-collapse-item__wrap) { border-bottom: none; }
.raw-json { background: #fafafa; padding: 14px 16px; border-radius: 6px; font-size: 12px; max-height: 300px; overflow: auto; white-space: pre-wrap; word-break: break-all; margin: 0; color: #52525b; }
</style>
