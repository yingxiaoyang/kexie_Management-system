<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">材料任务</h2>
        <p class="page-desc">统一配置收集范围、材料清单、截止时间与任务模板。</p>
      </div>
      <div class="page-actions">
        <el-button type="primary" @click="openCreate"><el-icon><Plus /></el-icon>新建任务</el-button>
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
          <el-input v-model="filters.keyword" placeholder="搜索任务名称" clearable @keyup.enter="searchTasks">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-select v-model="filters.status" placeholder="任务状态" clearable style="width: 150px" @change="searchTasks">
            <el-option label="草稿" value="draft" />
            <el-option label="收集中" value="published" />
            <el-option label="已关闭" value="closed" />
          </el-select>
          <el-button :loading="loading" @click="searchTasks">查询</el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="tasks" class="desktop-table" style="width: 100%" empty-text="暂无材料任务">
        <el-table-column prop="taskName" label="任务名称" min-width="180" />
        <el-table-column prop="scopeLabel" label="适用范围" width="150" />
        <el-table-column prop="categoryNames" label="材料清单" min-width="220" show-overflow-tooltip />
        <el-table-column label="任务模板" width="110">
          <template #default="{ row }"><el-tag v-if="Number(row.templateCount)" type="success" effect="plain">{{ row.templateCount }} 个</el-tag><span v-else class="muted">未提供</span></template>
        </el-table-column>
        <el-table-column prop="deadlineAt" label="截止时间" width="180"><template #default="{ row }">{{ formatTime(row.deadlineAt) }}</template></el-table-column>
        <el-table-column prop="status" label="状态" width="100"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="待审核" width="90"><template #default="{ row }"><strong :class="{ 'danger-text': Number(row.pendingCount) }">{{ Number(row.pendingCount) }}</strong></template></el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'draft'" text @click="openEdit(row)">编辑</el-button>
            <el-button v-if="row.status === 'draft'" text type="success" @click="setStatus(row, 'published')">发布</el-button>
            <el-button v-if="row.status === 'published'" text @click="setStatus(row, 'closed')">关闭</el-button>
            <el-button v-if="row.status === 'closed'" text type="primary" @click="setStatus(row, 'published')">重新开放</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="mobile-card-list">
        <el-empty v-if="!tasks.length && !loading" class="empty-mobile" description="暂无材料任务" :image-size="72" />
        <article v-for="row in tasks" :key="row.id" class="mobile-data-card">
          <div class="mobile-card-header">
            <div>
              <p class="mobile-card-title">{{ row.taskName }}</p>
              <div class="mobile-card-meta"><span>{{ row.scopeLabel }}</span></div>
            </div>
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </div>
          <div class="mobile-card-body">
            <div style="grid-column: 1 / -1"><span class="mobile-field-label">材料清单</span><span class="mobile-field-value">{{ row.categoryNames || '未配置' }}</span></div>
            <div><span class="mobile-field-label">截止时间</span><span class="mobile-field-value">{{ formatTime(row.deadlineAt) }}</span></div>
            <div><span class="mobile-field-label">模板 / 待审核</span><span class="mobile-field-value">{{ Number(row.templateCount) }} 个 / {{ Number(row.pendingCount) }} 项</span></div>
          </div>
          <div class="mobile-card-footer">
            <el-button v-if="row.status === 'draft'" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="row.status === 'draft'" type="success" @click="setStatus(row, 'published')">发布任务</el-button>
            <el-button v-if="row.status === 'published'" @click="setStatus(row, 'closed')">关闭任务</el-button>
            <el-button v-if="row.status === 'closed'" type="primary" @click="setStatus(row, 'published')">重新开放</el-button>
          </div>
        </article>
      </div>

      <div class="pagination-row" v-if="pagination.total">
        <el-pagination v-model:current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total" layout="total, prev, pager, next" @current-change="loadTasks" />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑材料任务' : '新建材料任务'" width="700px" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="104px">
        <el-form-item label="任务名称" prop="taskName"><el-input v-model.trim="form.taskName" placeholder="例如：2026 年中期检查材料" /></el-form-item>
        <el-form-item label="任务说明"><el-input v-model="form.taskDescription" type="textarea" :rows="3" placeholder="向负责人说明提交要求和注意事项" /></el-form-item>
        <el-form-item label="适用范围" prop="projectScopeType"><el-select v-model="form.projectScopeType" style="width: 100%"><el-option label="全部项目" value="all" /><el-option label="指定年度" value="year" /><el-option label="指定组别" value="group" /></el-select></el-form-item>
        <el-form-item v-if="form.projectScopeType === 'year'" label="项目年度" prop="projectYear"><el-input-number v-model="form.projectYear" :min="2000" :max="2100" style="width: 100%" /></el-form-item>
        <el-form-item v-if="form.projectScopeType === 'group'" label="项目组别" prop="projectGroup"><el-input v-model.trim="form.projectGroup" /></el-form-item>
        <el-form-item label="材料类别" prop="categoryText"><el-input v-model="form.categoryText" type="textarea" :rows="4" placeholder="每行填写一个材料类别，例如：&#10;中期报告&#10;研究日志&#10;签字页" /></el-form-item>
        <el-form-item label="截止时间"><el-date-picker v-model="form.deadlineAt" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" /></el-form-item>
        <el-form-item label="允许格式"><el-checkbox-group v-model="form.allowedExtensions"><el-checkbox v-for="ext in extensionOptions" :key="ext" :value="ext">{{ ext.toUpperCase() }}</el-checkbox></el-checkbox-group></el-form-item>
        <el-form-item label="大小限制"><div class="inline-fields"><el-input-number v-model="form.maxFileMb" :min="1" :max="50" /><span>MB/文件</span><el-input-number v-model="form.maxTaskProjectMb" :min="form.maxFileMb" :max="500" /><span>MB/项目累计</span></div></el-form-item>
        <el-form-item label="提供模板"><el-switch v-model="form.hasTemplate" active-text="提供" inactive-text="不提供" /></el-form-item>
        <el-form-item v-if="form.hasTemplate" label="模板文件"><el-upload action="#" :auto-upload="false" multiple :limit="10" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.zip" :on-change="onTemplateChange" :on-remove="onTemplateRemove"><el-button><el-icon><Upload /></el-icon>选择模板文件</el-button><template #tip><div class="el-upload__tip">可选多个模板；创建任务后会一并上传。</div></template></el-upload></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button :loading="saving" @click="saveTask('draft')">保存草稿</el-button>
        <el-button v-if="!form.id" type="primary" :loading="saving" @click="saveTask('published')">创建并发布</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiRequest } from '../../services/http'

const extensionOptions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'zip']
const tasks = ref([])
const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const formRef = ref()
const templateFiles = ref([])
const filters = reactive({ keyword: '', status: '' })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })
const newForm = () => ({ id: null, taskName: '', taskDescription: '', projectScopeType: 'all', projectYear: new Date().getFullYear(), projectGroup: '', categoryText: '', deadlineAt: '', allowedExtensions: [...extensionOptions], maxFileMb: 50, maxTaskProjectMb: 500, hasTemplate: false })
const form = reactive(newForm())
const rules = {
  taskName: [{ required: true, message: '请输入任务名称', trigger: 'blur' }],
  projectScopeType: [{ required: true, message: '请选择范围' }],
  projectYear: [{ validator: (_rule, value, callback) => form.projectScopeType !== 'year' || value ? callback() : callback(new Error('请选择年度')) }],
  projectGroup: [{ validator: (_rule, value, callback) => form.projectScopeType !== 'group' || value ? callback() : callback(new Error('请输入组别')) }],
  categoryText: [{ required: true, message: '请至少填写一个材料类别', trigger: 'blur' }],
}
const summaries = computed(() => [
  { label: '当前列表', value: pagination.total || tasks.value.length },
  { label: '收集中', value: tasks.value.filter((item) => item.status === 'published').length },
  { label: '草稿', value: tasks.value.filter((item) => item.status === 'draft').length },
  { label: '本页待审核', value: tasks.value.reduce((total, item) => total + Number(item.pendingCount || 0), 0) },
])

function params() {
  const query = new URLSearchParams({ page: pagination.page, pageSize: pagination.pageSize })
  if (filters.keyword) query.set('keyword', filters.keyword)
  if (filters.status) query.set('status', filters.status)
  return query
}

async function loadTasks() {
  loading.value = true
  try {
    const response = await apiRequest(`/material-tasks?${params()}`)
    tasks.value = response.data
    Object.assign(pagination, response.pagination)
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    loading.value = false
  }
}

function searchTasks() {
  pagination.page = 1
  loadTasks()
}

function openCreate() {
  Object.assign(form, newForm())
  templateFiles.value = []
  dialogVisible.value = true
}

function openEdit(row) {
  Object.assign(form, newForm(), row, {
    id: row.id,
    categoryText: String(row.categoryNames || '').split('、').join('\n'),
    deadlineAt: row.deadlineAt ? String(row.deadlineAt).replace('T', ' ').slice(0, 19) : '',
    allowedExtensions: Array.isArray(row.allowedExtensions) ? row.allowedExtensions : [...extensionOptions],
    hasTemplate: Boolean(row.hasTemplate || Number(row.templateCount)),
  })
  templateFiles.value = []
  dialogVisible.value = true
}

function resetForm() {
  templateFiles.value = []
  formRef.value?.clearValidate()
}

function onTemplateChange(_file, files) {
  templateFiles.value = files.map((item) => item.raw).filter(Boolean)
}

function onTemplateRemove(_file, files) {
  templateFiles.value = files.map((item) => item.raw).filter(Boolean)
}

function categories() {
  return [...new Set(form.categoryText.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean))]
    .map((categoryName, sortOrder) => ({ categoryName, isRequired: true, sortOrder }))
}

async function saveTask(status) {
  if (!(await formRef.value?.validate().catch(() => false))) return
  if (!categories().length) return ElMessage.warning('请至少填写一个材料类别')
  saving.value = true
  try {
    const existingTemplates = form.id && form.hasTemplate && !templateFiles.value.length
    const response = await apiRequest(form.id ? `/material-tasks/${form.id}` : '/material-tasks', {
      method: form.id ? 'PUT' : 'POST',
      body: { ...form, status, categories: categories(), hasTemplate: existingTemplates || (form.hasTemplate && templateFiles.value.length > 0) },
    })
    const taskId = form.id || response.data.id
    if (form.hasTemplate && templateFiles.value.length) {
      const body = new FormData()
      body.append('taskId', taskId)
      templateFiles.value.forEach((file) => body.append('files', file))
      await apiRequest('/uploads/task-templates', { method: 'POST', body })
    }
    ElMessage.success(status === 'published' ? '任务已发布' : '草稿已保存')
    dialogVisible.value = false
    await loadTasks()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    saving.value = false
  }
}

async function setStatus(row, status) {
  try {
    await ElMessageBox.confirm(`确认将任务设置为“${statusLabel(status)}”吗？`, '任务状态', { type: 'warning' })
    await apiRequest(`/material-tasks/${row.id}/status`, { method: 'PATCH', body: { status } })
    ElMessage.success('任务状态已更新')
    await loadTasks()
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(error.message || '操作失败')
  }
}

const statusLabel = (value) => ({ draft: '草稿', published: '收集中', closed: '已关闭' }[value] || value)
const statusType = (value) => ({ draft: 'info', published: 'success', closed: '' }[value] || 'info')
const formatTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '不设截止时间'

onMounted(loadTasks)
</script>
