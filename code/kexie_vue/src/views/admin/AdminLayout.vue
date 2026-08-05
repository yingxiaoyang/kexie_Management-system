<template>
  <div class="role-shell">
    <aside class="sidebar">
      <div class="brand">
        <p class="brand-title">管理员端</p>
        <p class="brand-subtitle">后台管理与归档整理</p>
      </div>
      <el-menu :default-active="route.path" router>
        <el-menu-item index="/admin/dashboard">
          <el-icon><DataBoard /></el-icon>
          <span>总览</span>
        </el-menu-item>
        <el-menu-item index="/admin/projects">
          <el-icon><Folder /></el-icon>
          <span>项目管理</span>
        </el-menu-item>
        <el-menu-item index="/admin/people">
          <el-icon><UserFilled /></el-icon>
          <span>人员库</span>
        </el-menu-item>
        <el-menu-item index="/admin/accounts">
          <el-icon><Avatar /></el-icon>
          <span>账号管理</span>
        </el-menu-item>
        <el-menu-item index="/admin/tasks">
          <el-icon><List /></el-icon>
          <span>材料任务</span>
        </el-menu-item>
        <el-menu-item index="/admin/reviews">
          <el-icon><Checked /></el-icon>
          <span>材料审核</span>
        </el-menu-item>
        <el-menu-item index="/admin/archive-templates">
          <el-icon><Files /></el-icon>
          <span>归档模板</span>
        </el-menu-item>
        <el-menu-item index="/admin/exports">
          <el-icon><Download /></el-icon>
          <span>整理包导出</span>
        </el-menu-item>
        <el-menu-item index="/admin/rules">
          <el-icon><Lock /></el-icon>
          <span>参与规则</span>
        </el-menu-item>
      </el-menu>
    </aside>

    <main class="main-area">
      <header class="topbar">
        <h1 class="topbar-title">{{ route.meta.title }}</h1>
        <div class="topbar-tools">
          <el-tag effect="plain">管理员</el-tag>
          <el-button text @click="$router.push('/')">
            <el-icon><Switch /></el-icon>
            切换入口
          </el-button>
        </div>
      </header>
      <section class="content">
        <router-view />
      </section>
    </main>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router'

const route = useRoute()
</script>
