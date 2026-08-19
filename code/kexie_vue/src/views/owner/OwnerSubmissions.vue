<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">材料提交</h2>
        <p class="page-desc">按统筹任务逐项提交文件；每个子任务一次只接收 1 个文件，退回后可重新提交。</p>
      </div>
    </div>

    <section class="summary-strip section">
      <div v-for="item in summaries" :key="item.label" class="summary-item">
        <p class="summary-value">{{ item.value }}</p>
        <p class="summary-label">{{ item.label }}</p>
      </div>
    </section>

    <div class="panel">
      <div class="toolbar">
        <div class="filters">
          <el-input v-model="keyword" placeholder="搜索统筹任务、项目或子任务" clearable>
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-select v-model="statusFilter" placeholder="提交状态" clearable style="width: 150px">
            <el-option label="未提交" value="empty" />
            <el-option label="待审核" value="pending" />
            <el-option label="已通过" value="approved" />
            <el-option label="已退回" value="returned" />
          </el-select>
        </div>
        <el-button :loading="loading" @click="loadTasks">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>

      <el-table v-loading="loading" :data="filteredTasks" class="desktop-table" style="width: 100%" empty-text="当前没有符合条件的材料任务">
        <el-table-column prop="taskName" label="统筹任务" min-width="170" />
        <el-table-column prop="projectTitle" label="所属项目" min-width="210" show-overflow-tooltip />
        <el-table-column prop="categoryName" label="子文件任务" width="150" />
        <el-table-column prop="deadlineAt" label="截止时间" width="180">
          <template #default="{ row }"><span :class="{ 'danger-text': isOverdue(row) }">{{ formatTime(row.deadlineAt) }}</span></template>
        </el-table-column>
        <el-table-column label="任务模板" width="120">
          <template #default="{ row }">
            <el-button v-if="Number(row.templateCount)" text type="primary" @click="showTemplates(row)">
              <el-icon><Download /></el-icon>{{ row.templateCount }} 个模板
            </el-button>
            <span v-else class="muted">无模板</span>
          </template>
        </el-table-column>
        <el-table-column label="提交状态" width="110">
          <template #default="{ row }"><el-tag :type="statusType(row)">{{ statusLabel(row) }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="returnReason" label="审核反馈" min-width="190" show-overflow-tooltip>
          <template #default="{ row }"><span :class="{ 'danger-text': row.returnReason }">{{ row.returnReason || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="135" fixed="right">
          <template #default="{ row }">
            <el-button :type="row.reviewStatus === 'returned' ? 'danger' : 'primary'" text :disabled="!canSubmit(row)" @click="openUpload(row)">
              <el-icon><UploadFilled /></el-icon>{{ row.reviewStatus === 'returned' ? '重新提交' : '提交材料' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="mobile-card-list">
        <el-empty v-if="!filteredTasks.length && !loading" class="empty-mobile" description="当前没有符合条件的材料任务" :image-size="72" />
        <article v-for="row in filteredTasks" :key="`${row.taskId}-${row.projectId}-${row.categoryId}`" class="mobile-data-card">
          <div class="mobile-card-header">
            <div>
              <p class="mobile-card-title">{{ row.taskName }}</p>
              <div class="mobile-card-meta"><span>{{ row.projectTitle }}</span></div>
            </div>
            <el-tag :type="statusType(row)" size="small">{{ statusLabel(row) }}</el-tag>
          </div>
          <div class="mobile-card-body">
            <div><span class="mobile-field-label">子文件任务</span><span class="mobile-field-value">{{ row.categoryName }}</span></div>
            <div><span class="mobile-field-label">截止时间</span><span class="mobile-field-value" :class="{ 'danger-text': isOverdue(row) }">{{ formatTime(row.deadlineAt) }}</span></div>
            <div v-if="row.returnReason" style="grid-column: 1 / -1">
              <span class="mobile-field-label">审核反馈</span><span class="mobile-field-value danger-text">{{ row.returnReason }}</span>
            </div>
          </div>
          <div class="mobile-card-footer">
            <el-button v-if="Number(row.templateCount)" text type="primary" @click="showTemplates(row)">
              <el-icon><Download /></el-icon>下载模板
            </el-button>
            <span v-else class="muted">无任务模板</span>
            <el-button :type="row.reviewStatus === 'returned' ? 'danger' : 'primary'" :disabled="!canSubmit(row)" @click="openUpload(row)">
              {{ row.reviewStatus === 'returned' ? '重新提交' : '提交材料' }}
            </el-button>
          </div>
        </article>
      </div>
    </div>

    <el-dialog v-model="uploadVisible" :title="`提交：${selected?.categoryName || ''}`" width="560px" @closed="uploadFiles = []">
      <el-descriptions v-if="selected" :column="1" border>
        <el-descriptions-item label="项目">{{ selected.projectTitle }}</el-descriptions-item>
        <el-descriptions-item label="统筹任务">{{ selected.taskName }}</el-descriptions-item>
        <el-descriptions-item label="子文件任务">{{ selected.categoryName }}</el-descriptions-item>
        <el-descriptions-item v-if="selected.fileTaskDescription" label="提交说明">{{ selected.fileTaskDescription }}</el-descriptions-item>
        <el-descriptions-item label="限制">本次仅 1 个文件，最大 {{ selected.maxFileMb }}MB；项目累计 {{ selected.maxTaskProjectMb }}MB</el-descriptions-item>
      </el-descriptions>
      <el-alert v-if="selected?.returnReason" class="section" :title="`上次退回原因：${selected.returnReason}`" type="error" show-icon :closable="false" />
      <el-upload class="section" drag action="#" :limit="1" :auto-upload="false" :accept="acceptTypes" :on-change="onFileChange" :on-remove="onFileRemove">
        <el-icon size="30"><UploadFilled /></el-icon>
        <div>拖拽文件到此处，或点击选择</div>
        <template #tip><div class="el-upload__tip">只能选择 1 个文件；允许格式：{{ allowedExtensionText }}</div></template>
      </el-upload>
      <template #footer>
        <el-button @click="uploadVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!uploadFiles.length" :loading="uploading" @click="submitFiles">确认提交</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="templatesVisible" title="任务模板" width="600px">
      <el-table v-loading="templatesLoading" :data="templates" empty-text="暂无模板">
        <el-table-column label="文件名" min-width="260"><template #default="{ row }"><span>{{ row.originalName }}</span><el-alert v-if="row.fileNameWarning" class="filename-warning" :title="row.fileNameWarning" :type="row.fileNameRecovered ? 'success' : 'warning'" :closable="false" /></template></el-table-column>
        <el-table-column prop="fileSize" label="大小" width="100"><template #default="{ row }">{{ formatSize(row.fileSize) }}</template></el-table-column>
        <el-table-column label="操作" width="90"><template #default="{ row }"><el-button text type="primary" @click="downloadTemplate(row)">下载</el-button></template></el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiRequest, downloadFile } from '../../services/http'

const tasks = ref([])
const loading = ref(false)
const selected = ref(null)
const uploadVisible = ref(false)
const uploadFiles = ref([])
const uploading = ref(false)
const templatesVisible = ref(false)
const templatesLoading = ref(false)
const templates = ref([])
const keyword = ref('')
const statusFilter = ref('')

const normalizedExtensions = computed(() => Array.isArray(selected.value?.allowedExtensions) ? selected.value.allowedExtensions : [])
const acceptTypes = computed(() => normalizedExtensions.value.map((ext) => `.${ext}`).join(','))
const allowedExtensionText = computed(() => normalizedExtensions.value.length ? normalizedExtensions.value.map((ext) => ext.toUpperCase()).join('、') : '按任务设置')
const summaries = computed(() => [
  { label: '全部材料', value: tasks.value.length },
  { label: '未提交', value: tasks.value.filter((item) => !item.submissionId).length },
  { label: '等待审核', value: tasks.value.filter((item) => item.reviewStatus === 'pending').length },
  { label: '已退回', value: tasks.value.filter((item) => item.reviewStatus === 'returned').length },
])
const filteredTasks = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return tasks.value.filter((item) => {
    const status = item.submissionId ? item.reviewStatus : 'empty'
    const matchesStatus = !statusFilter.value || status === statusFilter.value
    const matchesQuery = !query || [item.taskName, item.projectTitle, item.categoryName]
      .some((value) => String(value || '').toLowerCase().includes(query))
    return matchesStatus && matchesQuery
  })
})

async function loadTasks() {
  loading.value = true
  try {
    tasks.value = (await apiRequest('/material-tasks/my')).data
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    loading.value = false
  }
}

function canSubmit(row) {
  return row.taskStatus === 'published' && !['pending', 'approved'].includes(row.reviewStatus)
}

function openUpload(row) {
  selected.value = row
  uploadFiles.value = []
  uploadVisible.value = true
}

function onFileChange(_file, files) {
  uploadFiles.value = files.map((item) => item.raw).filter(Boolean)
}

function onFileRemove(_file, files) {
  uploadFiles.value = files.map((item) => item.raw).filter(Boolean)
}

async function submitFiles() {
  uploading.value = true
  try {
    const body = new FormData()
    body.append('taskId', selected.value.taskId)
    body.append('projectId', selected.value.projectId)
    body.append('categoryId', selected.value.categoryId)
    body.append('file', uploadFiles.value[0])
    await apiRequest('/uploads/submissions', { method: 'POST', body })
    ElMessage.success('材料提交成功，等待管理员审核')
    uploadVisible.value = false
    await loadTasks()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    uploading.value = false
  }
}

async function showTemplates(row) {
  selected.value = row
  templatesVisible.value = true
  templatesLoading.value = true
  try {
    templates.value = (await apiRequest(`/material-tasks/${row.taskId}/templates?categoryId=${row.categoryId}`)).data
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    templatesLoading.value = false
  }
}

async function downloadTemplate(file) {
  try {
    await downloadFile(`/material-tasks/${selected.value.taskId}/templates/${file.id}/download`, file.originalName)
  } catch (error) {
    ElMessage.error(error.message)
  }
}

function statusLabel(row) {
  if (!row.submissionId) return row.taskStatus === 'closed' ? '已关闭' : '未提交'
  return ({ pending: '待审核', approved: '已通过', returned: '已退回' }[row.reviewStatus] || row.reviewStatus)
}

function statusType(row) {
  return ({ pending: 'warning', approved: 'success', returned: 'danger' }[row.reviewStatus] || 'info')
}

function isOverdue(row) {
  return row.deadlineAt && new Date(row.deadlineAt) < new Date() && !['approved', 'pending'].includes(row.reviewStatus)
}

const formatTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '不设截止时间'
const formatSize = (bytes) => Number(bytes) < 1024 * 1024 ? `${(Number(bytes) / 1024).toFixed(1)} KB` : `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`

onMounted(loadTasks)
</script>
