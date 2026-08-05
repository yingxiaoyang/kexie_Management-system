<template>
  <div class="role-shell">
    <aside class="sidebar">
      <div class="brand">
        <p class="brand-title">负责人端</p>
        <p class="brand-subtitle">材料提交与项目协作</p>
      </div>
      <el-menu :default-active="route.path" router>
        <el-menu-item index="/owner/dashboard">
          <el-icon><House /></el-icon>
          <span>工作台</span>
        </el-menu-item>
        <el-menu-item index="/owner/projects">
          <el-icon><FolderOpened /></el-icon>
          <span>我的项目</span>
        </el-menu-item>
        <el-menu-item index="/owner/submissions">
          <el-icon><UploadFilled /></el-icon>
          <span>材料提交</span>
        </el-menu-item>
        <el-menu-item index="/owner/contacts">
          <el-icon><Phone /></el-icon>
          <span>项目通讯录</span>
        </el-menu-item>
      </el-menu>
    </aside>

    <main class="main-area">
      <header class="topbar">
        <h1 class="topbar-title">{{ route.meta.title }}</h1>
        <div class="topbar-tools">
          <el-tag type="success" effect="plain">项目负责人</el-tag>
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
