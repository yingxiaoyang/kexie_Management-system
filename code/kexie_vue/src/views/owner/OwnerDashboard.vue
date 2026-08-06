<template>
  <div>
    <section class="owner-hero section">
      <div class="hero-content">
        <p class="hero-eyebrow">MY RESEARCH PROJECTS</p>
        <h2 class="hero-title">{{ greeting }}，{{ displayName }}</h2>
        <p class="hero-desc">{{ heroMessage }}</p>
        <div class="hero-actions">
          <el-button type="primary" @click="$router.push('/owner/submissions')">
            <el-icon><UploadFilled /></el-icon>
            处理材料任务
          </el-button>
          <el-button plain @click="$router.push('/owner/projects')">
            <el-icon><FolderOpened /></el-icon>
            查看我的项目
          </el-button>
        </div>
      </div>
      <div class="hero-progress">
        <div class="progress-card">
          <p class="progress-value">{{ completionRate }}%</p>
          <p class="progress-label">材料完成度</p>
          <div class="progress-track"><span :style="{ width: `${completionRate}%` }" /></div>
          <p class="progress-hint">已通过 {{ approvedCount }} / 共 {{ tasks.length }} 项</p>
        </div>
      </div>
    </section>

    <section v-loading="loading" class="metric-grid section">
      <article v-for="item in metrics" :key="item.label" class="metric" :class="item.tone">
        <div class="metric-top">
          <div>
            <p class="metric-label">{{ item.label }}</p>
            <p class="metric-value">{{ item.value }}</p>
          </div>
          <span class="metric-icon"><el-icon><component :is="item.icon" /></el-icon></span>
        </div>
        <p class="metric-hint">{{ item.hint }}</p>
      </article>
    </section>

    <section class="work-grid">
      <div class="panel">
        <div class="toolbar">
          <div>
            <h3 class="panel-title">优先处理</h3>
            <p class="panel-subtitle">退回和未提交材料优先展示</p>
          </div>
          <el-button text type="primary" @click="$router.push('/owner/submissions')">查看全部</el-button>
        </div>
        <div class="panel-body">
          <el-empty v-if="!priorityTasks.length && !loading" description="当前没有待处理材料，做得很好" :image-size="88" />
          <div v-else class="task-list">
            <article
              v-for="task in priorityTasks"
              :key="`${task.taskId}-${task.projectId}-${task.categoryId}`"
              class="task-card"
              :class="taskClass(task)"
            >
              <span class="task-accent" />
              <div>
                <div class="task-title-row">
                  <p class="task-name">{{ task.taskName }} · {{ task.categoryName }}</p>
                  <el-tag :type="statusType(task)" size="small">{{ statusLabel(task) }}</el-tag>
                </div>
                <div class="task-meta">
                  <span>{{ task.projectTitle }}</span>
                  <span>截止 {{ formatDate(task.deadlineAt) }}</span>
                </div>
                <p v-if="task.returnReason" class="task-reason">需修改：{{ task.returnReason }}</p>
              </div>
              <div class="task-action">
                <el-button size="small" :type="task.reviewStatus === 'returned' ? 'danger' : 'primary'" plain @click="$router.push('/owner/submissions')">
                  {{ task.reviewStatus === 'returned' ? '重新提交' : '去提交' }}
                </el-button>
              </div>
            </article>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="toolbar">
          <div>
            <h3 class="panel-title">我的项目</h3>
            <p class="panel-subtitle">当前账号负责的项目</p>
          </div>
          <el-button text type="primary" @click="$router.push('/owner/projects')">查看项目</el-button>
        </div>
        <div class="panel-body">
          <el-empty v-if="!projects.length && !loading" description="暂无负责项目" :image-size="80" />
          <div v-else class="task-list">
            <article v-for="project in projects.slice(0, 4)" :key="project.id" class="project-card">
              <p class="project-code">{{ project.projectCode }}</p>
              <p class="project-title">{{ project.title }}</p>
              <p class="project-meta">{{ project.projectGroup || '未分组' }} · 指导老师：{{ project.advisors || '暂未填写' }}</p>
            </article>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiRequest } from '../../services/http'
import { authStore } from '../../stores/auth'

const loading = ref(false)
const projects = ref([])
const tasks = ref([])
const displayName = computed(() => authStore.state.user?.displayName || '项目负责人')
const approvedCount = computed(() => tasks.value.filter((item) => item.reviewStatus === 'approved').length)
const completionRate = computed(() => tasks.value.length ? Math.round((approvedCount.value / tasks.value.length) * 100) : 0)
const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 11) return '上午好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
})
const pendingCount = computed(() => tasks.value.filter((item) => !item.submissionId).length)
const returnedCount = computed(() => tasks.value.filter((item) => item.reviewStatus === 'returned').length)
const reviewCount = computed(() => tasks.value.filter((item) => item.reviewStatus === 'pending').length)
const heroMessage = computed(() => {
  if (returnedCount.value) return `有 ${returnedCount.value} 项材料被退回，请优先按审核意见修改后重新提交。`
  if (pendingCount.value) return `有 ${pendingCount.value} 项材料等待提交，建议提前准备，避免临近截止时间。`
  if (reviewCount.value) return `已完成提交，当前有 ${reviewCount.value} 项材料等待管理员审核。`
  return '当前材料任务均已处理，可继续查看项目进展和项目通讯录。'
})
const metrics = computed(() => [
  { label: '负责项目', value: projects.value.length, hint: '当前账号关联项目', tone: 'tone-teal', icon: 'FolderOpened' },
  { label: '待提交材料', value: pendingCount.value, hint: '尚未形成提交记录', tone: 'tone-blue', icon: 'Document' },
  { label: '退回待处理', value: returnedCount.value, hint: '需按审核意见修改', tone: 'tone-red', icon: 'Warning' },
  { label: '等待审核', value: reviewCount.value, hint: '材料已提交管理员', tone: 'tone-orange', icon: 'Clock' },
])
const priorityTasks = computed(() => [...tasks.value]
  .filter((item) => item.reviewStatus === 'returned' || !item.submissionId)
  .sort((a, b) => {
    if (a.reviewStatus === 'returned' && b.reviewStatus !== 'returned') return -1
    if (b.reviewStatus === 'returned' && a.reviewStatus !== 'returned') return 1
    return new Date(a.deadlineAt || '2999-12-31') - new Date(b.deadlineAt || '2999-12-31')
  })
  .slice(0, 6))

async function load() {
  loading.value = true
  try {
    const [projectResult, taskResult] = await Promise.all([
      apiRequest('/projects?pageSize=100'),
      apiRequest('/material-tasks/my'),
    ])
    projects.value = projectResult.data
    tasks.value = taskResult.data
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    loading.value = false
  }
}

function statusLabel(row) {
  if (!row.submissionId) return row.taskStatus === 'closed' ? '已关闭' : '未提交'
  return ({ pending: '待审核', approved: '已通过', returned: '已退回' }[row.reviewStatus] || row.reviewStatus)
}

function statusType(row) {
  return ({ pending: 'warning', approved: 'success', returned: 'danger' }[row.reviewStatus] || 'info')
}

function taskClass(row) {
  if (row.reviewStatus === 'returned') return 'is-returned'
  if (row.reviewStatus === 'pending') return 'is-pending'
  if (row.reviewStatus === 'approved') return 'is-approved'
  return 'is-empty'
}

const formatDate = (value) => value ? new Date(value).toLocaleDateString('zh-CN') : '不设截止日期'

onMounted(load)
</script>
