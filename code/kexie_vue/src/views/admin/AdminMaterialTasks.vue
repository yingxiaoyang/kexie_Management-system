<template>
  <div>
    <div class="page-header">
      <div><h2 class="page-title">材料任务</h2><p class="page-desc">创建统筹任务，并为每个子文件任务分别设置格式、大小和模板。</p></div>
      <div class="page-actions"><el-button type="primary" @click="openCreate"><el-icon><Plus /></el-icon>新建任务</el-button></div>
    </div>

    <section class="summary-strip section">
      <div v-for="item in summaries" :key="item.label" class="summary-item"><p class="summary-value">{{ item.value }}</p><p class="summary-label">{{ item.label }}</p></div>
    </section>

    <div class="panel">
      <div class="toolbar"><div class="filters">
        <el-input v-model="filters.keyword" placeholder="搜索任务名称" clearable @keyup.enter="searchTasks"><template #prefix><el-icon><Search /></el-icon></template></el-input>
        <el-select v-model="filters.status" placeholder="任务状态" clearable style="width:150px" @change="searchTasks"><el-option label="草稿" value="draft" /><el-option label="收集中" value="published" /><el-option label="已关闭" value="closed" /></el-select>
        <el-button :loading="loading" @click="searchTasks">查询</el-button>
      </div></div>

      <el-table v-loading="loading" :data="tasks" class="desktop-table" style="width:100%" empty-text="暂无材料任务">
        <el-table-column label="统筹任务" min-width="180"><template #default="{ row }"><el-button text type="primary" class="task-name-link" @click="openEdit(row)">{{ row.taskName }}</el-button><div><el-tag v-if="row.taskType==='project_change'" type="warning" size="small" effect="plain">项目信息变更</el-tag></div></template></el-table-column>
        <el-table-column prop="scopeLabel" label="适用范围" width="170" />
        <el-table-column prop="categoryNames" label="子文件任务" min-width="220" show-overflow-tooltip />
        <el-table-column label="模板" width="90"><template #default="{ row }"><el-tag v-if="Number(row.templateCount)" type="success" effect="plain">{{ row.templateCount }} 个</el-tag><span v-else class="muted">无</span></template></el-table-column>
        <el-table-column prop="deadlineAt" label="截止时间" width="180"><template #default="{ row }">{{ formatTime(row.deadlineAt) }}</template></el-table-column>
        <el-table-column prop="status" label="状态" width="100"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="提交 / 待审核" width="120"><template #default="{ row }">{{ row.submissionCount }} / <strong :class="{ 'danger-text': row.pendingCount }">{{ row.pendingCount }}</strong></template></el-table-column>
        <el-table-column label="操作" width="220" fixed="right"><template #default="{ row }">
          <el-button text @click="openEdit(row)">{{ row.editable ? '编辑' : '查看' }}</el-button>
          <el-button v-if="row.status === 'draft'" text type="success" @click="setStatus(row,'published')">发布</el-button>
          <el-button v-if="row.status === 'published'" text @click="setStatus(row,'closed')">关闭</el-button>
          <el-button v-if="row.status === 'closed'" text type="primary" @click="setStatus(row,'published')">重新开放</el-button>
        </template></el-table-column>
      </el-table>

      <div class="mobile-card-list">
        <el-empty v-if="!tasks.length && !loading" class="empty-mobile" description="暂无材料任务" :image-size="72" />
        <article v-for="row in tasks" :key="row.id" class="mobile-data-card">
          <div class="mobile-card-header"><div><p class="mobile-card-title">{{ row.taskName }}</p><div class="mobile-card-meta"><span>{{ row.scopeLabel }}</span></div></div><el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag></div>
          <div class="mobile-card-body"><div style="grid-column:1/-1"><span class="mobile-field-label">子文件任务</span><span class="mobile-field-value">{{ row.categoryNames || '未配置' }}</span></div><div><span class="mobile-field-label">截止时间</span><span class="mobile-field-value">{{ formatTime(row.deadlineAt) }}</span></div><div><span class="mobile-field-label">提交 / 待审核</span><span class="mobile-field-value">{{ row.submissionCount }} / {{ row.pendingCount }}</span></div></div>
          <div class="mobile-card-footer"><el-button @click="openEdit(row)">{{ row.editable ? '打开编辑' : '查看详情' }}</el-button><el-button v-if="row.status==='draft'" type="success" @click="setStatus(row,'published')">发布</el-button><el-button v-if="row.status==='published'" @click="setStatus(row,'closed')">关闭</el-button><el-button v-if="row.status==='closed'" type="primary" @click="setStatus(row,'published')">重新开放</el-button></div>
        </article>
      </div>
      <div v-if="pagination.total" class="pagination-row"><el-pagination v-model:current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total" layout="total, prev, pager, next" @current-change="loadTasks" /></div>
    </div>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="980px" class="material-task-dialog" @closed="resetForm">
      <el-alert v-if="form.id && !form.editable" class="section" title="该任务已有提交记录或已经关闭，当前为只读查看。需要调整收集要求时请新建任务，避免影响历史审核记录。" type="warning" :closable="false" show-icon />
      <el-alert v-else-if="form.id && form.status === 'published'" class="section" title="该任务已经发布，但目前还没有任何提交，仍可修改。收到首条提交后将自动变为只读。" type="info" :closable="false" show-icon />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="112px" :disabled="!form.editable">
        <el-form-item label="任务类型"><el-radio-group v-model="form.taskType" :disabled="Boolean(form.id)"><el-radio value="standard">普通材料</el-radio><el-radio value="project_change">项目信息变更</el-radio></el-radio-group></el-form-item>
        <el-form-item label="统筹任务名称" prop="taskName"><el-input v-model.trim="form.taskName" placeholder="例如：2026 年结项材料" /></el-form-item>
        <el-form-item v-if="form.taskType==='project_change'" label="检查阶段" required><el-radio-group v-model="form.changePhase"><el-radio value="midterm">中期检查</el-radio><el-radio value="stage">阶段检查</el-radio></el-radio-group></el-form-item>
        <el-form-item v-if="form.taskType==='project_change'" label="允许变更" required><div><el-checkbox v-model="form.changeScope.members">项目成员</el-checkbox><el-checkbox v-model="form.changeScope.advisors">指导教师</el-checkbox><el-checkbox v-model="form.changeScope.owner">项目负责人</el-checkbox><div class="el-upload__tip">负责人必须上传变更证明；结构化方案会与每次材料版本冻结绑定。</div></div></el-form-item>
        <el-form-item label="任务说明"><el-input v-model="form.taskDescription" type="textarea" :rows="3" placeholder="向负责人说明总体要求和注意事项" /></el-form-item>
        <el-form-item label="适用范围" prop="projectScopeType"><el-select v-model="form.projectScopeType" style="width:100%"><el-option label="全部项目" value="all" /><el-option label="指定年度" value="year" /><el-option label="指定组别" value="group" /><el-option label="指定项目" value="custom" /></el-select></el-form-item>
        <el-form-item v-if="form.projectScopeType==='year'" label="项目年度" prop="projectYear"><el-select v-model="form.projectYear" filterable allow-create style="width:100%" placeholder="选择现有年度或输入年度"><el-option v-for="year in taskOptions.years" :key="year" :label="`${year} 年（${projectCountByYear(year)} 个项目）`" :value="year" /></el-select></el-form-item>
        <el-form-item v-if="form.projectScopeType==='group'" label="项目组别" prop="projectGroup"><el-select v-model="form.projectGroup" filterable style="width:100%" placeholder="从现有项目组别中选择"><el-option v-for="group in taskOptions.groups" :key="group" :label="`${group}（${projectCountByGroup(group)} 个项目）`" :value="group" /></el-select></el-form-item>
        <el-form-item v-if="form.projectScopeType==='custom'" label="指定项目" prop="projectIds"><el-select v-model="form.projectIds" multiple collapse-tags filterable style="width:100%" placeholder="选择一个或多个项目"><el-option v-for="project in taskOptions.projects" :key="project.id" :label="`${project.projectCode}｜${project.title}｜${project.projectYear}年｜${project.projectGroup || '未分组'}`" :value="project.id" /></el-select></el-form-item>
        <el-form-item label="范围说明"><div class="task-scope-hint"><el-icon><InfoFilled /></el-icon>{{ scopeHint }}</div></el-form-item>

        <el-form-item label="子文件任务" required>
          <div class="file-task-editor">
            <div class="file-task-editor-head"><div><strong>文件任务清单</strong><p>格式、大小和模板均按子任务单独设置；每次提交仍只接收 1 个文件。</p></div><el-button type="primary" plain @click="addFileTask"><el-icon><Plus /></el-icon>添加子任务</el-button></div>
            <section v-for="(item,index) in form.fileTasks" :key="item.key" class="file-task-config-card">
              <header class="file-task-config-head"><span class="file-task-order">{{ index+1 }}</span><el-input v-model.trim="item.categoryName" maxlength="120" placeholder="子任务名称，例如：项目申报书" /><el-checkbox v-model="item.isRequired">必交</el-checkbox><div class="file-task-actions"><el-button circle :disabled="index===0" aria-label="上移" @click="moveFileTask(index,-1)"><el-icon><ArrowUp /></el-icon></el-button><el-button circle :disabled="index===form.fileTasks.length-1" aria-label="下移" @click="moveFileTask(index,1)"><el-icon><ArrowDown /></el-icon></el-button><el-button circle type="danger" plain :disabled="form.fileTasks.length===1" aria-label="删除" @click="removeFileTask(index)"><el-icon><Delete /></el-icon></el-button></div></header>
              <el-input v-model.trim="item.taskDescription" maxlength="1000" placeholder="该子任务的提交说明（可选）" />
              <div class="file-task-rule-grid">
                <div class="file-task-rule-block"><span class="file-task-rule-label">允许格式</span><el-checkbox-group v-model="item.allowedExtensions"><el-checkbox v-for="ext in extensionOptions" :key="ext" :value="ext">{{ ext.toUpperCase() }}</el-checkbox></el-checkbox-group></div>
                <div class="file-task-rule-block"><span class="file-task-rule-label">单文件大小</span><div class="inline-fields"><el-input-number v-model="item.maxFileMb" :min="1" :max="50" /><span>MB</span></div></div>
                <div class="file-task-rule-block"><span class="file-task-rule-label">任务模板</span><el-switch v-model="item.hasTemplate" active-text="提供" inactive-text="不提供" /><el-tag v-if="item.templateCount" type="success" effect="plain">已有 {{ item.templateCount }} 个</el-tag></div>
              </div>
              <div v-if="item.hasTemplate && item.templateFiles.length" class="existing-template-list"><span>现有模板：</span><el-tag v-for="file in item.templateFiles" :key="file.id" effect="plain">{{ file.originalName }}</el-tag></div>
              <el-upload v-if="item.hasTemplate" action="#" :auto-upload="false" multiple :limit="10" :accept="templateAccept" :on-change="(_file,files)=>onChildTemplateChange(item,files)" :on-remove="(_file,files)=>onChildTemplateChange(item,files)"><el-button><el-icon><Upload /></el-icon>选择该子任务模板</el-button><template #tip><div class="el-upload__tip">可追加多个模板文件；模板文件格式可以与负责人最终提交格式不同。关闭“提供”后负责人将看不到模板。</div></template></el-upload>
            </section>
          </div>
        </el-form-item>
        <el-form-item label="截止时间"><el-date-picker v-model="form.deadlineAt" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" style="width:100%" /></el-form-item>
        <el-form-item label="项目累计限制"><div class="inline-fields"><el-input-number v-model="form.maxTaskProjectMb" :min="maxChildFileMb" :max="500" /><span>MB / 项目 / 统筹任务（含历史重交版本）</span></div></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible=false">{{ form.editable ? '取消' : '关闭' }}</el-button><template v-if="form.editable"><el-button v-if="form.id" type="primary" :loading="saving" @click="saveTask(form.status)">保存修改</el-button><template v-else><el-button :loading="saving" @click="saveTask('draft')">保存草稿</el-button><el-button type="primary" :loading="saving" @click="saveTask('published')">创建并发布</el-button></template></template></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiRequest } from '../../services/http'

const extensionOptions=['pdf','doc','docx','xls','xlsx','ppt','pptx','jpg','jpeg','png','zip']
const templateAccept=extensionOptions.map(ext=>`.${ext}`).join(',')
const tasks=ref([]); const loading=ref(false); const saving=ref(false); const dialogVisible=ref(false); const formRef=ref()
const filters=reactive({keyword:'',status:''}); const pagination=reactive({page:1,pageSize:20,total:0}); const taskOptions=reactive({years:[],groups:[],projects:[]})
let fileTaskKey=0
const makeFileTask=(source={})=>({key:++fileTaskKey,id:source.id||null,categoryName:source.categoryName||'',taskDescription:source.taskDescription||'',allowedExtensions:Array.isArray(source.allowedExtensions)?[...source.allowedExtensions]:[...extensionOptions],maxFileMb:Number(source.maxFileMb||50),hasTemplate:Boolean(source.hasTemplate||Number(source.templateCount)),templateCount:Number(source.templateCount||0),templateFiles:Array.isArray(source.templateFiles)?[...source.templateFiles]:[],newTemplateFiles:[],isRequired:source.isRequired!==false})
const newForm=()=>({id:null,editable:true,status:'draft',taskType:'standard',changePhase:'midterm',changeScope:{members:false,advisors:false,owner:false},taskName:'',taskDescription:'',projectScopeType:'all',projectYear:new Date().getFullYear(),projectGroup:'',projectIds:[],fileTasks:[makeFileTask({categoryName:'变更证明',isRequired:true})],deadlineAt:'',maxTaskProjectMb:500})
const form=reactive(newForm())
const rules={taskName:[{required:true,message:'请输入任务名称',trigger:'blur'}],projectScopeType:[{required:true,message:'请选择范围'}],projectYear:[{validator:(_r,v,c)=>form.projectScopeType!=='year'||v?c():c(new Error('请选择年度'))}],projectGroup:[{validator:(_r,v,c)=>form.projectScopeType!=='group'||v?c():c(new Error('请选择组别'))}],projectIds:[{validator:(_r,v,c)=>form.projectScopeType!=='custom'||v?.length?c():c(new Error('请至少选择一个项目'))}]}
const summaries=computed(()=>[{label:'当前列表',value:pagination.total||tasks.value.length},{label:'收集中',value:tasks.value.filter(i=>i.status==='published').length},{label:'草稿',value:tasks.value.filter(i=>i.status==='draft').length},{label:'本页待审核',value:tasks.value.reduce((t,i)=>t+Number(i.pendingCount||0),0)}])
const maxChildFileMb=computed(()=>Math.max(1,...form.fileTasks.map(i=>Number(i.maxFileMb||1))))
const dialogTitle=computed(()=>!form.id?'新建统筹任务':form.editable?'编辑统筹任务':'查看统筹任务')
const scopeHint=computed(()=>{if(form.projectScopeType==='year')return `将包含 ${projectCountByYear(form.projectYear)} 个 ${form.projectYear} 年项目。`;if(form.projectScopeType==='group')return form.projectGroup?`组别“${form.projectGroup}”当前包含 ${projectCountByGroup(form.projectGroup)} 个项目。`:'请选择现有项目组别。';if(form.projectScopeType==='custom')return `已指定 ${form.projectIds.length} 个项目。`;return `当前数据库中的全部 ${taskOptions.projects.length} 个项目均适用。`})

function queryParams(){const q=new URLSearchParams({page:pagination.page,pageSize:pagination.pageSize});if(filters.keyword)q.set('keyword',filters.keyword);if(filters.status)q.set('status',filters.status);return q}
async function loadTasks(){loading.value=true;try{const r=await apiRequest(`/material-tasks?${queryParams()}`);tasks.value=r.data;Object.assign(pagination,r.pagination)}catch(e){ElMessage.error(e.message)}finally{loading.value=false}}
async function loadOptions(){try{Object.assign(taskOptions,(await apiRequest('/material-tasks/options')).data)}catch(e){ElMessage.error(e.message)}}
function searchTasks(){pagination.page=1;loadTasks()}
function openCreate(){Object.assign(form,newForm());dialogVisible.value=true}
function openEdit(row){Object.assign(form,newForm(),row,{id:row.id,editable:Boolean(row.editable),status:row.status,changeScope:{members:false,advisors:false,owner:false,...(row.changeScope||{})},projectIds:[...(row.projectIds||[])],fileTasks:(row.fileTasks||[]).map(makeFileTask),deadlineAt:row.deadlineAt?String(row.deadlineAt).replace('T',' ').slice(0,19):''});dialogVisible.value=true}
function resetForm(){formRef.value?.clearValidate()}
function addFileTask(){form.fileTasks.push(makeFileTask())}
function removeFileTask(index){if(form.fileTasks.length>1)form.fileTasks.splice(index,1)}
function moveFileTask(index,offset){const target=index+offset;if(target<0||target>=form.fileTasks.length)return;const[item]=form.fileTasks.splice(index,1);form.fileTasks.splice(target,0,item)}
function onChildTemplateChange(item,files){item.newTemplateFiles=files.map(i=>i.raw).filter(Boolean)}
const projectCountByYear=(year)=>taskOptions.projects.filter(p=>Number(p.projectYear)===Number(year)).length
const projectCountByGroup=(group)=>taskOptions.projects.filter(p=>p.projectGroup===group).length
function payload(status){const fileTasks=form.fileTasks.map((item,sortOrder)=>({id:item.id,categoryName:item.categoryName.trim(),taskDescription:item.taskDescription.trim()||null,allowedExtensions:item.allowedExtensions,maxFileMb:item.maxFileMb,hasTemplate:item.hasTemplate,isRequired:item.isRequired,sortOrder}));return{taskType:form.taskType,changePhase:form.changePhase,changeScope:form.changeScope,taskName:form.taskName,taskDescription:form.taskDescription,projectScopeType:form.projectScopeType,projectYear:form.projectYear,projectGroup:form.projectGroup,projectIds:form.projectIds,deadlineAt:form.deadlineAt,maxTaskProjectMb:form.maxTaskProjectMb,status,fileTasks}}
async function saveTask(status){if(!(await formRef.value?.validate().catch(()=>false)))return;if(form.taskType==='project_change'&&!Object.values(form.changeScope).some(Boolean))return ElMessage.warning('请至少允许一类项目信息变更');if(form.fileTasks.some(i=>!i.categoryName.trim()))return ElMessage.warning('请填写每个子文件任务的名称');const names=form.fileTasks.map(i=>i.categoryName.trim());if(new Set(names).size!==names.length)return ElMessage.warning('子文件任务名称不能重复');if(form.fileTasks.some(i=>!i.allowedExtensions.length))return ElMessage.warning('每个子文件任务至少选择一种允许格式');if(form.fileTasks.some(i=>i.hasTemplate&&!i.templateCount&&!i.newTemplateFiles.length))return ElMessage.warning('已选择“提供模板”的子任务需要选择至少一个模板文件');saving.value=true;try{const response=await apiRequest(form.id?`/material-tasks/${form.id}`:'/material-tasks',{method:form.id?'PUT':'POST',body:payload(status)});const taskId=form.id||response.data.id;for(const item of form.fileTasks.filter(i=>i.hasTemplate&&i.newTemplateFiles.length)){const saved=response.data.fileTasks.find(candidate=>candidate.categoryName===item.categoryName.trim());if(!saved)continue;const body=new FormData();body.append('taskId',taskId);body.append('categoryId',saved.id);item.newTemplateFiles.forEach(file=>body.append('files',file));await apiRequest('/uploads/task-templates',{method:'POST',body})}ElMessage.success(form.id?'任务已更新':status==='published'?'任务已发布':'草稿已保存');dialogVisible.value=false;await loadTasks()}catch(e){ElMessage.error(e.message)}finally{saving.value=false}}
async function setStatus(row,status){try{await ElMessageBox.confirm(`确认将任务设置为“${statusLabel(status)}”吗？`,'任务状态',{type:'warning'});await apiRequest(`/material-tasks/${row.id}/status`,{method:'PATCH',body:{status}});ElMessage.success('任务状态已更新');await loadTasks()}catch(e){if(e!=='cancel')ElMessage.error(e.message||'操作失败')}}
const statusLabel=v=>({draft:'草稿',published:'收集中',closed:'已关闭'}[v]||v); const statusType=v=>({draft:'info',published:'success',closed:''}[v]||'info'); const formatTime=v=>v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'不设截止时间'
onMounted(async()=>{await Promise.all([loadTasks(),loadOptions()])})
</script>
