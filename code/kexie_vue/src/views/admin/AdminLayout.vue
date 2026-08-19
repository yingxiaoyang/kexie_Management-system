<template>
  <div class="role-shell admin-shell">
    <aside class="sidebar desktop-sidebar">
      <div class="brand">
        <div class="brand-mark">科</div>
        <div class="brand-copy">
          <p class="brand-title">科研项目管理</p>
          <p class="brand-subtitle">{{ adminLevelLabel }}</p>
        </div>
      </div>
      <AdminMenu />
      <div class="sidebar-footer">集中管理项目、人员、任务与审核，数据变更实时进入业务系统。</div>
    </aside>

    <main class="main-area">
      <header class="topbar desktop-topbar">
        <div class="topbar-heading">
          <span class="topbar-kicker">管理后台</span>
          <span class="muted">/</span>
          <h1 class="topbar-title">{{ route.meta.title }}</h1>
        </div>
        <div class="topbar-tools">
          <div class="user-chip">
            <span class="user-avatar">{{ userInitial }}</span>
            <span>{{ displayName }}</span>
          </div>
          <el-button text @click="logout">
            <el-icon><Switch /></el-icon>
            退出登录
          </el-button>
        </div>
      </header>

      <header class="topbar mobile-nav">
        <el-button circle plain aria-label="打开导航" @click="drawerVisible = true">
          <el-icon><Menu /></el-icon>
        </el-button>
        <h1 class="topbar-title">{{ route.meta.title }}</h1>
        <span class="user-avatar">{{ userInitial }}</span>
      </header>

      <section class="content">
        <router-view />
      </section>
    </main>

    <el-drawer v-model="drawerVisible" direction="ltr" size="280px" :with-header="false">
      <div class="brand drawer-brand">
        <div class="brand-mark">科</div>
        <div class="brand-copy">
          <p class="brand-title">科研项目管理</p>
          <p class="brand-subtitle">{{ displayName }}</p>
        </div>
      </div>
      <AdminMenu @select="drawerVisible = false" />
      <el-button style="width: 100%; margin-top: 18px" @click="logout">
        <el-icon><Switch /></el-icon>
        退出登录
      </el-button>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, ref } from 'vue'
import { ElIcon, ElMenu, ElMenuItem } from 'element-plus'
import {
  Avatar,
  Checked,
  DataBoard,
  Download,
  Document,
  Files,
  Folder,
  List,
  Lock,
  Upload,
  UserFilled,
} from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { authStore } from '../../stores/auth'

const route = useRoute()
const router = useRouter()
const drawerVisible = ref(false)
const displayName = computed(() => authStore.state.user?.displayName || '管理员')
const userInitial = computed(() => displayName.value.slice(0, 1))
const adminLevelLabel = computed(() => authStore.isSuperAdmin() ? '超级管理员工作台' : '管理员工作台')

const menuItems = [
  { path: '/admin/dashboard', label: '管理总览', icon: DataBoard },
  { path: '/admin/projects', label: '项目管理', icon: Folder, permission: 'project_management' },
  { path: '/admin/imports', label: '数据导入', icon: Upload, permission: 'data_import' },
  { path: '/admin/people', label: '人员库', icon: UserFilled, permission: 'people_management' },
  { path: '/admin/accounts', label: '账号管理', icon: Avatar, superAdmin: true },
  { path: '/admin/tasks', label: '材料任务', icon: List, permission: 'material_task' },
  { path: '/admin/reviews', label: '材料审核', icon: Checked, permission: 'material_review' },
  { path: '/admin/applications', label: '立项申请', icon: Files, permission: 'application_management' },
  { path: '/admin/archive-templates', label: '归档模板', icon: Files, permission: 'archive_management' },
  { path: '/admin/exports', label: '整理包导出', icon: Download, permission: 'archive_management' },
  { path: '/admin/report-designer', label: '数据报表', icon: Document, permission: 'report_management' },
  { path: '/admin/rules', label: '参与规则', icon: Lock, permission: 'participation_rules' },
]
const visibleMenuItems = computed(() => menuItems.filter((item) => {
  if (item.superAdmin) return authStore.isSuperAdmin()
  return !item.permission || authStore.hasPermission(item.permission)
}))

const AdminMenu = defineComponent({
  emits: ['select'],
  setup(_, { emit }) {
    return () => h(ElMenu, {
      defaultActive: route.path,
      router: true,
      class: 'drawer-menu',
      onSelect: () => emit('select'),
    }, () => visibleMenuItems.value.map((item) => h(ElMenuItem, { index: item.path }, {
      default: () => [h(ElIcon, null, () => h(item.icon)), h('span', item.label)],
    })))
  },
})

async function logout() {
  drawerVisible.value = false
  await authStore.logout().catch(() => {})
  router.replace('/login')
}
</script>
