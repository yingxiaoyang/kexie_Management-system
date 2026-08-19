<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">材料审核</h2>
        <p class="page-desc">{{ isSuperAdmin ? '统一分发审核任务，并查看全部处理进度。' : '这里只显示分配给你的审核任务，请先预览材料再提交结论。' }}</p>
      </div>
      <el-button :loading="loading" @click="loadReviews"><el-icon><Refresh /></el-icon>刷新列表</el-button>
    </div>

    <section class="summary-strip section">
      <div v-for="item in summaries" :key="item.label" class="summary-item"><p class="summary-value">{{ item.value }}</p><p class="summary-label">{{ item.label }}</p></div>
    </section>

    <div class="panel">
      <div class="toolbar review-toolbar">
        <div class="filters review-filters">
          <el-input v-model="filters.keyword" placeholder="搜索项目、任务、材料、提交人" clearable @keyup.enter="searchReviews"><template #prefix><el-icon><Search /></el-icon></template></el-input>
          <el-select v-model="filters.reviewStatus" placeholder="审核状态" clearable @change="searchReviews"><el-option label="待审核" value="pending" /><el-option label="已通过" value="approved" /><el-option label="已退回" value="returned" /></el-select>
          <template v-if="isSuperAdmin">
            <el-select v-model="filters.assignmentStatus" placeholder="分配状态" clearable @change="searchReviews"><el-option label="未分配" value="unassigned" /><el-option label="已分配" value="assigned" /></el-select>
            <el-select v-model="filters.assigneeId" placeholder="审核人" clearable filterable @change="searchReviews"><el-option v-for="item in options.reviewers" :key="item.id" :label="item.displayName" :value="item.id" /></el-select>
            <el-select v-model="filters.projectId" placeholder="项目" clearable filterable @change="searchReviews"><el-option v-for="item in options.projects" :key="item.id" :label="`${item.projectCode} · ${item.title}`" :value="item.id" /></el-select>
            <el-select v-model="filters.taskId" placeholder="材料任务" clearable filterable @change="searchReviews"><el-option v-for="item in options.tasks" :key="item.id" :label="item.taskName" :value="item.id" /></el-select>
          </template>
        </div>
        <div class="page-actions review-batch-actions">
          <span class="muted">已选 {{ selectedRows.length }} 条</span>
          <el-button :disabled="!selectedRows.length" :loading="downloading" @click="batchDownload"><el-icon><Download /></el-icon>下载原文件 ZIP</el-button>
          <el-button v-if="isSuperAdmin" type="primary" :disabled="!canAssignSelection" @click="openAssign">批量分配</el-button>
        </div>
      </div>

      <el-table ref="tableRef" v-loading="loading" :data="reviews" class="desktop-table" style="width: 100%" empty-text="暂无材料审核任务" @selection-change="selectedRows = $event">
        <el-table-column type="selection" width="44" />
        <el-table-column label="项目 / 材料" min-width="230"><template #default="{ row }"><strong>{{ row.projectTitle }}</strong><div class="table-subline">{{ row.projectCode }} · {{ row.taskName }} / {{ row.categoryName }}</div></template></el-table-column>
        <el-table-column label="提交" width="145"><template #default="{ row }"><div>{{ row.submitter }}</div><small class="muted">{{ formatTime(row.submittedAt) }}</small><div class="table-subline">{{ Number(row.fileCount) }} 个文件 · {{ formatSize(row.totalFileSize) }}</div></template></el-table-column>
        <el-table-column label="任务分配" min-width="170"><template #default="{ row }"><el-tag :type="row.assignedTo ? 'primary' : 'info'" effect="plain">{{ row.assigneeName || '未分配' }}</el-tag><div v-if="row.assignerName" class="table-subline">{{ row.assignerName }} 于 {{ formatTime(row.assignedAt) }} 分配</div></template></el-table-column>
        <el-table-column label="审核结果" min-width="150"><template #default="{ row }"><el-tag :type="statusType(row.reviewStatus)">{{ statusLabel(row.reviewStatus) }}</el-tag><div v-if="row.reviewerName" class="table-subline">实际审核人：{{ row.reviewerName }}<br>{{ formatTime(row.reviewedAt) }}</div><div v-if="row.returnReason" class="table-subline danger-text">{{ row.returnReason }}</div></template></el-table-column>
        <el-table-column label="操作" width="230" fixed="right"><template #default="{ row }"><el-button text @click="showFiles(row)"><el-icon><View /></el-icon>材料与记录</el-button><el-button v-if="canReview(row)" text type="success" @click="approve(row)">通过</el-button><el-button v-if="canReview(row)" text type="danger" @click="openReturn(row)">退回</el-button></template></el-table-column>
      </el-table>

      <div class="mobile-card-list">
        <el-empty v-if="!reviews.length && !loading" description="暂无材料审核任务" :image-size="72" />
        <article v-for="row in reviews" :key="row.id" class="mobile-data-card">
          <div class="mobile-card-header"><el-checkbox :model-value="isSelected(row)" @change="toggleSelected(row, $event)" /><div><p class="mobile-card-title">{{ row.projectTitle }}</p><div class="mobile-card-meta">{{ row.taskName }} · {{ row.categoryName }}</div></div><el-tag :type="statusType(row.reviewStatus)" size="small">{{ statusLabel(row.reviewStatus) }}</el-tag></div>
          <div class="mobile-card-body"><div><span class="mobile-field-label">受派人</span><span class="mobile-field-value">{{ row.assigneeName || '未分配' }}</span></div><div><span class="mobile-field-label">实际审核人</span><span class="mobile-field-value">{{ row.reviewerName || '-' }}</span></div><div><span class="mobile-field-label">提交人</span><span class="mobile-field-value">{{ row.submitter }}</span></div><div><span class="mobile-field-label">文件</span><span class="mobile-field-value">{{ Number(row.fileCount) }} 个</span></div></div>
          <div class="mobile-card-footer"><el-button @click="showFiles(row)"><el-icon><View /></el-icon>材料与记录</el-button><div v-if="canReview(row)" class="page-actions"><el-button type="danger" plain @click="openReturn(row)">退回</el-button><el-button type="success" @click="approve(row)">通过</el-button></div></div>
        </article>
      </div>

      <div v-if="pagination.total" class="pagination-row"><el-pagination v-model:current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total" layout="total, prev, pager, next" @current-change="loadReviews" /></div>
    </div>

    <el-dialog v-model="filesVisible" :title="selected ? `${selected.projectTitle} · 材料与审核记录` : '材料与审核记录'" width="760px" @closed="closePreview">
      <el-table v-loading="filesLoading" :data="files" empty-text="没有可查看的文件">
        <el-table-column label="文件名" min-width="290"><template #default="{ row }"><span>{{ row.originalName }}</span><el-alert v-if="row.fileNameWarning" class="filename-warning" :title="row.fileNameWarning" :type="row.fileNameRecovered ? 'success' : 'warning'" :closable="false" /></template></el-table-column>
        <el-table-column prop="fileSize" label="大小" width="100"><template #default="{ row }">{{ formatSize(row.fileSize) }}</template></el-table-column>
        <el-table-column label="预览" width="105"><template #default="{ row }"><el-button v-if="row.previewable" text type="primary" @click="preview(row)">网页预览</el-button><el-tooltip v-else :content="row.previewMessage"><span class="muted">请下载查看</span></el-tooltip></template></el-table-column>
        <el-table-column label="下载" width="86"><template #default="{ row }"><el-button text type="primary" @click="download(row)"><el-icon><Download /></el-icon>下载</el-button></template></el-table-column>
      </el-table>
      <el-divider content-position="left">分配与审核历史</el-divider>
      <el-timeline v-if="auditItems.length"><el-timeline-item v-for="item in auditItems" :key="item.id" :timestamp="formatTime(item.createdAt)" placement="top"><strong>{{ auditLabel(item) }}</strong><p v-if="item.reason" class="table-subline">原因：{{ item.reason }}</p></el-timeline-item></el-timeline>
      <el-empty v-else description="暂无分配或审核审计记录" :image-size="54" />
    </el-dialog>

    <el-dialog v-model="previewVisible" :title="previewFile?.originalName || '文件预览'" width="min(1000px, 92vw)" @closed="closePreview">
      <div v-loading="previewLoading" class="review-preview">
        <img v-if="previewUrl && previewFile?.previewType === 'image'" :src="previewUrl" :alt="previewFile.originalName" />
        <iframe v-else-if="previewUrl" :src="previewUrl" :title="previewFile?.originalName" />
      </div>
      <template #footer><span class="muted">仅图片和 PDF 支持安全网页预览；Office 等文件请下载后查看。</span><el-button @click="previewVisible = false">关闭</el-button></template>
    </el-dialog>

    <el-dialog v-model="assignVisible" title="批量分配审核任务" width="520px">
      <el-alert :title="`将 ${selectedRows.length} 条待审核任务分配给一位小管理员`" type="info" :closable="false" show-icon />
      <el-form class="section" label-width="92px"><el-form-item label="受派人" required><el-select v-model="assignForm.assigneeId" style="width: 100%" placeholder="请选择拥有材料审核权限的小管理员"><el-option v-for="item in options.reviewers" :key="item.id" :label="`${item.displayName}（${item.username}）`" :value="item.id" /></el-select></el-form-item><el-form-item label="改派原因" :required="selectionHasAssignment"><el-input v-model.trim="assignForm.reason" type="textarea" :rows="4" maxlength="1000" show-word-limit :placeholder="selectionHasAssignment ? '所选任务含已分配任务，必须说明改派原因' : '首次分配可选填说明'" /></el-form-item></el-form>
      <template #footer><el-button @click="assignVisible = false">取消</el-button><el-button type="primary" :loading="assigning" @click="confirmAssign">确认分配</el-button></template>
    </el-dialog>

    <el-dialog v-model="returnVisible" title="退回材料" width="520px"><el-alert v-if="selected" :title="`${selected.projectTitle} · ${selected.categoryName}`" type="warning" :closable="false" show-icon /><el-form ref="returnFormRef" class="section" :model="returnForm" :rules="returnRules" label-width="92px"><el-form-item label="退回原因" prop="reason"><el-input v-model.trim="returnForm.reason" type="textarea" :rows="5" maxlength="1000" show-word-limit placeholder="请具体说明缺少内容、格式问题或需要修改的位置" /></el-form-item></el-form><template #footer><el-button @click="returnVisible = false">取消</el-button><el-button type="danger" :loading="reviewing" @click="confirmReturn">确认退回</el-button></template></el-dialog>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiRequest, downloadFile, fetchFileBlob } from '../../services/http'
import { authStore } from '../../stores/auth'

const reviews = ref([]), selectedRows = ref([]), files = ref([]), auditItems = ref([])
const loading = ref(false), filesLoading = ref(false), reviewing = ref(false), downloading = ref(false), assigning = ref(false)
const filesVisible = ref(false), returnVisible = ref(false), assignVisible = ref(false), previewVisible = ref(false), previewLoading = ref(false)
const selected = ref(null), previewFile = ref(null), previewUrl = ref(''), tableRef = ref(), returnFormRef = ref()
const isSuperAdmin = computed(() => authStore.isSuperAdmin())
const filters = reactive({ keyword: '', reviewStatus: 'pending', assignmentStatus: '', assigneeId: '', projectId: '', taskId: '' })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })
const options = reactive({ reviewers: [], projects: [], tasks: [] })
const assignForm = reactive({ assigneeId: '', reason: '' }), returnForm = reactive({ reason: '' })
const returnRules = { reason: [{ required: true, message: '退回原因不能为空', trigger: 'blur' }, { min: 4, message: '请填写更具体的退回原因', trigger: 'blur' }] }
const selectionHasAssignment = computed(() => selectedRows.value.some((item) => item.assignedTo))
const canAssignSelection = computed(() => selectedRows.value.length > 0 && selectedRows.value.every((item) => item.reviewStatus === 'pending'))
const summaries = computed(() => [{ label: '当前结果', value: pagination.total || reviews.value.length }, { label: '本页待审核', value: reviews.value.filter((item) => item.reviewStatus === 'pending').length }, { label: '本页未分配', value: reviews.value.filter((item) => !item.assignedTo).length }, { label: '本页已完成', value: reviews.value.filter((item) => item.reviewStatus !== 'pending').length }])

function queryParams() { const query = new URLSearchParams({ page: pagination.page, pageSize: pagination.pageSize }); Object.entries(filters).forEach(([key, value]) => { if (value !== '' && value != null) query.set(key, value) }); return query }
async function loadReviews() { loading.value = true; try { const response = await apiRequest(`/submissions?${queryParams()}`); reviews.value = response.data; Object.assign(pagination, response.pagination); selectedRows.value = [] } catch (error) { ElMessage.error(error.message) } finally { loading.value = false } }
async function loadOptions() { if (!isSuperAdmin.value) return; try { Object.assign(options, (await apiRequest('/submissions/review-options')).data) } catch (error) { ElMessage.error(error.message) } }
function searchReviews() { pagination.page = 1; loadReviews() }
const canReview = (row) => row.reviewStatus === 'pending' && (isSuperAdmin.value || Number(row.assignedTo) === Number(authStore.state.user?.id))
function isSelected(row) { return selectedRows.value.some((item) => item.id === row.id) }
function toggleSelected(row, checked) { if (checked && !isSelected(row)) selectedRows.value = [...selectedRows.value, row]; else if (!checked) selectedRows.value = selectedRows.value.filter((item) => item.id !== row.id); tableRef.value?.toggleRowSelection(row, checked) }

async function showFiles(row) { selected.value = row; filesVisible.value = true; filesLoading.value = true; try { const [fileResponse, auditResponse] = await Promise.all([apiRequest(`/submissions/${row.id}/files`), apiRequest(`/submissions/${row.id}/audit`)]); files.value = fileResponse.data; auditItems.value = auditResponse.data } catch (error) { ElMessage.error(error.message) } finally { filesLoading.value = false } }
async function download(file) { try { await downloadFile(`/submissions/${selected.value.id}/files/${file.id}/download`, file.originalName) } catch (error) { ElMessage.error(error.message) } }
async function preview(file) { closePreview(); previewFile.value = file; previewVisible.value = true; previewLoading.value = true; try { previewUrl.value = await fetchFileBlob(`/submissions/${selected.value.id}/files/${file.id}/preview`) } catch (error) { ElMessage.error(error.message); previewVisible.value = false } finally { previewLoading.value = false } }
function closePreview() { if (previewUrl.value) URL.revokeObjectURL(previewUrl.value); previewUrl.value = ''; previewFile.value = null }
async function batchDownload() { downloading.value = true; try { await downloadFile('/submissions/batch-download', '材料审核原文件.zip', { method: 'POST', body: { submissionIds: selectedRows.value.map((item) => item.id) } }) } catch (error) { ElMessage.error(error.message) } finally { downloading.value = false } }

function openAssign() { assignForm.assigneeId = ''; assignForm.reason = ''; assignVisible.value = true }
async function confirmAssign() { if (!assignForm.assigneeId) return ElMessage.warning('请选择受派人'); if (selectionHasAssignment.value && !assignForm.reason) return ElMessage.warning('重新分配必须填写原因'); assigning.value = true; try { await apiRequest('/submissions/batch-assign', { method: 'POST', body: { submissionIds: selectedRows.value.map((item) => item.id), assigneeId: assignForm.assigneeId, reason: assignForm.reason, expectedAssignmentVersions: Object.fromEntries(selectedRows.value.map((item) => [item.id, item.assignmentVersion])) } }); ElMessage.success('审核任务已分配'); assignVisible.value = false; await loadReviews() } catch (error) { ElMessage.error(error.message) } finally { assigning.value = false } }
async function approve(row) { try { await ElMessageBox.confirm(`确认通过“${row.projectTitle} - ${row.categoryName}”吗？`, '审核通过', { type: 'success', confirmButtonText: '确认通过' }); await apiRequest(`/submissions/${row.id}/review`, { method: 'PATCH', body: { action: 'approve', assignmentVersion: row.assignmentVersion } }); ElMessage.success('材料审核已通过'); await loadReviews() } catch (error) { if (error !== 'cancel') ElMessage.error(error.message || '审核失败') } }
function openReturn(row) { selected.value = row; returnForm.reason = ''; returnVisible.value = true }
async function confirmReturn() { if (!(await returnFormRef.value?.validate().catch(() => false))) return; reviewing.value = true; try { await apiRequest(`/submissions/${selected.value.id}/review`, { method: 'PATCH', body: { action: 'return', reason: returnForm.reason, assignmentVersion: selected.value.assignmentVersion } }); ElMessage.success('材料已退回，负责人可查看修改意见'); returnVisible.value = false; await loadReviews() } catch (error) { ElMessage.error(error.message) } finally { reviewing.value = false } }

const auditLabel = (item) => ({ assigned: `${item.actorName} 分配给 ${item.toAssigneeName}`, reassigned: `${item.actorName} 从 ${item.fromAssigneeName} 改派给 ${item.toAssigneeName}`, reviewed: `${item.actorName} 审核通过`, returned: `${item.actorName} 审核退回` }[item.eventType] || item.eventType)
const statusLabel = (value) => ({ pending: '待审核', approved: '已通过', returned: '已退回' }[value] || value)
const statusType = (value) => ({ pending: 'warning', approved: 'success', returned: 'danger' }[value] || 'info')
const formatTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
const formatSize = (bytes) => Number(bytes) < 1024 * 1024 ? `${(Number(bytes) / 1024).toFixed(1)} KB` : `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`

onMounted(async () => { await Promise.all([loadReviews(), loadOptions()]) })
onBeforeUnmount(closePreview)
</script>
