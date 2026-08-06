<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">项目管理</h2>
        <p class="page-desc">支持后台维护，也可通过标准工作簿预检查后整批导入。</p>
      </div>
      <el-button type="primary" @click="openForm()"><el-icon><Plus /></el-icon>新增项目</el-button>
    </div>

    <div class="panel">
      <div class="toolbar">
        <div class="filters">
          <el-input v-model="filters.keyword" placeholder="搜索项目编号、作品名称、负责人" clearable @keyup.enter="loadProjects">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-input v-model="filters.year" placeholder="年度" clearable style="width: 120px" />
          <el-select v-model="filters.status" placeholder="项目状态" clearable style="width: 150px">
            <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <el-button :loading="loading" @click="loadProjects">查询</el-button>
        </div>
        <div class="toolbar-actions">
          <el-button @click="importVisible = true"><el-icon><Upload /></el-icon>标准工作簿导入</el-button>
          <el-button @click="downloadTemplate"><el-icon><Download /></el-icon>下载模板</el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="projects" class="desktop-table" style="width: 100%" empty-text="暂无项目数据">
        <el-table-column prop="projectYear" label="年度" width="90" />
        <el-table-column prop="projectGroup" label="组别" width="130" />
        <el-table-column prop="projectCode" label="项目编号" width="150" />
        <el-table-column prop="title" label="作品名称" min-width="230" show-overflow-tooltip />
        <el-table-column prop="owners" label="负责人" width="120" />
        <el-table-column prop="status" label="状态" width="110">
          <template #default="{ row }"><el-tag effect="plain">{{ statusLabel(row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }"><el-button text @click="openForm(row)">编辑</el-button></template>
        </el-table-column>
      </el-table>
      <div class="mobile-card-list">
        <el-empty v-if="!projects.length && !loading" class="empty-mobile" description="暂无项目数据" :image-size="72" />
        <article v-for="row in projects" :key="row.id" class="mobile-data-card">
          <div class="mobile-card-header">
            <div><p class="mobile-card-title">{{ row.title }}</p><div class="mobile-card-meta"><span>{{ row.projectCode }}</span><span>{{ row.projectYear }} 年</span></div></div>
            <el-tag effect="plain" size="small">{{ statusLabel(row.status) }}</el-tag>
          </div>
          <div class="mobile-card-body">
            <div><span class="mobile-field-label">组别</span><span class="mobile-field-value">{{ row.projectGroup || '未分组' }}</span></div>
            <div><span class="mobile-field-label">负责人</span><span class="mobile-field-value">{{ row.owners || '未填写' }}</span></div>
          </div>
          <div class="mobile-card-footer"><span class="muted">项目资料维护</span><el-button type="primary" plain @click="openForm(row)">编辑项目</el-button></div>
        </article>
      </div>
      <div class="pagination-row" v-if="pagination.total">
        <el-pagination v-model:current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total" layout="total, prev, pager, next" @current-change="loadProjects" />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑项目' : '新增项目'" width="620px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="项目年度" prop="projectYear"><el-input-number v-model="form.projectYear" :min="2000" :max="2100" style="width: 100%" /></el-form-item>
        <el-form-item label="组别"><el-input v-model.trim="form.projectGroup" /></el-form-item>
        <el-form-item label="项目编号" prop="projectCode"><el-input v-model.trim="form.projectCode" placeholder="例如 CX2026-001" /></el-form-item>
        <el-form-item label="作品名称" prop="title"><el-input v-model.trim="form.title" /></el-form-item>
        <el-form-item label="项目类别"><el-input v-model.trim="form.category" /></el-form-item>
        <el-form-item label="立项日期"><el-date-picker v-model="form.approvalDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="立项类型"><el-select v-model="form.approvalType" style="width: 100%"><el-option label="首次立项" value="first" /><el-option label="补充立项" value="supplement" /></el-select></el-form-item>
        <el-form-item label="项目状态"><el-select v-model="form.status" style="width: 100%"><el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveProject">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="importVisible" title="标准工作簿导入" width="700px" @closed="resetImport">
      <el-alert title="先校验、不立即写库；校验全部通过后再确认导入。" type="info" show-icon :closable="false" />
      <el-upload class="section" drag action="#" accept=".xlsx" :auto-upload="false" :limit="1" :on-change="selectImportFile" :on-remove="removeImportFile">
        <el-icon size="34"><UploadFilled /></el-icon><div>拖拽标准 .xlsx 工作簿到此处，或点击选择</div>
      </el-upload>
      <div v-if="importResult" class="section">
        <el-alert :title="importResult.valid ? '全部数据校验通过，可以正式导入' : `发现 ${importResult.errorCount} 个错误，请下载清单修正`" :type="importResult.valid ? 'success' : 'error'" show-icon :closable="false" />
        <el-table :data="importResult.sheets" size="small" class="section">
          <el-table-column prop="name" label="工作表" /><el-table-column prop="totalRows" label="总行数" width="90" /><el-table-column prop="validRows" label="可导入" width="90" /><el-table-column prop="errorRows" label="错误行" width="90" />
        </el-table>
      </div>
      <el-form v-if="importResult?.valid" label-width="90px"><el-form-item label="导入模式"><el-radio-group v-model="importMode"><el-radio value="create_only">仅新增</el-radio><el-radio value="upsert">更新已有</el-radio></el-radio-group></el-form-item></el-form>
      <template #footer>
        <el-button v-if="importResult && !importResult.valid" @click="downloadErrors">下载错误清单</el-button>
        <el-button :disabled="!importFile" :loading="validating" @click="validateImport">预检查</el-button>
        <el-button type="primary" :disabled="!importResult?.valid" :loading="committing" @click="commitImport">确认导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiRequest, downloadFile } from '../../services/http'

const statusOptions = [
  { label: '草稿', value: 'draft' }, { label: '进行中', value: 'active' }, { label: '检查中', value: 'checking' },
  { label: '已结项', value: 'completed' }, { label: '已归档', value: 'archived' }, { label: '已停止', value: 'stopped' },
]
const projects = ref([])
const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const formRef = ref()
const filters = reactive({ keyword: '', year: '', status: '' })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })
const form = reactive({ id: null, projectYear: new Date().getFullYear(), projectGroup: '', projectCode: '', title: '', category: '', approvalDate: '', approvalType: 'first', status: 'active', remark: '' })
const rules = { projectYear: [{ required: true, message: '请选择项目年度' }], projectCode: [{ required: true, message: '请输入项目编号', trigger: 'blur' }], title: [{ required: true, message: '请输入作品名称', trigger: 'blur' }] }
const importVisible = ref(false)
const importFile = ref(null)
const importResult = ref(null)
const importMode = ref('create_only')
const validating = ref(false)
const committing = ref(false)

const statusLabel = (value) => statusOptions.find((item) => item.value === value)?.label || value
function queryString() { const p = new URLSearchParams({ page: pagination.page, pageSize: pagination.pageSize }); Object.entries(filters).forEach(([k, v]) => v && p.set(k, v)); return p }
async function loadProjects() { loading.value = true; try { const response = await apiRequest(`/projects?${queryString()}`); projects.value = response.data; Object.assign(pagination, response.pagination) } catch (e) { ElMessage.error(e.message) } finally { loading.value = false } }
function openForm(row) { Object.assign(form, row ? { ...row, id: row.id, approvalDate: row.approvalDate?.slice?.(0, 10) || row.approvalDate || '' } : { id: null, projectYear: new Date().getFullYear(), projectGroup: '', projectCode: '', title: '', category: '', approvalDate: '', approvalType: 'first', status: 'active', remark: '' }); dialogVisible.value = true }
async function saveProject() { if (!(await formRef.value?.validate().catch(() => false))) return; saving.value = true; try { await apiRequest(form.id ? `/projects/${form.id}` : '/projects', { method: form.id ? 'PUT' : 'POST', body: form }); ElMessage.success('项目已保存'); dialogVisible.value = false; await loadProjects() } catch (e) { ElMessage.error(e.message) } finally { saving.value = false } }
function selectImportFile(file) { importFile.value = file.raw; importResult.value = null }
function removeImportFile() { importFile.value = null; importResult.value = null }
async function validateImport() { if (!importFile.value) return; validating.value = true; try { const body = new FormData(); body.append('file', importFile.value); const response = await apiRequest('/imports/standard-workbook/validate', { method: 'POST', body }); importResult.value = response.data; ElMessage[response.data.valid ? 'success' : 'warning'](response.data.valid ? '校验通过' : '校验发现错误') } catch (e) { ElMessage.error(e.message) } finally { validating.value = false } }
async function commitImport() { committing.value = true; try { await apiRequest(`/imports/${importResult.value.batchId}/commit`, { method: 'POST', body: { mode: importMode.value } }); ElMessage.success('数据导入完成'); importVisible.value = false; await loadProjects() } catch (e) { ElMessage.error(e.message) } finally { committing.value = false } }
async function downloadErrors() { try { await downloadFile(`/imports/${importResult.value.batchId}/errors/download`, '导入错误清单.csv') } catch (e) { ElMessage.error(e.message) } }
async function downloadTemplate() { try { await downloadFile('/import-templates/standard-workbook/download', '科研项目数据标准导入模板.xlsx') } catch (e) { ElMessage.error(e.message) } }
function resetImport() { importFile.value = null; importResult.value = null; importMode.value = 'create_only' }
onMounted(loadProjects)
</script>
