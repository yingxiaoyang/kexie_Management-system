<template>
  <div>
    <div class="page-header"><div><h2 class="page-title">材料审核</h2><p class="page-desc">查看负责人上传文件；退回时必须填写明确原因，负责人可再次提交。</p></div></div>
    <div class="panel">
      <div class="toolbar"><div class="filters"><el-input v-model="filters.keyword" placeholder="搜索项目、材料、提交人" clearable @keyup.enter="loadReviews"><template #prefix><el-icon><Search /></el-icon></template></el-input><el-select v-model="filters.reviewStatus" placeholder="审核状态" clearable style="width: 150px"><el-option label="待审核" value="pending" /><el-option label="通过" value="approved" /><el-option label="退回" value="returned" /></el-select><el-button :loading="loading" @click="loadReviews">查询</el-button></div></div>
      <el-table v-loading="loading" :data="reviews" style="width: 100%" empty-text="暂无材料提交记录">
        <el-table-column prop="projectTitle" label="项目" min-width="220" show-overflow-tooltip /><el-table-column prop="taskName" label="任务" width="160" /><el-table-column prop="categoryName" label="材料类别" width="140" /><el-table-column prop="submitter" label="提交人" width="100" /><el-table-column prop="submittedAt" label="提交时间" width="180"><template #default="{ row }">{{ formatTime(row.submittedAt) }}</template></el-table-column>
        <el-table-column prop="fileCount" label="文件" width="70" /><el-table-column prop="reviewStatus" label="状态" width="100"><template #default="{ row }"><el-tag :type="statusType(row.reviewStatus)">{{ statusLabel(row.reviewStatus) }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="230" fixed="right"><template #default="{ row }"><el-button text @click="showFiles(row)">查看文件</el-button><el-button v-if="row.reviewStatus === 'pending'" text type="success" @click="approve(row)">通过</el-button><el-button v-if="row.reviewStatus === 'pending'" text type="danger" @click="openReturn(row)">退回</el-button></template></el-table-column>
      </el-table>
      <div class="pagination-row" v-if="pagination.total"><el-pagination v-model:current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total" layout="total, prev, pager, next" @current-change="loadReviews" /></div>
    </div>

    <el-dialog v-model="filesVisible" title="提交文件" width="620px"><el-table v-loading="filesLoading" :data="files" empty-text="没有可下载的文件"><el-table-column prop="originalName" label="文件名" min-width="260" /><el-table-column prop="fileSize" label="大小" width="100"><template #default="{ row }">{{ formatSize(row.fileSize) }}</template></el-table-column><el-table-column label="操作" width="100"><template #default="{ row }"><el-button text type="primary" @click="download(row)">下载</el-button></template></el-table-column></el-table></el-dialog>
    <el-dialog v-model="returnVisible" title="填写退回原因" width="520px"><el-form ref="returnFormRef" :model="returnForm" :rules="returnRules" label-width="92px"><el-form-item label="退回原因" prop="reason"><el-input v-model.trim="returnForm.reason" type="textarea" :rows="4" placeholder="请说明需要补充或修改的内容" /></el-form-item></el-form><template #footer><el-button @click="returnVisible = false">取消</el-button><el-button type="danger" :loading="reviewing" @click="confirmReturn">确认退回</el-button></template></el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiRequest, downloadFile } from '../../services/http'

const reviews = ref([]), loading = ref(false), reviewing = ref(false), filters = reactive({ keyword: '', reviewStatus: 'pending' }), pagination = reactive({ page: 1, pageSize: 20, total: 0 })
const filesVisible = ref(false), filesLoading = ref(false), files = ref([]), selected = ref(null)
const returnVisible = ref(false), returnFormRef = ref(), returnForm = reactive({ reason: '' }), returnRules = { reason: [{ required: true, message: '退回原因不能为空', trigger: 'blur' }] }
function params() { const p = new URLSearchParams({ page: pagination.page, pageSize: pagination.pageSize }); filters.keyword && p.set('keyword', filters.keyword); filters.reviewStatus && p.set('reviewStatus', filters.reviewStatus); return p }
async function loadReviews() { loading.value = true; try { const r = await apiRequest(`/submissions?${params()}`); reviews.value = r.data; Object.assign(pagination, r.pagination) } catch (e) { ElMessage.error(e.message) } finally { loading.value = false } }
async function showFiles(row) { selected.value = row; filesVisible.value = true; filesLoading.value = true; try { files.value = (await apiRequest(`/submissions/${row.id}/files`)).data } catch (e) { ElMessage.error(e.message) } finally { filesLoading.value = false } }
async function download(file) { try { await downloadFile(`/submissions/${selected.value.id}/files/${file.id}/download`, file.originalName) } catch (e) { ElMessage.error(e.message) } }
async function approve(row) { try { await ElMessageBox.confirm(`确认通过“${row.projectTitle} - ${row.categoryName}”吗？`, '审核通过', { type: 'success' }); await apiRequest(`/submissions/${row.id}/review`, { method: 'PATCH', body: { action: 'approve' } }); ElMessage.success('审核已通过'); await loadReviews() } catch (e) { if (e !== 'cancel') ElMessage.error(e.message || '审核失败') } }
function openReturn(row) { selected.value = row; returnForm.reason = ''; returnVisible.value = true }
async function confirmReturn() { if (!(await returnFormRef.value?.validate().catch(() => false))) return; reviewing.value = true; try { await apiRequest(`/submissions/${selected.value.id}/review`, { method: 'PATCH', body: { action: 'return', reason: returnForm.reason } }); ElMessage.success('材料已退回'); returnVisible.value = false; await loadReviews() } catch (e) { ElMessage.error(e.message) } finally { reviewing.value = false } }
const statusLabel = (v) => ({ pending: '待审核', approved: '已通过', returned: '已退回' }[v] || v)
const statusType = (v) => ({ pending: 'warning', approved: 'success', returned: 'danger' }[v] || 'info')
const formatTime = (v) => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '-'
const formatSize = (bytes) => Number(bytes) < 1024 * 1024 ? `${(Number(bytes) / 1024).toFixed(1)} KB` : `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`
onMounted(loadReviews)
</script>
