<template>
  <div>
    <div class="page-header"><div><h2 class="page-title">我的待办</h2><p class="page-desc">聚合本人项目和真实材料提交状态。</p></div><el-button type="primary" @click="$router.push('/owner/submissions')"><el-icon><Upload /></el-icon>提交材料</el-button></div>
    <section v-loading="loading" class="metric-grid section"><article v-for="item in metrics" :key="item.label" class="metric"><p class="metric-label">{{ item.label }}</p><p class="metric-value">{{ item.value }}</p></article></section>
    <section class="work-grid">
      <div class="panel"><div class="toolbar"><strong>材料任务</strong><el-button text @click="$router.push('/owner/submissions')">查看全部</el-button></div><div class="panel-body"><el-empty v-if="!tasks.length && !loading" description="暂无材料任务" :image-size="80" /><div v-else class="status-stack"><div v-for="task in tasks.slice(0, 6)" :key="`${task.taskId}-${task.projectId}-${task.categoryId}`" class="status-item"><div><p class="status-title">{{ task.taskName }} · {{ task.categoryName }}</p><p class="status-desc">{{ task.projectTitle }} · 截止 {{ formatDate(task.deadlineAt) }}</p><p v-if="task.returnReason" class="status-desc danger-text">退回原因：{{ task.returnReason }}</p></div><el-tag :type="statusType(task)">{{ statusLabel(task) }}</el-tag></div></div></div></div>
      <div class="panel"><div class="toolbar"><strong>我的项目</strong><el-button text @click="$router.push('/owner/projects')">查看项目</el-button></div><div class="panel-body"><el-empty v-if="!projects.length && !loading" description="暂无负责项目" :image-size="80" /><div v-else class="status-stack"><div v-for="project in projects.slice(0, 5)" :key="project.id" class="status-item"><div><p class="status-title">{{ project.title }}</p><p class="status-desc">{{ project.projectCode }} · {{ project.projectGroup || '未分组' }}</p></div><el-tag effect="plain">{{ project.advisors || '暂无导师' }}</el-tag></div></div></div></div>
    </section>
  </div>
</template>
<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiRequest } from '../../services/http'
const loading = ref(false), projects = ref([]), tasks = ref([])
const metrics = computed(() => [{ label: '负责项目', value: projects.value.length }, { label: '待提交材料', value: tasks.value.filter((item) => !item.submissionId).length }, { label: '退回待处理', value: tasks.value.filter((item) => item.reviewStatus === 'returned').length }, { label: '待审核材料', value: tasks.value.filter((item) => item.reviewStatus === 'pending').length }])
async function load() { loading.value = true; try { const [projectResult, taskResult] = await Promise.all([apiRequest('/projects?pageSize=100'), apiRequest('/material-tasks/my')]); projects.value = projectResult.data; tasks.value = taskResult.data } catch (e) { ElMessage.error(e.message) } finally { loading.value = false } }
function statusLabel(row) { if (!row.submissionId) return row.taskStatus === 'closed' ? '已关闭' : '未提交'; return ({ pending: '待审核', approved: '已通过', returned: '已退回' }[row.reviewStatus] || row.reviewStatus) }
function statusType(row) { return ({ pending: 'warning', approved: 'success', returned: 'danger' }[row.reviewStatus] || 'info') }
const formatDate = (v) => v ? new Date(v).toLocaleDateString('zh-CN') : '不设截止日期'
onMounted(load)
</script>
