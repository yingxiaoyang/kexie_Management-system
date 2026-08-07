import { createRouter, createWebHistory } from 'vue-router'
import { authStore } from '../stores/auth'

const routes = [
  { path: '/', redirect: '/login' },
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { title: '登录', public: true } },
  { path: '/change-password', name: 'change-password', component: () => import('../views/ChangePasswordView.vue'), meta: { title: '修改密码' } },
  {
    path: '/owner',
    component: () => import('../views/owner/OwnerLayout.vue'),
    redirect: '/owner/dashboard',
    meta: { roles: ['project_owner'] },
    children: [
      { path: 'dashboard', name: 'owner-dashboard', component: () => import('../views/owner/OwnerDashboard.vue'), meta: { title: '负责人工作台' } },
      { path: 'projects', name: 'owner-projects', component: () => import('../views/owner/OwnerProjects.vue'), meta: { title: '我的项目' } },
      { path: 'submissions', name: 'owner-submissions', component: () => import('../views/owner/OwnerSubmissions.vue'), meta: { title: '材料提交' } },
      { path: 'contacts', name: 'owner-contacts', component: () => import('../views/owner/OwnerContacts.vue'), meta: { title: '项目通讯录' } },
    ],
  },
  {
    path: '/admin',
    component: () => import('../views/admin/AdminLayout.vue'),
    redirect: '/admin/dashboard',
    meta: { roles: ['admin'] },
    children: [
      { path: 'dashboard', name: 'admin-dashboard', component: () => import('../views/admin/AdminDashboard.vue'), meta: { title: '管理员总览' } },
      { path: 'projects', name: 'admin-projects', component: () => import('../views/admin/AdminProjects.vue'), meta: { title: '项目管理' } },
      { path: 'people', name: 'admin-people', component: () => import('../views/admin/AdminPeople.vue'), meta: { title: '人员库管理' } },
      { path: 'accounts', name: 'admin-accounts', component: () => import('../views/admin/AdminAccounts.vue'), meta: { title: '账号管理' } },
      { path: 'tasks', name: 'admin-tasks', component: () => import('../views/admin/AdminMaterialTasks.vue'), meta: { title: '材料任务' } },
      { path: 'reviews', name: 'admin-reviews', component: () => import('../views/admin/AdminReviews.vue'), meta: { title: '材料审核' } },
      { path: 'archive-templates', name: 'admin-archive-templates', component: () => import('../views/admin/AdminArchiveTemplates.vue'), meta: { title: '归档模板' } },
      { path: 'exports', name: 'admin-exports', component: () => import('../views/admin/AdminExports.vue'), meta: { title: '整理包导出' } },
      { path: 'report-designer', name: 'admin-report-designer', component: () => import('../views/admin/AdminReportDesigner.vue'), meta: { title: '数据报表设计器' } },
      { path: 'rules', name: 'admin-rules', component: () => import('../views/admin/AdminRules.vue'), meta: { title: '参与规则' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach(async (to) => {
  if (to.meta.public) {
    if (!authStore.state.initialized) {
      try {
        await authStore.refreshUser()
      } catch {
        // No active HttpOnly Cookie session.
      }
    }
    return authStore.isAuthenticated.value ? authStore.homeForRole() : true
  }
  if (!authStore.state.initialized || !authStore.state.user) {
    try {
      await authStore.refreshUser()
    } catch {
      return { path: '/login', query: { redirect: to.fullPath } }
    }
  }
  if (authStore.state.user.passwordResetRequired && to.path !== '/change-password') return '/change-password'
  if (!authStore.state.user.passwordResetRequired && to.path === '/change-password') return authStore.homeForRole()
  const roles = to.matched.flatMap((record) => record.meta.roles || [])
  if (roles.length && !roles.includes(authStore.state.user.role)) return authStore.homeForRole()
  return true
})

router.afterEach((to) => {
  document.title = `${to.meta.title || '入口'} - 科研项目材料管理平台`
})

export default router
