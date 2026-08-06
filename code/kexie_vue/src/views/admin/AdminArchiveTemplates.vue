<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">归档模板</h2>
        <p class="page-desc">可视化配置 ZIP 目录层级和文件命名规则，保存前会实时显示示例路径。</p>
      </div>
      <el-button type="primary" @click="openCreate"><el-icon><Plus /></el-icon>新建模板</el-button>
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
          <el-input v-model="filters.keyword" clearable placeholder="搜索模板名称" @keyup.enter="searchTemplates">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-select v-model="filters.status" clearable placeholder="模板状态" style="width: 150px" @change="searchTemplates">
            <el-option label="启用" value="enabled" />
            <el-option label="停用" value="disabled" />
          </el-select>
          <el-button :loading="loading" @click="searchTemplates">查询</el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="templates" class="desktop-table" empty-text="暂无归档模板" style="width: 100%">
        <el-table-column prop="templateName" label="模板名称" min-width="190" />
        <el-table-column label="目录层级" min-width="320" show-overflow-tooltip>
          <template #default="{ row }">{{ directoryRule(row) }}</template>
        </el-table-column>
        <el-table-column label="文件命名" min-width="250" show-overflow-tooltip>
          <template #default="{ row }">{{ row.templateConfig.fileNameRule }}</template>
        </el-table-column>
        <el-table-column prop="updatedAt" label="更新时间" width="180"><template #default="{ row }">{{ formatTime(row.updatedAt) }}</template></el-table-column>
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }"><el-tag :type="row.status === 'enabled' ? 'success' : 'info'">{{ statusLabel(row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button text @click="openEdit(row)">编辑</el-button>
            <el-button text @click="showRowPreview(row)">预览</el-button>
            <el-button text :type="row.status === 'enabled' ? 'warning' : 'success'" @click="toggleStatus(row)">
              {{ row.status === 'enabled' ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="mobile-card-list">
        <el-empty v-if="!templates.length && !loading" class="empty-mobile" description="暂无归档模板" :image-size="72" />
        <article v-for="row in templates" :key="row.id" class="mobile-data-card">
          <div class="mobile-card-header">
            <div>
              <p class="mobile-card-title">{{ row.templateName }}</p>
              <div class="mobile-card-meta"><span>{{ row.templateConfig.directoryLevels.length }} 层目录</span><span>{{ formatTime(row.updatedAt) }}</span></div>
            </div>
            <el-tag :type="row.status === 'enabled' ? 'success' : 'info'" size="small">{{ statusLabel(row.status) }}</el-tag>
          </div>
          <div class="mobile-card-body">
            <div style="grid-column: 1 / -1"><span class="mobile-field-label">目录层级</span><span class="mobile-field-value">{{ directoryRule(row) }}</span></div>
            <div style="grid-column: 1 / -1"><span class="mobile-field-label">文件命名</span><span class="mobile-field-value">{{ row.templateConfig.fileNameRule }}</span></div>
          </div>
          <div class="mobile-card-footer">
            <el-button @click="openEdit(row)">编辑</el-button>
            <el-button @click="showRowPreview(row)">预览</el-button>
            <el-button :type="row.status === 'enabled' ? 'warning' : 'success'" @click="toggleStatus(row)">{{ row.status === 'enabled' ? '停用' : '启用' }}</el-button>
          </div>
        </article>
      </div>

      <div v-if="pagination.total" class="pagination-row">
        <el-pagination v-model:current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total" layout="total, prev, pager, next" @current-change="loadTemplates" />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑归档模板' : '新建归档模板'" width="820px" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="104px">
        <el-form-item label="模板名称" prop="templateName"><el-input v-model.trim="form.templateName" maxlength="160" show-word-limit placeholder="例如：年度结项材料归档模板" /></el-form-item>
        <el-form-item label="模板状态"><el-switch v-model="form.enabled" active-text="启用" inactive-text="停用" /></el-form-item>

        <el-form-item label="目录层级" required>
          <div class="archive-config-block">
            <div v-for="(level, index) in form.directoryLevels" :key="level.key" class="archive-level-row">
              <div class="archive-level-index">第 {{ index + 1 }} 层</div>
              <el-input v-model.trim="level.pattern" placeholder="输入固定文字或插入占位字段" />
              <el-select placeholder="插入字段" class="placeholder-select" @change="(token) => insertLevelToken(index, token)">
                <el-option v-for="item in placeholders" :key="item.token" :label="item.label" :value="item.token" />
              </el-select>
              <div class="archive-level-actions">
                <el-button circle :disabled="index === 0" aria-label="上移" @click="moveLevel(index, -1)"><el-icon><ArrowUp /></el-icon></el-button>
                <el-button circle :disabled="index === form.directoryLevels.length - 1" aria-label="下移" @click="moveLevel(index, 1)"><el-icon><ArrowDown /></el-icon></el-button>
                <el-button circle type="danger" plain :disabled="form.directoryLevels.length === 1" aria-label="删除" @click="removeLevel(index)"><el-icon><Delete /></el-icon></el-button>
              </div>
            </div>
            <el-button plain :disabled="form.directoryLevels.length >= 8" @click="addLevel"><el-icon><Plus /></el-icon>增加目录层级</el-button>
          </div>
        </el-form-item>

        <el-form-item label="文件命名" prop="fileNameRule">
          <div class="archive-config-block">
            <el-input v-model.trim="form.fileNameRule" placeholder="例如：{项目编号}_{作品名称}_{负责人}_{材料类别}_{原文件名}" />
            <div class="placeholder-toolbar">
              <span class="muted">插入：</span>
              <el-button v-for="item in placeholders" :key="item.token" size="small" plain @click="insertFileToken(item.token)">{{ item.label }}</el-button>
            </div>
            <p class="table-note">系统会保留原文件扩展名；Windows 非法字符会自动替换，重名文件会追加序号。</p>
          </div>
        </el-form-item>
      </el-form>

      <section class="archive-preview-card" aria-live="polite">
        <div class="archive-preview-title"><el-icon><View /></el-icon>保存前示例预览</div>
        <div class="archive-preview-line"><span>示例目录</span><code>{{ preview.directory || '请先配置目录层级' }}</code></div>
        <div class="archive-preview-line"><span>示例文件</span><code>{{ preview.fileName || '请先配置文件命名' }}</code></div>
        <p>示例数据：2026 年 / 创新组 / CX2026-001 / 智能校园材料管理系统 / 张同学 / 中期检查材料 / 中期报告。</p>
      </section>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveTemplate">确认预览并保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="previewDialogVisible" title="模板路径预览" width="680px">
      <section class="archive-preview-card is-dialog-preview">
        <div class="archive-preview-line"><span>示例目录</span><code>{{ selectedPreview.directory }}</code></div>
        <div class="archive-preview-line"><span>示例文件</span><code>{{ selectedPreview.fileName }}</code></div>
      </section>
      <template #footer><el-button type="primary" @click="previewDialogVisible = false">关闭</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiRequest } from '../../services/http'

const placeholders = [
  { label: '年度', token: '{年度}' }, { label: '组别', token: '{组别}' },
  { label: '项目编号', token: '{项目编号}' }, { label: '作品名称', token: '{作品名称}' },
  { label: '负责人', token: '{负责人}' }, { label: '材料任务', token: '{材料任务}' },
  { label: '材料类别', token: '{材料类别}' }, { label: '原文件名', token: '{原文件名}' },
]
const sampleValues = { 年度: '2026', 组别: '创新组', 项目编号: 'CX2026-001', 作品名称: '智能校园材料管理系统', 负责人: '张同学', 材料任务: '中期检查材料', 材料类别: '中期报告', 原文件名: '中期报告终稿' }
const templates = ref([])
const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const previewDialogVisible = ref(false)
const selectedPreview = reactive({ directory: '', fileName: '' })
const formRef = ref()
const filters = reactive({ keyword: '', status: '' })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })
let levelKey = 0
const makeLevel = (pattern = '') => ({ key: ++levelKey, pattern })
const newForm = () => ({ id: null, templateName: '', enabled: true, directoryLevels: [makeLevel('{年度}年'), makeLevel('{组别}'), makeLevel('{项目编号}-{作品名称}'), makeLevel('{材料任务}'), makeLevel('{材料类别}')], fileNameRule: '{项目编号}_{作品名称}_{负责人}_{材料类别}_{原文件名}' })
const form = reactive(newForm())
const rules = {
  templateName: [{ required: true, message: '请输入模板名称', trigger: 'blur' }],
  fileNameRule: [{ required: true, message: '请配置文件命名规则', trigger: 'blur' }],
}
const summaries = computed(() => [
  { label: '模板总数', value: pagination.total || templates.value.length },
  { label: '本页启用', value: templates.value.filter((item) => item.status === 'enabled').length },
  { label: '本页停用', value: templates.value.filter((item) => item.status === 'disabled').length },
  { label: '支持占位字段', value: placeholders.length },
])

function cleanComponent(value) {
  let result = String(value || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim()
  if (!result || result === '.' || result === '..') result = '未命名'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(result)) result = `_${result}`
  return result.slice(0, 120)
}

function renderPattern(pattern) {
  return cleanComponent(String(pattern || '').replace(/\{([^{}]+)\}/g, (_match, key) => sampleValues[key] || ''))
}

const preview = computed(() => ({
  directory: form.directoryLevels.filter((item) => item.pattern.trim()).map((item) => renderPattern(item.pattern)).join(' / '),
  fileName: form.fileNameRule.trim() ? `${renderPattern(form.fileNameRule)}.docx` : '',
}))

function queryParams() {
  const query = new URLSearchParams({ page: pagination.page, pageSize: pagination.pageSize })
  if (filters.keyword) query.set('keyword', filters.keyword)
  if (filters.status) query.set('status', filters.status)
  return query
}

async function loadTemplates() {
  loading.value = true
  try {
    const response = await apiRequest(`/archive-templates?${queryParams()}`)
    templates.value = response.data
    Object.assign(pagination, response.pagination)
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    loading.value = false
  }
}

function searchTemplates() {
  pagination.page = 1
  loadTemplates()
}

function openCreate() {
  Object.assign(form, newForm())
  dialogVisible.value = true
}

function openEdit(row) {
  Object.assign(form, {
    id: row.id,
    templateName: row.templateName,
    enabled: row.status === 'enabled',
    directoryLevels: row.templateConfig.directoryLevels.map((item) => makeLevel(item.pattern)),
    fileNameRule: row.templateConfig.fileNameRule,
  })
  dialogVisible.value = true
}

function resetForm() {
  formRef.value?.clearValidate()
}

function addLevel() {
  if (form.directoryLevels.length < 8) form.directoryLevels.push(makeLevel('{材料类别}'))
}

function removeLevel(index) {
  if (form.directoryLevels.length > 1) form.directoryLevels.splice(index, 1)
}

function moveLevel(index, offset) {
  const target = index + offset
  if (target < 0 || target >= form.directoryLevels.length) return
  const [level] = form.directoryLevels.splice(index, 1)
  form.directoryLevels.splice(target, 0, level)
}

function insertLevelToken(index, token) {
  form.directoryLevels[index].pattern += token
}

function insertFileToken(token) {
  form.fileNameRule += token
}

function configOf(source = form) {
  return { version: 1, directoryLevels: source.directoryLevels.map((item) => ({ pattern: item.pattern.trim() })), fileNameRule: source.fileNameRule.trim() }
}

async function saveTemplate() {
  if (!(await formRef.value?.validate().catch(() => false))) return
  if (form.directoryLevels.some((item) => !item.pattern.trim())) return ElMessage.warning('每一级目录都必须填写规则')
  saving.value = true
  try {
    await apiRequest(form.id ? `/archive-templates/${form.id}` : '/archive-templates', {
      method: form.id ? 'PUT' : 'POST',
      body: { templateName: form.templateName, status: form.enabled ? 'enabled' : 'disabled', templateConfig: configOf() },
    })
    ElMessage.success(form.id ? '归档模板已更新' : '归档模板已创建')
    dialogVisible.value = false
    await loadTemplates()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    saving.value = false
  }
}

async function toggleStatus(row) {
  const status = row.status === 'enabled' ? 'disabled' : 'enabled'
  try {
    await ElMessageBox.confirm(`确认${status === 'enabled' ? '启用' : '停用'}模板“${row.templateName}”吗？`, '模板状态', { type: 'warning' })
    await apiRequest(`/archive-templates/${row.id}/status`, { method: 'PATCH', body: { status } })
    ElMessage.success('模板状态已更新')
    await loadTemplates()
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(error.message || '操作失败')
  }
}

async function showRowPreview(row) {
  try {
    const response = await apiRequest('/archive-templates/preview', { method: 'POST', body: { templateConfig: row.templateConfig } })
    Object.assign(selectedPreview, response.data)
    previewDialogVisible.value = true
  } catch (error) {
    ElMessage.error(error.message)
  }
}

const directoryRule = (row) => row.templateConfig.directoryLevels.map((item) => item.pattern).join(' / ')
const statusLabel = (value) => ({ enabled: '启用', disabled: '停用' }[value] || value)
const formatTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'

onMounted(loadTemplates)
</script>
