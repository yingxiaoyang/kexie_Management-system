<template>
  <div class="role-shell owner-shell">
    <aside class="sidebar desktop-sidebar">
      <div class="brand">
        <div class="brand-mark">研</div>
        <div class="brand-copy">
          <p class="brand-title">负责人门户</p>
          <p class="brand-subtitle">项目材料协作中心</p>
        </div>
      </div>
      <OwnerMenu />
      <div class="sidebar-footer">聚焦待办、截止时间与材料状态，让每一次提交都有清晰反馈。</div>
    </aside>

    <main class="main-area">
      <header class="topbar desktop-topbar">
        <div class="topbar-heading">
          <span class="topbar-kicker">负责人端</span>
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
        <div class="brand-mark">研</div>
        <div class="brand-copy">
          <p class="brand-title">负责人门户</p>
          <p class="brand-subtitle">{{ displayName }}</p>
        </div>
      </div>
      <OwnerMenu @select="drawerVisible = false" />
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
import { FolderOpened, House, Phone, UploadFilled } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { authStore } from '../../stores/auth'

const route = useRoute()
const router = useRouter()
const drawerVisible = ref(false)
const displayName = computed(() => authStore.state.user?.displayName || '项目负责人')
const userInitial = computed(() => displayName.value.slice(0, 1))

const menuItems = [
  { path: '/owner/dashboard', label: '工作台', icon: House },
  { path: '/owner/projects', label: '我的项目', icon: FolderOpened },
  { path: '/owner/submissions', label: '材料提交', icon: UploadFilled },
  { path: '/owner/contacts', label: '项目通讯录', icon: Phone },
]

const OwnerMenu = defineComponent({
  emits: ['select'],
  setup(_, { emit }) {
    return () => h(ElMenu, {
      defaultActive: route.path,
      router: true,
      class: 'drawer-menu',
      onSelect: () => emit('select'),
    }, () => menuItems.map((item) => h(ElMenuItem, { index: item.path }, {
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
