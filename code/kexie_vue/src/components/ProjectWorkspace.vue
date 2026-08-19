<template>
  <div v-loading="loading" class="project-workspace">
    <div class="workspace-back-row">
      <el-button text @click="router.push(backPath)"><el-icon><ArrowLeft /></el-icon>返回项目列表</el-button>
      <el-tag v-if="isReadOnly" type="info" effect="plain">负责人只读视图</el-tag>
    </div>

    <template v-if="data.project">
      <section class="project-summary-card">
        <div class="project-summary-main">
          <div class="summary-code-row">
            <span class="project-code-badge">{{ data.project.projectCode }}</span>
            <el-tag :type="statusType(data.project.status)" effect="dark">{{ statusLabel(data.project.status) }}</el-tag>
          </div>
          <h2>{{ data.project.title }}</h2>
          <p>{{ data.project.projectYear }} 年 · {{ data.project.projectGroup || '未分组' }} · {{ data.project.category || '未填写类别' }}</p>
        </div>
        <div class="project-summary-actions">
          <el-button v-if="canEdit" type="primary" @click="openProjectEditor"><el-icon><Edit /></el-icon>编辑项目信息</el-button>
        </div>
        <div class="project-metric-strip">
          <div><strong>{{ data.summary.participantCount }}</strong><span>参与人员</span></div>
          <div><strong>{{ data.summary.materialTaskCount }}</strong><span>材料子任务</span></div>
          <div><strong>{{ data.summary.submissionVersionCount }}</strong><span>提交版本</span></div>
          <div :class="{ danger: data.summary.exceptionCount }"><strong>{{ data.summary.exceptionCount }}</strong><span>异常/退回</span></div>
        </div>
      </section>

      <section class="workspace-section lifecycle-section">
        <div class="section-heading"><div><h3>项目生命周期</h3><p>从立项申请到正式项目与材料履约的关键进度</p></div></div>
        <div class="lifecycle-track">
          <div v-for="(step, index) in lifecycleSteps" :key="step.label" class="lifecycle-step" :class="step.state">
            <div class="step-index"><el-icon v-if="step.state === 'done'"><Check /></el-icon><span v-else>{{ index + 1 }}</span></div>
            <strong>{{ step.label }}</strong><span>{{ step.note }}</span>
          </div>
        </div>
      </section>

      <el-tabs v-model="activeTab" class="workspace-tabs">
        <el-tab-pane label="项目详情" name="details">
          <div class="detail-card-grid">
            <section class="workspace-section"><div class="section-heading"><div><h3>基本信息</h3><p>项目业务主数据</p></div></div><dl class="detail-list">
              <div v-for="item in basicDetails" :key="item.label"><dt>{{ item.label }}</dt><dd>{{ item.value || '未填写' }}</dd></div>
            </dl></section>
            <section class="workspace-section"><div class="section-heading"><div><h3>立项来源与流程</h3><p>申请批次、校内审核和学校结果</p></div></div><dl class="detail-list">
              <div v-for="item in sourceDetails" :key="item.label"><dt>{{ item.label }}</dt><dd>{{ item.value || '无历史记录' }}</dd></div>
            </dl></section>
          </div>
        </el-tab-pane>

        <el-tab-pane :label="`参与人员（${data.participations.length}）`" name="people">
          <section class="workspace-section">
            <div class="section-heading"><div><h3>项目团队</h3><p>负责人唯一；成员与指导教师的每次维护均留存前后快照</p></div><el-button v-if="canEdit" @click="openPeopleEditor">维护成员/导师</el-button></div>
            <el-alert v-if="canEdit" title="项目负责人不可在此更换；负责人变更需走审批流程。" type="warning" show-icon :closable="false" class="owner-change-alert" />
            <div class="people-card-grid">
              <article v-for="person in data.participations" :key="person.id" class="person-card">
                <div class="person-role" :class="person.role">{{ roleLabel(person.role) }}</div>
                <div><h4>{{ person.name }} <small>{{ person.identifier || '无编号' }}</small></h4><p>{{ person.organization || '未填写学院/单位' }}</p><p>{{ [person.phone, person.email, person.qq && `QQ ${person.qq}`].filter(Boolean).join(' · ') || '未填写联系方式' }}</p></div>
              </article>
            </div>
          </section>
        </el-tab-pane>

        <el-tab-pane :label="`材料与版本（${data.summary.submissionVersionCount}）`" name="materials">
          <section v-if="!data.materials.length" class="workspace-section"><el-empty description="当前项目暂无适用的材料任务" /></section>
          <section v-for="task in data.materials" :key="task.taskId" class="workspace-section material-task-card">
            <div class="section-heading"><div><h3>{{ task.taskName }}</h3><p>{{ task.taskDescription || '未填写任务说明' }} · 适用范围：{{ scopeLabel(task) }}</p></div><div><el-tag effect="plain">{{ task.taskStatus }}</el-tag><span class="deadline">截止 {{ formatDateTime(task.deadlineAt) }}</span></div></div>
            <el-collapse>
              <el-collapse-item v-for="category in task.categories" :key="category.categoryId" :name="category.categoryId">
                <template #title><div class="material-title"><strong>{{ category.categoryName }}</strong><el-tag size="small" :type="category.isRequired ? 'danger' : 'info'" effect="plain">{{ category.isRequired ? '必填' : '选填' }}</el-tag><span>{{ category.versions.length }} 个版本</span></div></template>
                <el-empty v-if="!category.versions.length" description="尚未提交" :image-size="56" />
                <div v-for="version in category.versions" :key="version.id" class="version-row">
                  <span class="version-number">V{{ version.version }}</span>
                  <div class="version-main"><strong>{{ version.submitterName || '未知提交人' }}</strong><span>{{ formatDateTime(version.submittedAt || version.createdAt) }}</span><p v-if="version.assigneeName">分配人：{{ version.assignerName || '-' }} · 受派人：{{ version.assigneeName }} · {{ formatDateTime(version.assignedAt) }}</p><p v-if="version.reviewerName">实际审核人：{{ version.reviewerName }} · {{ formatDateTime(version.reviewedAt) }}</p><p v-if="version.returnReason">退回原因：{{ version.returnReason }}</p></div>
                  <el-tag :type="reviewType(version.reviewStatus)" effect="plain">{{ reviewLabel(version.reviewStatus) }}</el-tag>
                  <div class="version-files"><el-tooltip v-for="file in version.files" :key="file.id" :disabled="!file.fileNameWarning" :content="file.fileNameWarning"><el-button link type="primary" @click="downloadMaterial(file)"><el-icon><Document /></el-icon>{{ file.originalName }}<span v-if="file.fileNameWarning"> ⚠</span></el-button></el-tooltip></div>
                </div>
              </el-collapse-item>
            </el-collapse>
          </section>
        </el-tab-pane>

        <el-tab-pane :label="`时间轴（${filteredTimeline.length}）`" name="timeline">
          <section class="workspace-section">
            <div class="section-heading timeline-heading"><div><h3>全流程时间轴</h3><p>事件来自审计、立项、导入、材料提交与审核记录</p></div><el-select v-model="eventFilter" style="width: 180px"><el-option label="全部事件" value="all" /><el-option label="项目变更" value="project" /><el-option label="立项流程" value="application" /><el-option label="人员关系" value="participation" /><el-option label="材料提交/审核" value="material" /><el-option label="数据导入" value="import" /></el-select></div>
            <el-timeline class="audit-timeline">
              <el-timeline-item v-for="event in filteredTimeline" :key="event.id" :timestamp="formatDateTime(event.occurredAt)" :type="timelineType(event.state)" :hollow="event.state === 'current'" placement="top">
                <article class="timeline-event" :class="event.state"><div class="timeline-event-head"><strong>{{ event.summary }}</strong><el-tag size="small" effect="plain">{{ categoryLabel(event.eventCategory) }}</el-tag></div><p>操作者：{{ event.actor || '历史记录未留存' }} · 来源：{{ event.sourceModule }}</p><div v-if="event.changes?.length" class="change-list"><span v-for="change in event.changes" :key="change.field">{{ fieldLabel(change.field) }}：{{ displayValue(change.before) }} → {{ displayValue(change.after) }}</span></div><small v-if="event.legacyDerived">由既有业务记录生成</small></article>
              </el-timeline-item>
            </el-timeline>
          </section>
        </el-tab-pane>
      </el-tabs>
    </template>

    <el-dialog v-model="projectDialog" title="分区编辑项目信息" width="760px">
      <el-form ref="projectFormRef" :model="projectForm" :rules="rules" label-position="top">
        <div class="form-grid"><el-form-item label="项目年度" prop="projectYear"><el-input-number v-model="projectForm.projectYear" :min="2000" :max="2100" style="width:100%" /></el-form-item><el-form-item label="项目组别"><el-input v-model.trim="projectForm.projectGroup" /></el-form-item><el-form-item label="项目编号" prop="projectCode"><el-input v-model.trim="projectForm.projectCode" /></el-form-item><el-form-item label="作品名称" prop="title"><el-input v-model.trim="projectForm.title" /></el-form-item><el-form-item label="项目类别"><el-input v-model.trim="projectForm.category" /></el-form-item><el-form-item label="立项日期"><el-date-picker v-model="projectForm.approvalDate" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item><el-form-item label="立项类型"><el-select v-model="projectForm.approvalType"><el-option label="首次立项" value="first" /><el-option label="补充立项" value="supplement" /></el-select></el-form-item><el-form-item label="立项批次"><el-input v-model.trim="projectForm.approvalBatch" /></el-form-item><el-form-item label="项目状态"><el-select v-model="projectForm.status"><el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item></div><el-form-item label="备注"><el-input v-model="projectForm.remark" type="textarea" :rows="3" maxlength="1000" show-word-limit /></el-form-item>
      </el-form><template #footer><el-button @click="projectDialog=false">取消</el-button><el-button type="primary" :loading="saving" @click="saveProject">保存并记录审计</el-button></template>
    </el-dialog>

    <el-dialog v-model="peopleDialog" title="维护项目成员与指导教师" width="720px"><el-alert title="负责人仅展示不可编辑；本次操作会记录完整关系前后快照。" type="info" show-icon :closable="false" /><el-form label-position="top" class="people-edit-form"><el-form-item label="项目负责人"><el-input :model-value="ownerDisplay" disabled /></el-form-item><el-form-item label="项目成员（学生）"><el-select v-model="peopleForm.memberPersonIds" multiple filterable style="width:100%"><el-option v-for="person in studentOptions" :key="person.id" :label="`${person.name}（${person.identifier || '无学号'}）`" :value="person.id" /></el-select></el-form-item><el-form-item label="指导教师"><el-select v-model="peopleForm.advisorPersonIds" multiple filterable style="width:100%"><el-option v-for="person in teacherOptions" :key="person.id" :label="`${person.name}（${person.identifier || '无工号'}）`" :value="person.id" /></el-select></el-form-item></el-form><template #footer><el-button @click="peopleDialog=false">取消</el-button><el-button type="primary" :loading="saving" @click="savePeople">保存关系并记录审计</el-button></template></el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { apiRequest, downloadFile } from '../services/http'
import { authStore } from '../stores/auth'

const route = useRoute(), router = useRouter()
const loading = ref(false), saving = ref(false), activeTab = ref('details'), eventFilter = ref('all')
const projectDialog = ref(false), peopleDialog = ref(false), projectFormRef = ref()
const data = reactive({ project: null, source: null, participations: [], materials: [], timeline: [], capabilities: {}, summary: {} })
const projectForm = reactive({}), peopleForm = reactive({ memberPersonIds: [], advisorPersonIds: [] })
const studentOptions = ref([]), teacherOptions = ref([])
const isAdmin = computed(() => authStore.state.user?.role === 'admin')
const canEdit = computed(() => Boolean(data.capabilities.canEditProject && isAdmin.value))
const isReadOnly = computed(() => !canEdit.value)
const backPath = computed(() => isAdmin.value ? '/admin/projects' : '/owner/projects')
const statusOptions = [{label:'草稿',value:'draft'},{label:'进行中',value:'active'},{label:'检查中',value:'checking'},{label:'已结项',value:'completed'},{label:'已归档',value:'archived'},{label:'已停止',value:'stopped'}]
const rules = { projectYear:[{required:true,message:'请选择项目年度'}], projectCode:[{required:true,message:'请输入项目编号'}], title:[{required:true,message:'请输入作品名称'}] }
const labels = { projectYear:'年度',projectGroup:'组别',projectCode:'项目编号',title:'作品名称',category:'项目类别',approvalDate:'立项日期',approvalType:'立项类型',approvalBatch:'立项批次',status:'项目状态',remark:'备注' }
const statusLabel = value => statusOptions.find(item=>item.value===value)?.label || value
const statusType = value => ({active:'success',checking:'warning',completed:'success',archived:'info',stopped:'danger'}[value] || 'info')
const roleLabel = value => ({owner:'项目负责人',member:'项目成员',advisor:'指导教师'}[value] || value)
const reviewLabel = value => ({pending:'待审核',approved:'已通过',returned:'已退回'}[value] || value)
const reviewType = value => ({pending:'warning',approved:'success',returned:'danger'}[value] || 'info')
const scopeLabel = task => task.scopeType==='year'?`${task.scopeYear} 年项目`:task.scopeType==='group'?`组别 ${task.scopeGroup}`:task.scopeType==='custom'?'指定项目':'全部项目'
const timelineType = value => ({completed:'success',current:'primary',exception:'danger'}[value] || 'info')
const categoryLabel = value => ({project:'项目',application:'立项',participation:'人员',material:'材料',import:'导入'}[value] || value)
const fieldLabel = value => labels[value] || value
const displayValue = value => value === null || value === undefined || value === '' ? '空' : String(value)
const formatDate = value => value ? new Date(value).toLocaleDateString('zh-CN') : ''
const formatDateTime = value => value ? new Date(value).toLocaleString('zh-CN',{hour12:false}) : '未记录'
const basicDetails = computed(() => [{label:'年度',value:data.project.projectYear},{label:'组别',value:data.project.projectGroup},{label:'项目编号',value:data.project.projectCode},{label:'作品名称',value:data.project.title},{label:'项目类别',value:data.project.category},{label:'立项日期',value:formatDate(data.project.approvalDate)},{label:'立项类型',value:data.project.approvalType==='supplement'?'补充立项':'首次立项'},{label:'立项批次',value:data.project.approvalBatch || data.source?.batchName},{label:'项目状态',value:statusLabel(data.project.status)},{label:'备注',value:data.project.remark}])
const sourceDetails = computed(() => [{label:'来源类型',value:data.source?.sourceType==='historical_official_list'?'历史正式名单':data.source?'在线立项申请':null},{label:'申请批次',value:data.source?.batchName},{label:'申请状态',value:data.source?.applicationStatus},{label:'提交时间',value:data.source?.submittedAt?formatDateTime(data.source.submittedAt):null},{label:'校内审核',value:data.source?.internalReviewedAt?[formatDateTime(data.source.internalReviewedAt),data.source.internalReviewReason].filter(Boolean).join(' · '):null},{label:'报送学校',value:data.source?.reportedAt?formatDateTime(data.source.reportedAt):null},{label:'学校结果',value:data.source?.schoolResultAt?[formatDateTime(data.source.schoolResultAt),data.source.schoolResultRemark].filter(Boolean).join(' · '):null},{label:'历史材料',value:data.source?.historicalMaterialStatus}])
const lifecycleSteps = computed(() => { const s=data.source; if(!s) return [{label:'项目记录',note:formatDate(data.project.createdAt),state:'done'},{label:'正式运行',note:statusLabel(data.project.status),state:['draft'].includes(data.project.status)?'current':'done'},{label:'材料履约',note:`${data.summary.submissionVersionCount||0} 个版本`,state:data.summary.exceptionCount?'exception':data.summary.submissionVersionCount?'done':'current'},{label:'结项归档',note:['completed','archived'].includes(data.project.status)?statusLabel(data.project.status):'尚未完成',state:['completed','archived'].includes(data.project.status)?'done':'pending'}]; return [{label:s.approvalRound==='supplement'?'补充立项':'首次立项',note:s.batchName,state:'done'},{label:'校内审核',note:formatDate(s.internalReviewedAt)||s.applicationStatus,state:s.internalReviewedAt?'done':'current'},{label:'报送学校',note:formatDate(s.reportedAt)||'待报送',state:s.reportedAt?'done':'pending'},{label:'学校结果',note:formatDate(s.schoolResultAt)||'待结果',state:s.schoolResultAt?'done':'pending'},{label:'正式项目',note:statusLabel(data.project.status),state:'done'}] })
const filteredTimeline = computed(() => eventFilter.value==='all'?data.timeline:data.timeline.filter(item=>item.eventCategory===eventFilter.value))
const ownerDisplay = computed(() => { const p=data.participations.find(item=>item.role==='owner'); return p?`${p.name}（${p.identifier||'无学号'}）`:'负责人关系缺失' })

async function load(){ loading.value=true; try{ Object.assign(data,(await apiRequest(`/projects/${route.params.id}/workspace`)).data) }catch(e){ ElMessage.error(e.message); router.replace(backPath.value) }finally{ loading.value=false } }
function openProjectEditor(){ Object.assign(projectForm,{...data.project,approvalDate:data.project.approvalDate?.slice?.(0,10)||data.project.approvalDate||''}); projectDialog.value=true }
async function saveProject(){ if(!(await projectFormRef.value?.validate().catch(()=>false)))return; saving.value=true; try{ await apiRequest(`/projects/${route.params.id}`,{method:'PUT',body:projectForm}); ElMessage.success('项目已更新，字段审计已记录'); projectDialog.value=false; await load() }catch(e){ElMessage.error(e.message)}finally{saving.value=false} }
async function loadPeopleOptions(){ if(studentOptions.value.length&&teacherOptions.value.length)return; const [students,teachers]=await Promise.all([apiRequest('/people?personType=student&pageSize=100'),apiRequest('/people?personType=teacher&pageSize=100')]); studentOptions.value=students.data; teacherOptions.value=teachers.data }
async function openPeopleEditor(){ try{await loadPeopleOptions(); peopleForm.memberPersonIds=data.participations.filter(p=>p.role==='member').map(p=>p.personId); peopleForm.advisorPersonIds=data.participations.filter(p=>p.role==='advisor').map(p=>p.personId); peopleDialog.value=true}catch(e){ElMessage.error(e.message)} }
async function savePeople(){ saving.value=true; try{await apiRequest(`/projects/${route.params.id}/participations`,{method:'PUT',body:peopleForm}); ElMessage.success('人员关系已更新并记录快照'); peopleDialog.value=false; await load()}catch(e){ElMessage.error(e.message)}finally{saving.value=false} }
async function downloadMaterial(file){ try{await downloadFile(`/projects/${route.params.id}/material-files/${file.id}/download`,file.originalName)}catch(e){ElMessage.error(e.message)} }
onMounted(load)
</script>
