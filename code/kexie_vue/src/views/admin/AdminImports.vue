<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">数据导入</h2>
        <p class="page-desc">选择要处理的数据，下载对应模板，预检查确认后再正式导入。</p>
      </div>
      <el-button @click="loadRecords">
        <el-icon><Refresh /></el-icon>
        刷新记录
      </el-button>
    </div>

    <section class="import-module-section">
      <div class="import-step-title"><span>1</span>选择导入内容</div>
      <div class="import-module-list">
        <button
          v-for="module in modules"
          :key="module.key"
          type="button"
          class="import-module-option"
          :class="{ active: activeType === module.key }"
          @click="selectModule(module.key)"
        >
          <el-icon><component :is="moduleIcon(module.key)" /></el-icon>
          <span>
            <strong>{{ module.title }}</strong>
            <small>{{ module.description }}</small>
          </span>
          <el-icon class="module-check"><CircleCheckFilled /></el-icon>
        </button>
      </div>
    </section>

    <div class="import-workspace">
      <section class="panel import-panel">
        <div class="import-current-head">
          <div>
            <div class="import-step-title"><span>2</span>设置模板字段</div>
            <h3>{{ currentModule?.title }}</h3>
          </div>
          <el-tag v-if="currentModule?.kind === 'create'" type="success" effect="plain">新建数据</el-tag>
          <el-tag v-else effect="plain">更新已有数据</el-tag>
        </div>

        <template v-if="currentModule">
          <div v-if="currentModule.kind === 'update'" class="import-field-block">
            <div class="import-field-label">模板固定列（用于定位或操作）</div>
            <div class="import-fixed-fields">
              <el-tag v-for="field in currentModule.fixedFields" :key="field.field" effect="plain">
                <el-icon><Lock /></el-icon>
                {{ field.label }}
              </el-tag>
            </div>
          </div>

          <div class="import-field-block">
            <div class="import-field-label">
              {{ currentModule.kind === 'create' ? '模板包含字段' : '选择要修改的字段' }}
              <span v-if="currentModule.kind === 'update'">已选 {{ selectedFields.length }} 项</span>
            </div>
            <div v-if="currentModule.kind === 'create'" class="import-create-fields">
              <el-tag v-for="field in currentModule.fields" :key="field.field" effect="plain">{{ field.label }}</el-tag>
            </div>
            <el-checkbox-group v-else v-model="selectedFields" class="import-field-options">
              <el-checkbox v-for="field in currentModule.fields" :key="field.field" :value="field.field" border>
                {{ field.label }}
              </el-checkbox>
            </el-checkbox-group>
          </div>

          <el-alert
            v-if="currentModule.kind === 'update'"
            title="空白单元格表示不修改；只有填写 [清空] 才会清空允许为空的字段。"
            type="info"
            :closable="false"
            show-icon
          />

          <div class="import-step-row">
            <div class="import-step-title"><span>3</span>下载并填写模板</div>
            <el-button type="primary" :disabled="currentModule.kind === 'update' && !selectedFields.length" @click="downloadTemplate">
              <el-icon><Download /></el-icon>
              下载中文模板
            </el-button>
          </div>

          <div class="import-upload-block">
            <div class="import-step-title"><span>4</span>上传并预检查</div>
            <el-upload
              ref="uploadRef"
              drag
              action="#"
              accept=".xlsx"
              :auto-upload="false"
              :limit="1"
              :on-change="selectFile"
              :on-remove="removeFile"
            >
              <el-icon size="34"><UploadFilled /></el-icon>
              <div>拖拽 Excel 文件到此处，或点击选择文件</div>
            </el-upload>
          </div>

          <div class="import-actions">
            <el-button :disabled="!uploadFile" :loading="validating" @click="validateImport">
              <el-icon><Search /></el-icon>
              预检查
            </el-button>
            <el-button type="primary" :disabled="!preview?.valid" :loading="committing" @click="commitImport">
              <el-icon><CircleCheck /></el-icon>
              确认导入
            </el-button>
          </div>
        </template>

        <el-alert
          v-if="preview"
          :title="preview.valid ? '预检查通过，可以正式导入' : `发现 ${preview.errorCount} 个错误，请先修正文件`"
          :type="preview.valid ? 'success' : 'error'"
          show-icon
          :closable="false"
          class="section"
        />

        <div v-if="preview" class="stats-grid section">
          <div v-for="item in statCards" :key="item.key" class="stat-cell">
            <span>{{ item.label }}</span>
            <strong>{{ preview.summary?.[item.key] || 0 }}</strong>
          </div>
        </div>

        <div v-if="preview?.batchId" class="import-result-actions section">
          <el-button v-if="!preview.valid" @click="downloadFile(`/imports/${preview.batchId}/errors/download`, '导入错误清单.csv')">下载错误清单</el-button>
          <el-button @click="downloadFile(`/imports/${preview.batchId}/diff/download`, '导入差异.csv')">导出差异</el-button>
        </div>
      </section>

      <section class="panel">
        <div class="subsection-title">导入记录</div>
        <el-table v-loading="loadingRecords" :data="records" size="small" empty-text="暂无导入记录">
          <el-table-column prop="createdAt" label="时间" width="150">
            <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column prop="importType" label="内容" width="130">
            <template #default="{ row }">{{ typeLabel(row.importType) }}</template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="105">
            <template #default="{ row }"><el-tag effect="plain">{{ statusLabel(row.status) }}</el-tag></template>
          </el-table-column>
          <el-table-column label="结果" min-width="170">
            <template #default="{ row }">
              新增 {{ row.summary?.create || row.summary?.projects || 0 }} / 修改 {{ row.summary?.update || 0 }} / 跳过 {{ row.summary?.skip || 0 }} / 冲突 {{ row.summary?.conflict || 0 }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="260" fixed="right">
            <template #default="{ row }">
              <el-button text @click="openDetail(row.batchId)">详情</el-button>
              <el-button text @click="downloadFile(`/imports/${row.batchId}/diff/download`, '导入差异.csv')">差异</el-button>
              <el-button text @click="downloadFile(`/imports/${row.batchId}/original/download`, row.originalFileName || '原始文件.xlsx')">原文件</el-button>
              <el-button text :disabled="row.status !== 'committed' || row.importType === 'rollback'" @click="rollback(row)">回滚</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="pagination.total" class="pagination-row">
          <el-pagination v-model:current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total" layout="total, prev, pager, next" @current-change="loadRecords" />
        </div>
      </section>
    </div>

    <el-dialog v-model="detailVisible" title="导入详情" width="900px">
      <el-table :data="detail?.records || []" size="small" max-height="520">
        <el-table-column prop="rowNumber" label="行号" width="70" />
        <el-table-column prop="entityKey" label="定位信息" min-width="180" show-overflow-tooltip />
        <el-table-column label="操作" width="90">
          <template #default="{ row }">{{ operationLabel(row.operationType) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">{{ recordStatusLabel(row.status) }}</template>
        </el-table-column>
        <el-table-column label="字段变化" min-width="280">
          <template #default="{ row }">
            <div v-if="row.fields?.length" class="diff-list">
              <span v-for="field in row.fields" :key="field.fieldName">
                {{ detailFieldLabel(row.entityType, field.fieldName) }}：{{ displayValue(field.beforeValue) }} → {{ displayValue(field.afterValue) }}
              </span>
            </div>
            <span v-else class="muted">{{ row.message || '无字段变化' }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, markRaw, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Coin, DocumentChecked, EditPen, FolderAdd, User, UserFilled } from '@element-plus/icons-vue'
import { apiRequest, downloadFile } from '../../services/http'

const modules = ref([])
const activeType = ref('simple-projects')
const selections = ref({})
const uploadRef = ref(null)
const uploadFile = ref(null)
const preview = ref(null)
const validating = ref(false)
const committing = ref(false)
const loadingRecords = ref(false)
const records = ref([])
const pagination = ref({ page: 1, pageSize: 10, total: 0 })
const detailVisible = ref(false)
const detail = ref(null)

const icons = {
  'simple-projects': markRaw(FolderAdd),
  'project-field-update': markRaw(EditPen),
  people: markRaw(User),
  'project-participations': markRaw(UserFilled),
  checks: markRaw(DocumentChecked),
  reimbursements: markRaw(Coin),
}
const statCards = [
  { key: 'create', label: '新增' },
  { key: 'update', label: '修改' },
  { key: 'remove', label: '移除' },
  { key: 'skip', label: '跳过' },
  { key: 'error', label: '错误' },
  { key: 'conflict', label: '冲突' },
]
const typeLabels = {
  simple_projects: '新建项目',
  project_field_update: '项目基本信息',
  people_update: '人员信息',
  project_participations: '项目人员关系',
  check_record_update: '检查记录',
  reimbursement_update: '报销记录',
  standard_workbook: '旧版标准工作簿',
  rollback: '回滚记录',
}
const statusLabels = {
  validated: '已预检查',
  committed: '已导入',
  failed: '失败',
  rolled_back: '已回滚',
  rollback_partial: '部分回滚',
}
const operationLabels = { create: '新增', update: '修改', remove: '移除', skip: '跳过', restore: '恢复', conflict: '冲突', error: '错误' }
const recordStatusLabels = { planned: '待执行', applied: '已执行', skipped: '已跳过', failed: '失败', conflict: '冲突' }

const currentModule = computed(() => modules.value.find((item) => item.key === activeType.value))
const selectedFields = computed({
  get: () => selections.value[activeType.value] || [],
  set: (value) => { selections.value = { ...selections.value, [activeType.value]: value } },
})
const templateUrl = computed(() => {
  if (currentModule.value?.kind === 'create') return `/imports/templates/${activeType.value}/download`
  return `/imports/templates/${activeType.value}/download?fields=${encodeURIComponent(selectedFields.value.join(','))}`
})

function moduleIcon(key) {
  return icons[key] || EditPen
}
function selectModule(key) {
  activeType.value = key
  uploadFile.value = null
  preview.value = null
  uploadRef.value?.clearFiles()
}
function selectFile(file) {
  uploadFile.value = file.raw
  preview.value = null
}
function removeFile() {
  uploadFile.value = null
  preview.value = null
}
async function loadModules() {
  const response = await apiRequest('/imports/field-options')
  modules.value = response.data.modules || []
  const defaults = {}
  for (const module of modules.value) defaults[module.key] = [...(module.defaultFields || [])]
  selections.value = defaults
  if (!modules.value.some((item) => item.key === activeType.value)) activeType.value = modules.value[0]?.key || ''
}
async function downloadTemplate() {
  if (currentModule.value?.kind === 'update' && !selectedFields.value.length) {
    ElMessage.warning('请至少选择一个需要修改的字段')
    return
  }
  try {
    await downloadFile(templateUrl.value, `${currentModule.value?.title || '数据'}导入模板.xlsx`)
  } catch (error) {
    ElMessage.error(error.message)
  }
}
async function validateImport() {
  if (!uploadFile.value) return
  validating.value = true
  try {
    const body = new FormData()
    body.append('file', uploadFile.value)
    const response = await apiRequest(`/imports/${activeType.value}/validate`, { method: 'POST', body })
    preview.value = response.data
    ElMessage[response.data.valid ? 'success' : 'warning'](response.data.valid ? '预检查通过' : '预检查发现错误')
    await loadRecords()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    validating.value = false
  }
}
async function commitImport() {
  if (!preview.value?.batchId) return
  committing.value = true
  try {
    await apiRequest(`/imports/${preview.value.batchId}/commit`, { method: 'POST' })
    ElMessage.success('导入完成')
    preview.value = null
    uploadFile.value = null
    uploadRef.value?.clearFiles()
    await loadRecords()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    committing.value = false
  }
}
async function loadRecords() {
  loadingRecords.value = true
  try {
    const response = await apiRequest(`/imports?page=${pagination.value.page}&pageSize=${pagination.value.pageSize}`)
    records.value = response.data.map((row) => ({
      ...row,
      summary: typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary || {},
    }))
    pagination.value = response.pagination
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    loadingRecords.value = false
  }
}
async function openDetail(batchId) {
  try {
    const response = await apiRequest(`/imports/${batchId}`)
    detail.value = response.data
    detailVisible.value = true
  } catch (error) {
    ElMessage.error(error.message)
  }
}
async function rollback(row) {
  try {
    await ElMessageBox.confirm('系统只恢复仍保持导入后值的数据；被后续修改的内容会标记冲突并跳过。', '确认回滚', { type: 'warning' })
    const response = await apiRequest(`/imports/${row.batchId}/rollback`, { method: 'POST' })
    ElMessage.success(`回滚完成，恢复 ${response.data.restore || 0} 条，冲突 ${response.data.conflict || 0} 条`)
    await loadRecords()
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(error.message)
  }
}
function typeLabel(value) { return typeLabels[value] || value }
function statusLabel(value) { return statusLabels[value] || value }
function operationLabel(value) { return operationLabels[value] || value }
function recordStatusLabel(value) { return recordStatusLabels[value] || value }
function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '' }
function displayValue(value) { return value === null || value === undefined || value === '' ? '空' : value }
function detailFieldLabel(entityType, fieldName) {
  const moduleKey = { project: 'simple-projects', person: 'people', participation: 'project-participations', check_record: 'checks', reimbursement: 'reimbursements' }[entityType]
  const module = modules.value.find((item) => item.key === moduleKey)
  return [...(module?.fixedFields || []), ...(module?.fields || [])].find((item) => item.field === fieldName)?.label || fieldName
}

onMounted(async () => {
  await loadModules()
  await loadRecords()
})
</script>
