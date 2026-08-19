<template>
  <div class="role-shell owner-shell applicant-shell">
    <aside class="sidebar desktop-sidebar">
      <div class="brand"><div class="brand-mark">申</div><div class="brand-copy"><p class="brand-title">立项申请门户</p><p class="brand-subtitle">申请人工作区</p></div></div>
      <el-menu :default-active="route.path" router class="drawer-menu"><el-menu-item index="/applicant/applications"><el-icon><Document /></el-icon><span>我的立项申请</span></el-menu-item></el-menu>
      <div class="sidebar-footer">账号仅可访问本人的申请、材料版本与学校结果。</div>
    </aside>
    <main class="main-area">
      <header class="topbar desktop-topbar"><div class="topbar-heading"><span class="topbar-kicker">申请人端</span><span class="muted">/</span><h1 class="topbar-title">{{ route.meta.title }}</h1></div><div class="topbar-tools"><div class="user-chip"><span class="user-avatar">{{ initial }}</span><span>{{ name }}</span></div><el-button text @click="logout"><el-icon><Switch /></el-icon>退出登录</el-button></div></header>
      <header class="topbar mobile-nav"><el-button circle plain @click="drawer = true"><el-icon><Menu /></el-icon></el-button><h1 class="topbar-title">{{ route.meta.title }}</h1><span class="user-avatar">{{ initial }}</span></header>
      <section class="content"><router-view /></section>
    </main>
    <el-drawer v-model="drawer" direction="ltr" size="280px" :with-header="false"><div class="brand drawer-brand"><div class="brand-mark">申</div><div class="brand-copy"><p class="brand-title">立项申请门户</p><p class="brand-subtitle">{{ name }}</p></div></div><el-menu :default-active="route.path" router class="drawer-menu" @select="drawer = false"><el-menu-item index="/applicant/applications"><el-icon><Document /></el-icon><span>我的立项申请</span></el-menu-item></el-menu><el-button style="width:100%;margin-top:18px" @click="logout">退出登录</el-button></el-drawer>
  </div>
</template>
<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Document, Menu, Switch } from '@element-plus/icons-vue'
import { authStore } from '../../stores/auth'
const route = useRoute(), router = useRouter(), drawer = ref(false)
const name = computed(() => authStore.state.user?.displayName || '申请人'), initial = computed(() => name.value.slice(0, 1))
async function logout() { await authStore.logout().catch(() => {}); router.replace('/login') }
</script>
