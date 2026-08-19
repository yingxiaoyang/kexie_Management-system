<template>
  <div>
    <div class="page-header"><div><h2 class="page-title">我的立项申请</h2><p class="page-desc">填写申请、提交完整材料并查看校内材料合格性审核与学校最终结果。</p></div><div class="page-actions"><el-button :loading="loading" @click="loadAll"><el-icon><Refresh /></el-icon>刷新</el-button></div></div>
    <el-alert title="校内审核仅表示材料是否合格，不代表学校批准立项。学校通过后系统才会建立正式项目。" type="info" show-icon :closable="false" />

    <section class="section">
      <div class="section-heading"><div><h3>当前开放批次</h3><p>同一时间只能有一份进行中的申请；已是正式项目负责人时不能再申请。</p></div></div>
      <div class="application-card-grid">
        <el-empty v-if="!openBatches.length && !loading" description="当前没有开放的申请批次" />
        <article v-for="batch in openBatches" :key="batch.id" class="application-batch-card">
          <div><el-tag :type="batch.approvalRound === 'supplement' ? 'warning' : 'success'">{{ roundLabel(batch.approvalRound) }}</el-tag><h3>{{ batch.batchName }}</h3><p>{{ batch.applicationYear }} 年 · 截止 {{ formatTime(batch.deadlineAt) }}</p></div>
          <el-button type="primary" :disabled="Boolean(batch.applied) || hasActive" @click="openEditor(null, batch.id)">{{ batch.applied ? '已申请' : '开始申请' }}</el-button>
        </article>
      </div>
    </section>

    <section class="panel section">
      <div class="toolbar"><div><strong>申请记录</strong><p class="page-desc">每次重交形成新版本，旧材料不会被覆盖。</p></div></div>
      <el-table v-loading="loading" :data="applications" class="desktop-table" empty-text="暂无申请记录">
        <el-table-column prop="batchName" label="批次" min-width="190" />
        <el-table-column prop="applicationYear" label="年度" width="80" />
        <el-table-column prop="approvalRound" label="节点" width="100"><template #default="{ row }">{{ roundLabel(row.approvalRound) }}</template></el-table-column>
        <el-table-column prop="submissionVersion" label="提交版本" width="100"><template #default="{ row }">V{{ row.submissionVersion || 0 }}</template></el-table-column>
        <el-table-column prop="status" label="状态" width="120"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="审核/结果" min-width="220"><template #default="{ row }"><span v-if="row.internalReviewReason">{{ row.internalReviewReason }}</span><span v-else-if="row.schoolResultRemark">{{ row.schoolResultRemark }}</span><span v-else class="muted">—</span></template></el-table-column>
        <el-table-column label="操作" width="245" fixed="right"><template #default="{ row }"><el-button text @click="showMaterials(row)">版本记录</el-button><el-button v-if="['draft','returned'].includes(row.status)" text type="primary" @click="openEditor(row)">编辑提交</el-button><el-button v-if="['draft','returned','submitted','eligible'].includes(row.status)" text type="danger" @click="withdraw(row)">撤回</el-button></template></el-table-column>
      </el-table>
      <div class="mobile-card-list"><article v-for="row in applications" :key="row.id" class="mobile-data-card"><div class="mobile-card-header"><div><p class="mobile-card-title">{{ row.batchName }}</p><p class="mobile-card-meta">{{ row.applicationYear }} 年 · {{ roundLabel(row.approvalRound) }}</p></div><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></div><div class="mobile-card-body"><div><span class="mobile-field-label">提交版本</span><span class="mobile-field-value">V{{ row.submissionVersion || 0 }}</span></div><div><span class="mobile-field-label">截止时间</span><span class="mobile-field-value">{{ formatTime(row.deadlineAt) }}</span></div></div><div class="mobile-card-footer"><el-button @click="showMaterials(row)">版本记录</el-button><el-button v-if="['draft','returned'].includes(row.status)" type="primary" @click="openEditor(row)">编辑提交</el-button></div></article></div>
    </section>

    <el-dialog v-model="editorVisible" :title="editing?.id ? '编辑并提交申请' : '新建立项申请'" width="760px" destroy-on-close>
      <el-alert v-if="editing?.status === 'returned'" :title="`退回原因：${editing.internalReviewReason || '请按要求重新提交'}`" type="warning" show-icon :closable="false" />
      <el-form ref="editorRef" :model="formData" label-position="top" class="section">
        <el-form-item v-for="field in batchDetail?.applicationSchema || []" :key="field.key" :label="field.label" :required="field.required">
          <el-input v-if="field.type === 'textarea'" v-model="formData[field.key]" type="textarea" :rows="4" maxlength="4000" show-word-limit />
          <el-input-number v-else-if="field.type === 'number'" v-model="formData[field.key]" style="width:100%" />
          <el-date-picker v-else-if="field.type === 'date'" v-model="formData[field.key]" value-format="YYYY-MM-DD" style="width:100%" />
          <el-select v-else-if="field.type === 'select'" v-model="formData[field.key]" style="width:100%"><el-option v-for="option in field.options" :key="option" :value="option" /></el-select>
          <el-input v-else v-model="formData[field.key]" maxlength="500" />
        </el-form-item>
        <el-divider content-position="left">本次提交材料</el-divider>
        <el-alert v-if="editing?.id" title="重新提交时，请为所有必交项选择本次的新文件；历史版本仍可在版本记录中查看。" type="info" :closable="false" />
        <div v-for="requirement in batchDetail?.materialRequirements || []" :key="requirement.id" class="application-upload-row">
          <div><strong>{{ requirement.name }} <span v-if="requirement.required" class="required-mark">*</span></strong><p>{{ requirement.description || `允许 ${asArray(requirement.allowedExtensions).join('、')}，最大 ${requirement.maxFileMb}MB` }}</p><el-button v-if="requirement.templateOriginalName" text type="primary" @click="downloadTemplate(requirement)">下载模板：{{ requirement.templateOriginalName }}</el-button></div>
          <input type="file" :accept="asArray(requirement.allowedExtensions).map(x => `.${x}`).join(',')" @change="selectFile(requirement.id, $event)" />
        </div>
      </el-form>
      <template #footer><el-button @click="editorVisible=false">取消</el-button><el-button :loading="saving" @click="save(false)">仅保存</el-button><el-button type="primary" :loading="saving" @click="save(true)">保存材料并提交审核</el-button></template>
    </el-dialog>

    <el-dialog v-model="materialsVisible" title="材料版本与审核记录" width="820px">
      <el-table v-loading="materialsLoading" :data="materialFiles" empty-text="暂无材料版本"><el-table-column prop="submissionVersion" label="提交版本" width="90"><template #default="{row}">V{{ row.submissionVersion }}</template></el-table-column><el-table-column prop="fileVersion" label="文件版本" width="90"><template #default="{row}">#{{ row.fileVersion }}</template></el-table-column><el-table-column prop="originalName" label="原文件名" min-width="210" /><el-table-column prop="sha256" label="SHA-256" min-width="170" show-overflow-tooltip /><el-table-column prop="reviewResult" label="材料审核" width="100"><template #default="{row}">{{ row.reviewResult ? statusLabel(row.reviewResult) : '待审/未提交' }}</template></el-table-column><el-table-column label="操作" width="80"><template #default="{row}"><el-button text @click="downloadMaterial(row)">下载</el-button></template></el-table-column></el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiRequest, downloadFile } from '../../services/http'

const loading = ref(false), saving = ref(false), applications = ref([]), openBatches = ref([])
const editorVisible = ref(false), editing = ref(null), batchDetail = ref(null), editorRef = ref()
const formData = reactive({}), selectedFiles = new Map()
const materialsVisible = ref(false), materialsLoading = ref(false), materialFiles = ref([]), materialApplication = ref(null)
const activeStatuses = new Set(['draft','submitted','returned','eligible','frozen','school_approved'])
const hasActive = computed(() => applications.value.some(item => activeStatuses.has(item.status)))
const asArray = value => Array.isArray(value) ? value : JSON.parse(value || '[]')
const roundLabel = value => value === 'first' ? '首次立项' : '补充立项'
const statusLabel = value => ({ draft:'草稿',submitted:'待材料合格性审核',returned:'材料已退回',eligible:'材料合格',frozen:'已冻结报送学校',school_approved:'学校通过，待转项目',school_rejected:'学校未通过',withdrawn:'已撤回',converted:'学校通过，已建立项目' }[value] || value)
const statusType = value => ({ draft:'info',submitted:'warning',returned:'danger',eligible:'success',frozen:'warning',school_approved:'success',school_rejected:'danger',withdrawn:'info',converted:'success' }[value] || 'info')
const formatTime = value => value ? new Date(value).toLocaleString('zh-CN', { hour12:false }) : '未设置'

async function loadAll() { loading.value=true; try { const [mine, batches] = await Promise.all([apiRequest('/applications/mine'), apiRequest('/applications/batches/open')]); applications.value=mine.data; openBatches.value=batches.data } catch(e){ ElMessage.error(e.message) } finally { loading.value=false } }
async function openEditor(row, batchId) { editing.value=row; batchDetail.value=(await apiRequest(`/applications/batches/${batchId || row.batchId}`)).data; Object.keys(formData).forEach(key=>delete formData[key]); Object.assign(formData, row?.applicationData || {}); selectedFiles.clear(); editorVisible.value=true }
function selectFile(id, event) { const file=event.target.files?.[0]; if(file) selectedFiles.set(Number(id), file) }
async function save(submit) {
  const missingField=(batchDetail.value.applicationSchema||[]).find(field=>field.required && (formData[field.key]===null || formData[field.key]===undefined || formData[field.key]===''))
  if(missingField) return ElMessage.warning(`请填写${missingField.label}`)
  saving.value=true
  try {
    let id=editing.value?.id
    if(id) await apiRequest(`/applications/${id}`,{method:'PUT',body:{applicationData:{...formData}}})
    else { id=(await apiRequest('/applications',{method:'POST',body:{batchId:batchDetail.value.id,applicationData:{...formData}}})).data.id; editing.value={id,status:'draft',batchId:batchDetail.value.id} }
    for(const requirement of batchDetail.value.materialRequirements||[]) { const file=selectedFiles.get(Number(requirement.id)); if(!file) continue; const body=new FormData(); body.append('file',file); await apiRequest(`/applications/${id}/materials/${requirement.id}`,{method:'POST',body}) }
    if(submit) await apiRequest(`/applications/${id}/submit`,{method:'POST'})
    ElMessage.success(submit?'申请已提交材料合格性审核':'草稿已保存')
    editorVisible.value=false; await loadAll()
  } catch(e){ ElMessage.error(e.message) } finally { saving.value=false }
}
async function showMaterials(row){ materialApplication.value=row; materialsVisible.value=true; materialsLoading.value=true; try{ materialFiles.value=(await apiRequest(`/applications/${row.id}/materials`)).data.files }catch(e){ElMessage.error(e.message)}finally{materialsLoading.value=false} }
async function downloadMaterial(file){ try{await downloadFile(`/applications/${materialApplication.value.id}/materials/${file.id}/download`,file.originalName)}catch(e){ElMessage.error(e.message)} }
async function downloadTemplate(requirement){ try{await downloadFile(`/applications/batches/${batchDetail.value.id}/requirements/${requirement.id}/template/download`,requirement.templateOriginalName)}catch(e){ElMessage.error(e.message)} }
async function withdraw(row){ try{const {value}=await ElMessageBox.prompt('请填写撤回原因（可简述）','撤回申请',{inputType:'textarea'});await apiRequest(`/applications/${row.id}/withdraw`,{method:'POST',body:{reason:value}});ElMessage.success('申请已撤回');loadAll()}catch(e){if(e!=='cancel')ElMessage.error(e.message||'撤回失败')} }
onMounted(loadAll)
</script>
