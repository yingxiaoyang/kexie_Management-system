<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">材料审核</h2>
        <p class="page-desc">优先处理待审核材料；退回时填写清晰、可执行的修改意见。</p>
      </div>
      <div class="page-actions">
        <el-button :loading="loading" @click="loadReviews"><el-icon><Refresh /></el-icon>刷新列表</el-button>
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
          <el-input v-model="filters.keyword" placeholder="搜索项目、材料、提交人" clearable @keyup.enter="searchReviews">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-radio-group v-model="filters.reviewStatus" @change="searchReviews">
            <el-radio-button value="pending">待审核</el-radio-button>
            <el-radio-button value="approved">已通过</el-radio-button>
            <el-radio-button value="returned">已退回</el-radio-button>
            <el-radio-button value="">全部</el-radio-button>
          </el-radio-group>
        </div>
      </div>

      <el-table v-loading="loading" :data="reviews" class="desktop-table" style="width: 100%" empty-text="暂无材料提交记录">
        <el-table-column prop="projectTitle" label="项目" min-width="190" show-overflow-tooltip />
        <el-table-column prop="taskName" label="任务" width="150" show-overflow-tooltip />
        <el-table-column prop="categoryName" label="材料类别" width="120" />
        <el-table-column prop="submitter" label="提交人" width="90" />
        <el-table-column prop="submittedAt" label="提交时间" width="165"><template #default="{ row }">{{ formatTime(row.submittedAt) }}</template></el-table-column>
        <el-table-column prop="fileCount" label="文件" width="68"><template #default="{ row }">{{ Number(row.fileCount) }} 个</template></el-table-column>
        <el-table-column prop="reviewStatus" label="状态" width="90"><template #default="{ row }"><el-tag :type="statusType(row.reviewStatus)">{{ statusLabel(row.reviewStatus) }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button text @click="showFiles(row)"><el-icon><Document /></el-icon>查看文件</el-button>
            <el-button v-if="row.reviewStatus === 'pending'" text type="success" @click="approve(row)">通过</el-button>
            <el-button v-if="row.reviewStatus === 'pending'" text type="danger" @click="openReturn(row)">退回</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="mobile-card-list">
        <el-empty v-if="!reviews.length && !loading" class="empty-mobile" description="暂无材料提交记录" :image-size="72" />
        <article v-for="row in reviews" :key="row.id" class="mobile-data-card">
          <div class="mobile-card-header">
            <div>
              <p class="mobile-card-title">{{ row.projectTitle }}</p>
              <div class="mobile-card-meta"><span>{{ row.taskName }} · {{ row.categoryName }}</span></div>
            </div>
            <el-tag :type="statusType(row.reviewStatus)" size="small">{{ statusLabel(row.reviewStatus) }}</el-tag>
          </div>
          <div class="mobile-card-body">
            <div><span class="mobile-field-label">提交人</span><span class="mobile-field-value">{{ row.submitter }}</span></div>
            <div><span class="mobile-field-label">文件数量</span><span class="mobile-field-value">{{ Number(row.fileCount) }} 个</span></div>
            <div style="grid-column: 1 / -1"><span class="mobile-field-label">提交时间</span><span class="mobile-field-value">{{ formatTime(row.submittedAt) }}</span></div>
          </div>
          <div class="mobile-card-footer">
            <el-button @click="showFiles(row)"><el-icon><Document /></el-icon>查看文件</el-button>
            <div v-if="row.reviewStatus === 'pending'" class="page-actions">
              <el-button type="danger" plain @click="openReturn(row)">退回</el-button>
              <el-button type="success" @click="approve(row)">通过</el-button>
            </div>
          </div>
        </article>
      </div>

      <div class="pagination-row" v-if="pagination.total">
        <el-pagination v-model:current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total" layout="total, prev, pager, next" @current-change="loadReviews" />
      </div>
    </div>

    <el-dialog v-model="filesVisible" :title="selected ? `${selected.projectTitle} · 提交文件` : '提交文件'" width="620px">
      <el-table v-loading="filesLoading" :data="files" empty-text="没有可下载的文件">
        <el-table-column prop="originalName" label="文件名" min-width="250" />
        <el-table-column prop="fileSize" label="大小" width="100"><template #default="{ row }">{{ formatSize(row.fileSize) }}</template></el-table-column>
        <el-table-column label="操作" width="100"><template #default="{ row }"><el-button text type="primary" @click="download(row)"><el-icon><Download /></el-icon>下载</el-button></template></el-table-column>
      </el-table>
    </el-dialog>

    <el-dialog v-model="returnVisible" title="退回材料" width="520px">
      <el-alert v-if="selected" :title="`${selected.projectTitle} · ${selected.categoryName}`" type="warning" :closable="false" show-icon />
      <el-form ref="returnFormRef" class="section" :model="returnForm" :rules="returnRules" label-width="92px">
        <el-form-item label="退回原因" prop="reason">
          <el-input v-model.trim="returnForm.reason" type="textarea" :rows="5" maxlength="500" show-word-limit placeholder="请具体说明缺少内容、格式问题或需要修改的位置" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="returnVisible = false">取消</el-button>
        <el-button type="danger" :loading="reviewing" @click="confirmReturn">确认退回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiRequest, downloadFile } from '../../services/http'

const reviews = ref([])
const loading = ref(false)
const reviewing = ref(false)
const filters = reactive({ keyword: '', reviewStatus: 'pending' })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })
const filesVisible = ref(false)
const filesLoading = ref(false)
const files = ref([])
const selected = ref(null)
const returnVisible = ref(false)
const returnFormRef = ref()
const returnForm = reactive({ reason: '' })
const returnRules = { reason: [{ required: true, message: '退回原因不能为空', trigger: 'blur' }, { min: 4, message: '请填写更具体的退回原因', trigger: 'blur' }] }
const summaries = computed(() => [
  { label: '当前结果', value: pagination.total || reviews.value.length },
  { label: '本页待审核', value: reviews.value.filter((item) => item.reviewStatus === 'pending').length },
  { label: '本页已通过', value: reviews.value.filter((item) => item.reviewStatus === 'approved').length },
  { label: '本页已退回', value: reviews.value.filter((item) => item.reviewStatus === 'returned').length },
])

function params() {
  const query = new URLSearchParams({ page: pagination.page, pageSize: pagination.pageSize })
  if (filters.keyword) query.set('keyword', filters.keyword)
  if (filters.reviewStatus) query.set('reviewStatus', filters.reviewStatus)
  return query
}

async function loadReviews() {
  loading.value = true
  try {
    const response = await apiRequest(`/submissions?${params()}`)
    reviews.value = response.data
    Object.assign(pagination, response.pagination)
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    loading.value = false
  }
}

function searchReviews() {
  pagination.page = 1
  loadReviews()
}

async function showFiles(row) {
  selected.value = row
  filesVisible.value = true
  filesLoading.value = true
  try {
    files.value = (await apiRequest(`/submissions/${row.id}/files`)).data
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    filesLoading.value = false
  }
}

async function download(file) {
  try {
    await downloadFile(`/submissions/${selected.value.id}/files/${file.id}/download`, file.originalName)
  } catch (error) {
    ElMessage.error(error.message)
  }
}

async function approve(row) {
  try {
    await ElMessageBox.confirm(`确认通过“${row.projectTitle} - ${row.categoryName}”吗？`, '审核通过', { type: 'success', confirmButtonText: '确认通过' })
    await apiRequest(`/submissions/${row.id}/review`, { method: 'PATCH', body: { action: 'approve' } })
    ElMessage.success('审核已通过')
    await loadReviews()
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(error.message || '审核失败')
  }
}

function openReturn(row) {
  selected.value = row
  returnForm.reason = ''
  returnVisible.value = true
}

async function confirmReturn() {
  if (!(await returnFormRef.value?.validate().catch(() => false))) return
  reviewing.value = true
  try {
    await apiRequest(`/submissions/${selected.value.id}/review`, { method: 'PATCH', body: { action: 'return', reason: returnForm.reason } })
    ElMessage.success('材料已退回，负责人可查看意见并重新提交')
    returnVisible.value = false
    await loadReviews()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    reviewing.value = false
  }
}

const statusLabel = (value) => ({ pending: '待审核', approved: '已通过', returned: '已退回' }[value] || value)
const statusType = (value) => ({ pending: 'warning', approved: 'success', returned: 'danger' }[value] || 'info')
const formatTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
const formatSize = (bytes) => Number(bytes) < 1024 * 1024 ? `${(Number(bytes) / 1024).toFixed(1)} KB` : `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`

onMounted(loadReviews)
</script>
