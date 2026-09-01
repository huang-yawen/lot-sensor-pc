<!--
 * 【文件职责】智能判定结果弹窗，把 el-dialog 外壳和 JudgmentResultPanel 收在一起，
 * 供 SensorHistory/BehaviorHistory 共用同一份弹窗外观，不用两边各写一份。
 * 【配置中心关联】无直接读取；展示内容完全来自调用方传入的判定结果。
 * -->
<template>
  <el-dialog
    :model-value="visible"
    width="560px"
    :close-on-click-modal="false"
    class="judgment-result-dialog"
    @update:model-value="emit('update:visible', $event)"
  >
    <template #header>
      <span class="dialog-title">智能判定结果</span>
    </template>
    <JudgmentResultPanel :result="result" />
    <template #footer>
      <el-button class="close-btn" @click="emit('update:visible', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import JudgmentResultPanel from './JudgmentResultPanel.vue'

defineProps({
  visible: { type: Boolean, default: false },
  // 判定接口返回的 data 对象：{ results, conclusion, confidence, mock }
  result: { type: Object, default: null },
})
const emit = defineEmits(['update:visible'])
</script>

<style scoped>
.dialog-title {
  font-size: 14px;
  font-weight: 500;
  color: #71717a;
}
.close-btn {
  border-radius: 6px;
  padding: 8px 20px;
  background-color: #374270;
  border-color: #374270;
  color: #fff;
}
.close-btn:hover {
  background-color: #4a5a91;
  border-color: #4a5a91;
}
</style>

<style>
.judgment-result-dialog {
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 12px 28px rgba(0, 0, 0, 0.1);
}
.judgment-result-dialog .el-dialog__header {
  padding: 18px 20px 14px;
  margin: 0;
  border-bottom: 1px solid #f4f4f5;
}
.judgment-result-dialog .el-dialog__body {
  padding: 18px 20px;
}
.judgment-result-dialog .el-dialog__footer {
  padding: 0 20px 18px;
  display: flex;
  justify-content: flex-end;
}
</style>
