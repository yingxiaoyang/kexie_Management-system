<template>
  <div>
    <div class="page-header"><div><h2 class="page-title">材料提交</h2><p class="page-desc">按材料类别提交文件；被退回后可查看原因并重新提交。</p></div></div>
    <div class="panel">
      <el-table v-loading="loading" :data="tasks" style="width: 100%" empty-text="当前没有需要提交的材料任务">
        <el-table-column prop="taskName" label="材料任务" min-width="160" /><el-table-column prop="projectTitle" label="所属项目" min-width="210" show-overflow-tooltip /><el-table-column prop="categoryName" label="材料类别" width="140" /><el-table-column prop="deadlineAt" label="截止时间" width="180"><template #default="{ row }">{{ formatTime(row.deadlineAt) }}</template></el-table-column>
        <el-table-column label="任务模板" width="120"><template #default="{ row }"><el-button v-if="Number(row.templateCount)" text type="primary" @click="showTemplates(row)"><el-icon><Download /></el-icon>{{ row.templateCount }} 个模板</el-button><span v-else class="muted">无模板</span></template></el-table-column>
        <el-table-column label="提交状态" width="110"><template #default="{ row }"><el-tag :type="statusType(row)">{{ statusLabel(row) }}</el-tag></template></el-table-column>
        <el-table-column prop="returnReason" label="退回原因" min-width="180" show-overflow-tooltip />
        <el-table-column label="操作" width="130" fixed="right"><template #default="{ row }"><el-button text :disabled="!canSubmit(row)" @click="openUpload(row)"><el-icon><UploadFilled /></el-icon>{{ row.reviewStatus === 'returned' ? '重新提交' : '提交' }}</el-button></template></el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="uploadVisible" :title="`提交：${selected?.categoryName || ''}`" width="560px" @closed="uploadFiles = []">
      <el-descriptions v-if="selected" :column="1" border><el-descriptions-item label="项目">{{ selected.projectTitle }}</el-descriptions-item><el-descriptions-item label="任务">{{ selected.taskName }}</el-descriptions-item><el-descriptions-item label="限制">单文件 {{ selected.maxFileMb }}MB，项目累计 {{ selected.maxTaskProjectMb }}MB</el-descriptions-item></el-descriptions>
      <el-upload class="section" drag action="#" multiple :limit="20" :auto-upload="false" :accept="acceptTypes" :on-change="onFileChange" :on-remove="onFileRemove"><el-icon size="30"><UploadFilled /></el-icon><div>拖拽文件到此处，或点击选择</div><template #tip><div class="el-upload__tip">允许格式：{{ selected?.allowedExtensions?.join?.('、') || '按任务设置' }}</div></template></el-upload>
      <template #footer><el-button @click="uploadVisible = false">取消</el-button><el-button type="primary" :disabled="!uploadFiles.length" :loading="uploading" @click="submitFiles">保存提交</el-button></template>
    </el-dialog>

    <el-dialog v-model="templatesVisible" title="任务模板" width="600px"><el-table v-loading="templatesLoading" :data="templates" empty-text="暂无模板"><el-table-column prop="originalName" label="文件名" min-width="300" /><el-table-column prop="fileSize" label="大小" width="100"><template #default="{ row }">{{ formatSize(row.fileSize) }}</template></el-table-column><el-table-column label="操作" width="90"><template #default="{ row }"><el-button text type="primary" @click="downloadTemplate(row)">下载</el-button></template></el-table-column></el-table></el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiRequest, downloadFile } from '../../services/http'

const tasks = ref([]), loading = ref(false), selected = ref(null), uploadVisible = ref(false), uploadFiles = ref([]), uploading = ref(false)
const templatesVisible = ref(false), templatesLoading = ref(false), templates = ref([])
const acceptTypes = computed(() => (selected.value?.allowedExtensions || []).map((ext) => `.${ext}`).join(','))
async function loadTasks() { loading.value = true; try { tasks.value = (await apiRequest('/material-tasks/my')).data } catch (e) { ElMessage.error(e.message) } finally { loading.value = false } }
function canSubmit(row) { return row.taskStatus === 'published' && !['pending', 'approved'].includes(row.reviewStatus) }
function openUpload(row) { selected.value = row; uploadFiles.value = []; uploadVisible.value = true }
function onFileChange(_file, files) { uploadFiles.value = files.map((item) => item.raw).filter(Boolean) }
function onFileRemove(_file, files) { uploadFiles.value = files.map((item) => item.raw).filter(Boolean) }
async function submitFiles() { uploading.value = true; try { const body = new FormData(); body.append('taskId', selected.value.taskId); body.append('projectId', selected.value.projectId); body.append('categoryId', selected.value.categoryId); uploadFiles.value.forEach((file) => body.append('files', file)); await apiRequest('/uploads/submissions', { method: 'POST', body }); ElMessage.success('材料提交成功，等待管理员审核'); uploadVisible.value = false; await loadTasks() } catch (e) { ElMessage.error(e.message) } finally { uploading.value = false } }
async function showTemplates(row) { selected.value = row; templatesVisible.value = true; templatesLoading.value = true; try { templates.value = (await apiRequest(`/material-tasks/${row.taskId}/templates`)).data } catch (e) { ElMessage.error(e.message) } finally { templatesLoading.value = false } }
async function downloadTemplate(file) { try { await downloadFile(`/material-tasks/${selected.value.taskId}/templates/${file.id}/download`, file.originalName) } catch (e) { ElMessage.error(e.message) } }
function statusLabel(row) { if (!row.submissionId) return row.taskStatus === 'closed' ? '已关闭' : '未提交'; return ({ pending: '待审核', approved: '已通过', returned: '已退回' }[row.reviewStatus] || row.reviewStatus) }
function statusType(row) { return ({ pending: 'warning', approved: 'success', returned: 'danger' }[row.reviewStatus] || 'info') }
const formatTime = (v) => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '不设截止时间'
const formatSize = (bytes) => Number(bytes) < 1024 * 1024 ? `${(Number(bytes) / 1024).toFixed(1)} KB` : `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`
onMounted(loadTasks)
</script>
