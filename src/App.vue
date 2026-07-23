<!--
 * 【文件职责】
 * Vue 根组件，承载路由出口和全局界面初始化。
 * 【配置中心关联】
 * 全局配置由 SystemConfigStore 获取；子页面应使用仓库中的最新状态。
 * -->
<template>
  <router-view />
</template>
