import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
  },
  {
    path: '/owner',
    component: () => import('../views/owner/OwnerLayout.vue'),
    redirect: '/owner/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'owner-dashboard',
        component: () => import('../views/owner/OwnerDashboard.vue'),
        meta: { title: '负责人工作台' },
      },
      {
        path: 'projects',
        name: 'owner-projects',
        component: () => import('../views/owner/OwnerProjects.vue'),
        meta: { title: '我的项目' },
      },
      {
        path: 'submissions',
        name: 'owner-submissions',
        component: () => import('../views/owner/OwnerSubmissions.vue'),
        meta: { title: '材料提交' },
      },
      {
        path: 'contacts',
        name: 'owner-contacts',
        component: () => import('../views/owner/OwnerContacts.vue'),
        meta: { title: '项目通讯录' },
      },
    ],
  },
  {
    path: '/admin',
    component: () => import('../views/admin/AdminLayout.vue'),
    redirect: '/admin/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'admin-dashboard',
        component: () => import('../views/admin/AdminDashboard.vue'),
        meta: { title: '管理员总览' },
      },
      {
        path: 'projects',
        name: 'admin-projects',
        component: () => import('../views/admin/AdminProjects.vue'),
        meta: { title: '项目管理' },
      },
      {
        path: 'people',
        name: 'admin-people',
        component: () => import('../views/admin/AdminPeople.vue'),
        meta: { title: '人员库管理' },
      },
      {
        path: 'accounts',
        name: 'admin-accounts',
        component: () => import('../views/admin/AdminAccounts.vue'),
        meta: { title: '账号管理' },
      },
      {
        path: 'tasks',
        name: 'admin-tasks',
        component: () => import('../views/admin/AdminMaterialTasks.vue'),
        meta: { title: '材料任务' },
      },
      {
        path: 'reviews',
        name: 'admin-reviews',
        component: () => import('../views/admin/AdminReviews.vue'),
        meta: { title: '材料审核' },
      },
      {
        path: 'archive-templates',
        name: 'admin-archive-templates',
        component: () => import('../views/admin/AdminArchiveTemplates.vue'),
        meta: { title: '归档模板' },
      },
      {
        path: 'exports',
        name: 'admin-exports',
        component: () => import('../views/admin/AdminExports.vue'),
        meta: { title: '整理包导出' },
      },
      {
        path: 'rules',
        name: 'admin-rules',
        component: () => import('../views/admin/AdminRules.vue'),
        meta: { title: '参与规则' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.afterEach((to) => {
  document.title = `${to.meta.title || '入口'} - 科研项目材料管理平台`
})

export default router
