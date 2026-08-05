<template>
  <main class="home">
    <div class="home-inner">
      <el-tag type="info" effect="plain">前端基础入口</el-tag>
      <h1 class="home-title">科研项目材料管理平台</h1>
      <p class="home-desc">
        当前前端已按项目负责人端和管理员端拆分入口，后续可在现有页面中逐步接入登录、
        项目导入、材料提交、审核和归档导出接口。
      </p>

      <section class="quick-entry">
        <RouterLink class="entry-card" to="/owner/dashboard">
          <el-icon size="26"><User /></el-icon>
          <h2>项目负责人端</h2>
          <p>查看我的项目、待提交材料、退回原因和项目通讯录。</p>
        </RouterLink>

        <RouterLink class="entry-card" to="/admin/dashboard">
          <el-icon size="26"><Setting /></el-icon>
          <h2>管理员端</h2>
          <p>管理项目、人员、材料任务、审核流、归档模板和导出记录。</p>
        </RouterLink>

        <a class="entry-card" :href="apiBaseUrl" target="_blank" rel="noreferrer">
          <el-icon size="26"><Connection /></el-icon>
          <h2>后端接口地址</h2>
          <p>{{ apiBaseUrl }}</p>
        </a>
      </section>
    </div>
  </main>
</template>

<script setup>
import { API_BASE_URL } from '../config/api'

const apiBaseUrl = API_BASE_URL
</script>
