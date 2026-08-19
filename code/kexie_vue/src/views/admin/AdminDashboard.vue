<template>
  <div>
    <div class="page-header"><div><h2 class="page-title">管理总览</h2><p class="page-desc">仅展示当前账号获授模块的数据。</p></div><el-button v-if="can('material_task')" type="primary" @click="$router.push('/admin/tasks')"><el-icon><Plus /></el-icon>新建材料任务</el-button></div>
    <section v-loading="loading" class="metric-grid section"><article v-for="item in metrics" :key="item.label" class="metric"><p class="metric-label">{{ item.label }}</p><p class="metric-value">{{ item.value }}</p></article></section>
    <section class="work-grid">
      <div v-if="can('material_review')" class="panel"><div class="toolbar"><strong>待审核材料</strong><el-button text @click="$router.push('/admin/reviews')">进入审核</el-button></div><el-table v-loading="loading" :data="pendingReviews" empty-text="暂无待审核材料"><el-table-column prop="projectTitle" label="项目" min-width="210" /><el-table-column prop="categoryName" label="材料" width="140" /><el-table-column prop="submitter" label="提交人" width="100" /><el-table-column prop="submittedAt" label="提交时间" width="170"><template #default="{ row }">{{ formatTime(row.submittedAt) }}</template></el-table-column></el-table></div>
      <div v-if="can('material_task')" class="panel"><div class="toolbar"><strong>最近材料任务</strong><el-button text @click="$router.push('/admin/tasks')">任务管理</el-button></div><div class="panel-body"><el-empty v-if="!recentTasks.length && !loading" description="暂无材料任务" :image-size="80" /><div v-else class="status-stack"><div v-for="task in recentTasks" :key="task.id" class="status-item"><div><p class="status-title">{{ task.taskName }}</p><p class="status-desc">{{ task.scopeLabel }} · {{ task.categoryNames }}</p></div><el-tag :type="task.status === 'published' ? 'success' : 'info'">{{ statusLabel(task.status) }}</el-tag></div></div></div></div>
      <el-empty v-if="!can('material_review') && !can('material_task')" description="请从左侧进入已获授的管理模块" />
    </section>
  </div>
</template>
<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiRequest } from '../../services/http'
import { authStore } from '../../stores/auth'
const loading = ref(false), metrics = ref([]), pendingReviews = ref([]), recentTasks = ref([])
const can = (permission) => authStore.hasPermission(permission)
async function load() {
  loading.value = true
  try {
    const requests = [
      can('project_management') && { key: 'projects', label: '项目总数', promise: apiRequest('/projects?pageSize=1') },
      can('people_management') && { key: 'people', label: '人员记录', promise: apiRequest('/people?pageSize=1') },
      can('material_review') && { key: 'reviews', label: '待审核材料', promise: apiRequest('/submissions?reviewStatus=pending&pageSize=5') },
      can('material_task') && { key: 'tasks', label: '材料任务', promise: apiRequest('/material-tasks?pageSize=5') },
    ].filter(Boolean)
    const results = await Promise.all(requests.map((item) => item.promise))
    metrics.value = requests.map((item, index) => ({ label: item.label, value: results[index].pagination.total }))
    requests.forEach((item, index) => {
      if (item.key === 'reviews') pendingReviews.value = results[index].data
      if (item.key === 'tasks') recentTasks.value = results[index].data
    })
  } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}
const statusLabel = (v) => ({ draft: '草稿', published: '收集中', closed: '已关闭' }[v] || v)
const formatTime = (v) => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '-'
onMounted(load)
</script>
