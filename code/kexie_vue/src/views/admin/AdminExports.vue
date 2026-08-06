<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">整理包导出</h2>
        <p class="page-desc">使用结构化范围筛选生成 ZIP；正式目录仅包含每项材料最新审核通过版本。</p>
      </div>
      <el-button type="primary" @click="openCreate"><el-icon><Download /></el-icon>新建导出</el-button>
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
          <el-select v-model="filters.status" clearable placeholder="导出状态" style="width: 160px" @change="searchRecords">
            <el-option label="生成中" value="processing" /><el-option label="成功" value="success" /><el-option label="失败" value="failed" />
          </el-select>
          <el-button :loading="loading" @click="searchRecords"><el-icon><Refresh /></el-icon>刷新</el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="records" class="desktop-table" empty-text="暂无导出记录" style="width: 100%">
        <el-table-column label="导出批次" width="135"><template #default="{ row }">{{ batchLabel(row) }}</template></el-table-column>
        <el-table-column prop="templateName" label="使用模板" min-width="150" show-overflow-tooltip />
        <el-table-column prop="exportScopeLabel" label="结构化范围" min-width="230" show-overflow-tooltip />
        <el-table-column prop="exportUser" label="导出人" width="90" />
        <el-table-column prop="createdAt" label="创建时间" width="165"><template #default="{ row }">{{ formatTime(row.createdAt) }}</template></el-table-column>
        <el-table-column prop="exportStatus" label="状态" width="80"><template #default="{ row }"><el-tag :type="statusType(row.exportStatus)">{{ statusLabel(row.exportStatus) }}</el-tag></template></el-table-column>
        <el-table-column label="材料 / 缺失" width="105"><template #default="{ row }"><span v-if="row.exportSummary">{{ row.exportSummary.approvedMaterialCount }} / <strong :class="{ 'danger-text': row.exportSummary.missingCount }">{{ row.exportSummary.missingCount }}</strong></span><span v-else>-</span></template></el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }"><el-button text @click="showDetail(row)">详情</el-button><el-button text type="primary" :disabled="!row.downloadable" @click="download(row)">下载</el-button></template>
        </el-table-column>
      </el-table>

      <div class="mobile-card-list">
        <el-empty v-if="!records.length && !loading" class="empty-mobile" description="暂无导出记录" :image-size="72" />
        <article v-for="row in records" :key="row.id" class="mobile-data-card">
          <div class="mobile-card-header"><div><p class="mobile-card-title">{{ batchLabel(row) }}</p><div class="mobile-card-meta"><span>{{ row.templateName }}</span><span>{{ formatTime(row.createdAt) }}</span></div></div><el-tag :type="statusType(row.exportStatus)" size="small">{{ statusLabel(row.exportStatus) }}</el-tag></div>
          <div class="mobile-card-body">
            <div style="grid-column: 1 / -1"><span class="mobile-field-label">结构化范围</span><span class="mobile-field-value">{{ row.exportScopeLabel }}</span></div>
            <div><span class="mobile-field-label">导出人</span><span class="mobile-field-value">{{ row.exportUser }}</span></div>
            <div><span class="mobile-field-label">材料 / 缺失</span><span class="mobile-field-value">{{ row.exportSummary ? `${row.exportSummary.approvedMaterialCount} / ${row.exportSummary.missingCount}` : '-' }}</span></div>
          </div>
          <div class="mobile-card-footer"><el-button @click="showDetail(row)">查看详情</el-button><el-button type="primary" :disabled="!row.downloadable" @click="download(row)">下载 ZIP</el-button></div>
        </article>
      </div>

      <div v-if="pagination.total" class="pagination-row"><el-pagination v-model:current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total" layout="total, prev, pager, next" @current-change="loadRecords" /></div>
    </div>

    <el-dialog v-model="dialogVisible" title="新建材料整理包导出" width="760px" @closed="resetForm">
      <el-alert title="正式材料规则" type="info" :closable="false" show-icon>
        <template #default>仅导出每项材料最新一次“审核通过”的提交版本；待审核、退回和未提交材料会进入缺失材料报告，不进入正式材料目录。</template>
      </el-alert>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="104px" class="export-scope-form">
        <el-form-item label="归档模板" prop="archiveTemplateId"><el-select v-model="form.archiveTemplateId" filterable placeholder="选择已启用模板" style="width: 100%" @change="onTemplateChange"><el-option v-for="item in templates" :key="item.id" :label="item.templateName" :value="item.id" /></el-select></el-form-item>
        <el-divider content-position="left">结构化导出范围</el-divider>
        <el-form-item label="年度"><el-select v-model="form.years" multiple collapse-tags clearable placeholder="选择年度（可多选）" style="width: 100%"><el-option v-for="year in options.years" :key="year" :label="`${year} 年`" :value="year" /></el-select></el-form-item>
        <el-form-item label="组别"><el-select v-model="form.groups" multiple collapse-tags clearable placeholder="选择组别（可多选）" style="width: 100%"><el-option v-for="group in options.groups" :key="group" :label="group" :value="group" /></el-select></el-form-item>
        <el-form-item label="统筹任务" prop="materialTaskIds"><el-select v-model="form.materialTaskIds" multiple collapse-tags filterable placeholder="模板内的统筹任务" style="width: 100%"><el-option v-for="item in filteredMaterialTasks" :key="item.id" :label="`${item.taskName}（${taskStatusLabel(item.status)}）`" :value="item.id" /></el-select><p class="table-note">只显示已放入当前归档模板的统筹任务；选择模板后默认全部选中。</p></el-form-item>
        <el-form-item label="指定项目"><el-select v-model="form.projectIds" multiple collapse-tags filterable clearable placeholder="可进一步指定项目" style="width: 100%"><el-option v-for="item in filteredProjects" :key="item.id" :label="`${item.projectCode}｜${item.title}`" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="导出备注"><el-input v-model="form.remark" type="textarea" :rows="3" maxlength="1000" show-word-limit placeholder="可填写本次整理包用途或交接说明" /></el-form-item>
      </el-form>
      <section class="scope-preview-card"><strong>当前筛选：</strong>{{ scopePreview }}</section>
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="creating" @click="createExport">开始生成 ZIP</el-button></template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="导出记录详情" width="680px">
      <el-descriptions v-if="selectedRecord" :column="1" border>
        <el-descriptions-item label="导出批次">{{ batchLabel(selectedRecord) }}</el-descriptions-item>
        <el-descriptions-item label="使用模板">{{ selectedRecord.templateName }}</el-descriptions-item>
        <el-descriptions-item label="导出范围">{{ selectedRecord.exportScopeLabel }}</el-descriptions-item>
        <el-descriptions-item label="状态"><el-tag :type="statusType(selectedRecord.exportStatus)">{{ statusLabel(selectedRecord.exportStatus) }}</el-tag></el-descriptions-item>
        <el-descriptions-item label="统计摘要"><template v-if="selectedRecord.exportSummary">应收 {{ selectedRecord.exportSummary.expectedMaterialCount }} 项；含通过材料 {{ selectedRecord.exportSummary.approvedMaterialCount }} 项；导出 {{ selectedRecord.exportSummary.exportedFileCount }} 个文件；缺失 {{ selectedRecord.exportSummary.missingCount }} 条。</template><template v-else>生成完成后显示</template></el-descriptions-item>
        <el-descriptions-item v-if="selectedRecord.failureReason" label="失败原因"><span class="danger-text">{{ selectedRecord.failureReason }}</span></el-descriptions-item>
        <el-descriptions-item label="缺失报告">{{ selectedRecord.exportSummary?.missingReportIncluded ? 'ZIP 内已生成“缺失材料报告.csv”' : '没有缺失项' }}</el-descriptions-item>
        <el-descriptions-item label="备注">{{ selectedRecord.remark || '无' }}</el-descriptions-item>
        <el-descriptions-item label="创建 / 完成">{{ formatTime(selectedRecord.createdAt) }} / {{ formatTime(selectedRecord.finishedAt) }}</el-descriptions-item>
      </el-descriptions>
      <template #footer><el-button @click="detailVisible = false">关闭</el-button><el-button type="primary" :disabled="!selectedRecord?.downloadable" @click="download(selectedRecord)">下载 ZIP</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiRequest, downloadFile } from '../../services/http'

const records = ref([])
const templates = ref([])
const loading = ref(false)
const creating = ref(false)
const dialogVisible = ref(false)
const detailVisible = ref(false)
const selectedRecord = ref(null)
const formRef = ref()
const filters = reactive({ status: '' })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })
const options = reactive({ years: [], groups: [], materialTasks: [], projects: [] })
const newForm = () => ({ archiveTemplateId: null, years: [], groups: [], materialTaskIds: [], projectIds: [], remark: '' })
const form = reactive(newForm())
const rules = {
  archiveTemplateId: [{ required: true, message: '请选择归档模板' }],
  materialTaskIds: [{ type: 'array', required: true, min: 1, message: '请至少选择一个材料任务' }],
}
let pollingTimer

const summaries = computed(() => [
  { label: '导出记录', value: pagination.total || records.value.length },
  { label: '生成中', value: records.value.filter((item) => item.exportStatus === 'processing').length },
  { label: '本页成功', value: records.value.filter((item) => item.exportStatus === 'success').length },
  { label: '本页失败', value: records.value.filter((item) => item.exportStatus === 'failed').length },
])
const filteredProjects = computed(() => options.projects.filter((item) => (!form.years.length || form.years.includes(Number(item.projectYear))) && (!form.groups.length || form.groups.includes(item.projectGroup))))
const selectedTemplate = computed(() => templates.value.find((item) => Number(item.id) === Number(form.archiveTemplateId)))
const filteredMaterialTasks = computed(() => {
  const config = selectedTemplate.value?.templateConfig
  if (!config || Number(config.version) < 2) return options.materialTasks
  const ids = new Set()
  const visit = (nodes) => (nodes || []).forEach((node) => { if (node.type === 'task') ids.add(Number(node.materialTaskId)); else visit(node.children) })
  visit(config.nodes)
  return options.materialTasks.filter((item) => ids.has(Number(item.id)))
})
const scopePreview = computed(() => {
  const parts = []
  if (form.years.length) parts.push(`年度 ${form.years.join('、')}`)
  if (form.groups.length) parts.push(`组别 ${form.groups.join('、')}`)
  parts.push(`材料任务 ${form.materialTaskIds.length} 项`)
  if (form.projectIds.length) parts.push(`指定项目 ${form.projectIds.length} 项`)
  return parts.join('；')
})

function recordQuery() {
  const query = new URLSearchParams({ page: pagination.page, pageSize: pagination.pageSize })
  if (filters.status) query.set('status', filters.status)
  return query
}

async function loadRecords(silent = false) {
  if (!silent) loading.value = true
  try {
    const response = await apiRequest(`/archive-exports?${recordQuery()}`)
    records.value = response.data
    Object.assign(pagination, response.pagination)
  } catch (error) {
    if (!silent) ElMessage.error(error.message)
  } finally {
    if (!silent) loading.value = false
  }
}

async function loadFormOptions() {
  try {
    const [templateResponse, optionResponse] = await Promise.all([
      apiRequest('/archive-templates?page=1&pageSize=100&status=enabled'),
      apiRequest('/archive-exports/options'),
    ])
    templates.value = templateResponse.data
    Object.assign(options, optionResponse.data)
  } catch (error) {
    ElMessage.error(error.message)
  }
}

function searchRecords() {
  pagination.page = 1
  loadRecords()
}

async function openCreate() {
  Object.assign(form, newForm())
  dialogVisible.value = true
  await loadFormOptions()
}

function onTemplateChange() {
  form.materialTaskIds = filteredMaterialTasks.value.map((item) => Number(item.id))
}

function resetForm() {
  formRef.value?.clearValidate()
}

async function createExport() {
  if (!(await formRef.value?.validate().catch(() => false))) return
  if (!form.years.length && !form.groups.length && !form.projectIds.length) return ElMessage.warning('请至少选择年度、组别或指定项目中的一种范围')
  creating.value = true
  try {
    await apiRequest('/archive-exports', {
      method: 'POST',
      body: { archiveTemplateId: form.archiveTemplateId, scope: { years: form.years, groups: form.groups, materialTaskIds: form.materialTaskIds, projectIds: form.projectIds }, remark: form.remark },
    })
    ElMessage.success('导出任务已创建，系统正在生成 ZIP')
    dialogVisible.value = false
    filters.status = ''
    pagination.page = 1
    await loadRecords()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    creating.value = false
  }
}

async function showDetail(row) {
  try {
    const response = await apiRequest(`/archive-exports/${row.id}`)
    selectedRecord.value = response.data
    detailVisible.value = true
  } catch (error) {
    ElMessage.error(error.message)
  }
}

async function download(row) {
  if (!row?.downloadable) return
  try {
    await downloadFile(`/archive-exports/${row.id}/download`, `${batchLabel(row)}.zip`)
  } catch (error) {
    ElMessage.error(error.message)
  }
}

function startPolling() {
  pollingTimer = window.setInterval(() => {
    if (records.value.some((item) => item.exportStatus === 'processing')) loadRecords(true)
  }, 3000)
}

const batchLabel = (row) => `ARCH-${String(row.id).padStart(6, '0')}`
const statusLabel = (value) => ({ processing: '生成中', success: '成功', failed: '失败' }[value] || value)
const statusType = (value) => ({ processing: 'warning', success: 'success', failed: 'danger' }[value] || 'info')
const taskStatusLabel = (value) => ({ published: '收集中', closed: '已关闭' }[value] || value)
const formatTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'

onMounted(async () => { await loadRecords(); startPolling() })
onBeforeUnmount(() => window.clearInterval(pollingTimer))
</script>
