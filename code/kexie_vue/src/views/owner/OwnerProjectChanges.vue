<template>
  <div>
    <div class="page-header"><div><h2 class="page-title">项目变更申请</h2><p class="page-desc">负责人信息为只读；成员、导师和负责人调整须提交证明并经审核后生效。</p></div><el-button type="primary" :disabled="!options.tasks.length" @click="openCreate">新建申请</el-button></div>
    <el-alert title="待审期间你仍是当前负责人；只有审核通过后，人员关系和账号权限才会原子性切换。" type="info" show-icon :closable="false" class="section" />
    <div class="panel">
      <el-table v-loading="loading" :data="items" empty-text="暂无项目变更申请">
        <el-table-column label="项目 / 任务" min-width="260"><template #default="{row}"><strong>{{ row.projectTitle }}</strong><div class="table-subline">{{ row.projectCode }} · {{ row.taskName }}</div></template></el-table-column>
        <el-table-column prop="changeSummary" label="拟变更摘要" min-width="300" show-overflow-tooltip />
        <el-table-column label="版本" width="80"><template #default="{row}">V{{ row.currentVersion }}</template></el-table-column>
        <el-table-column label="状态" width="110"><template #default="{row}"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column prop="returnReason" label="审核反馈" min-width="180"><template #default="{row}"><span :class="{'danger-text':row.returnReason}">{{ row.returnReason || '—' }}</span></template></el-table-column>
        <el-table-column label="操作" width="170"><template #default="{row}"><el-button text @click="view(row)">查看</el-button><el-button v-if="['draft','returned'].includes(row.status)" text type="primary" @click="edit(row)">{{ row.status==='returned'?'修改重提':'继续填写' }}</el-button></template></el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialog" :title="form.id ? '编辑项目变更申请' : '新建项目变更申请'" width="820px">
      <el-form label-position="top">
        <el-form-item label="变更任务与项目" required><el-select v-model="form.optionKey" filterable style="width:100%" :disabled="Boolean(form.id)" @change="loadCurrentPeople"><el-option v-for="item in options.tasks" :key="keyOf(item)" :label="`${item.taskName}｜${item.projectCode} ${item.projectTitle}`" :value="keyOf(item)" /></el-select></el-form-item>
        <el-alert v-if="selectedOption" :title="`${selectedOption.changePhase==='stage'?'阶段检查':'中期检查'} · 允许范围：${scopeText(selectedOption.changeScope)}`" type="info" :closable="false" />
        <div class="change-grid">
          <template v-if="scope.members">
            <el-form-item label="新增项目成员"><el-select v-model="form.memberAdds" multiple filterable style="width:100%"><el-option v-for="p in options.students" :key="p.id" :label="personLabel(p)" :value="p.id" /></el-select></el-form-item>
            <el-form-item label="移除项目成员"><el-select v-model="form.memberRemoves" multiple style="width:100%"><el-option v-for="p in currentMembers" :key="p.personId" :label="`${p.name}（${p.identifier || '无学号'}）`" :value="p.personId" /></el-select></el-form-item>
          </template>
          <template v-if="scope.advisors">
            <el-form-item label="新增指导教师"><el-select v-model="form.advisorAdds" multiple filterable style="width:100%"><el-option v-for="p in options.teachers" :key="p.id" :label="personLabel(p)" :value="p.id" /></el-select></el-form-item>
            <el-form-item label="移除指导教师"><el-select v-model="form.advisorRemoves" multiple style="width:100%"><el-option v-for="p in currentAdvisors" :key="p.personId" :label="`${p.name}（${p.identifier || '无工号'}）`" :value="p.personId" /></el-select></el-form-item>
          </template>
        </div>
        <template v-if="scope.owner">
          <el-divider content-position="left">负责人交接</el-divider>
          <el-form-item label="新负责人"><el-select v-model="form.newOwnerPersonId" clearable filterable style="width:100%"><el-option v-for="p in options.students" :key="p.id" :label="candidateLabel(p)" :value="p.id" :disabled="!candidateAvailable(p)" /></el-select><div class="el-upload__tip">候选人须为未禁用学生、已用学号自行注册，且当前未负责其他正式项目。</div></el-form-item>
          <el-form-item v-if="form.newOwnerPersonId" label="原负责人去向"><el-radio-group v-model="form.previousOwnerDisposition"><el-radio value="member">转为普通成员</el-radio><el-radio value="exit">退出项目</el-radio></el-radio-group></el-form-item>
        </template>
        <el-form-item label="变更证明文件" required><el-upload action="#" :auto-upload="false" :limit="1" :on-change="onProof" :on-remove="()=>form.proof=null"><el-button>选择证明文件</el-button><template #tip><div class="el-upload__tip">正式提交必须上传；退回重提可沿用已上传证明，也可补充新文件。</div></template></el-upload></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialog=false">取消</el-button><el-button :loading="saving" @click="save(false)">保存草稿</el-button><el-button type="primary" :loading="saving" @click="save(true)">正式提交</el-button></template>
    </el-dialog>

    <el-dialog v-model="detailDialog" title="项目变更申请详情" width="760px"><template v-if="detail"><el-descriptions :column="2" border><el-descriptions-item label="项目">{{ detail.projectCode }} · {{ detail.projectTitle }}</el-descriptions-item><el-descriptions-item label="状态">{{ statusLabel(detail.status) }}</el-descriptions-item><el-descriptions-item label="当前版本">V{{ detail.currentVersion }}</el-descriptions-item><el-descriptions-item label="发起方式">{{ detail.initiatorType==='forced_admin'?'超级管理员强制发起':'负责人申请' }}</el-descriptions-item><el-descriptions-item label="变更摘要" :span="2">{{ detail.changeSummary }}</el-descriptions-item><el-descriptions-item v-if="detail.returnReason" label="退回原因" :span="2">{{ detail.returnReason }}</el-descriptions-item></el-descriptions><el-table :data="detail.versions" class="section"><el-table-column prop="version" label="版本" width="90" /><el-table-column prop="submittedBy" label="提交人" /><el-table-column prop="submittedAt" label="提交时间"><template #default="{row}">{{ formatTime(row.submittedAt) }}</template></el-table-column></el-table></template></el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiRequest } from '../../services/http'

const loading=ref(false),saving=ref(false),dialog=ref(false),detailDialog=ref(false),items=ref([]),detail=ref(null)
const options=reactive({tasks:[],students:[],teachers:[]}),currentPeople=ref([])
const empty=()=>({id:null,optionKey:'',memberAdds:[],memberRemoves:[],advisorAdds:[],advisorRemoves:[],newOwnerPersonId:null,previousOwnerDisposition:'member',proof:null})
const form=reactive(empty())
const keyOf=i=>`${i.taskId}:${i.projectId}`
const selectedOption=computed(()=>options.tasks.find(i=>keyOf(i)===form.optionKey))
const scope=computed(()=>selectedOption.value?.changeScope||{})
const currentMembers=computed(()=>currentPeople.value.filter(i=>i.role==='member'))
const currentAdvisors=computed(()=>currentPeople.value.filter(i=>i.role==='advisor'))
const plan=()=>({members:{addPersonIds:form.memberAdds,removePersonIds:form.memberRemoves},advisors:{addPersonIds:form.advisorAdds,removePersonIds:form.advisorRemoves},ownerChange:form.newOwnerPersonId?{newOwnerPersonId:form.newOwnerPersonId,previousOwnerDisposition:form.previousOwnerDisposition}:null})
const personLabel=p=>`${p.name}（${p.identifier||'无编号'}）`
const candidateAvailable=p=>Boolean(p.userId)&&p.accountStatus!=='disabled'&&p.userStatus==='enabled'
const candidateLabel=p=>`${personLabel(p)}${candidateAvailable(p)?'':' · 请先注册/启用'}`
const scopeText=s=>[s?.members&&'项目成员',s?.advisors&&'指导教师',s?.owner&&'项目负责人'].filter(Boolean).join('、')
const statusLabel=s=>({draft:'草稿',submitted:'待审核',returned:'已退回',approved:'已通过'}[s]||s)
const statusType=s=>({draft:'info',submitted:'warning',returned:'danger',approved:'success'}[s]||'info')
const formatTime=v=>v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'—'
async function load(){loading.value=true;try{const [list,opt]=await Promise.all([apiRequest('/project-changes?pageSize=100'),apiRequest('/project-changes/options')]);items.value=list.data;Object.assign(options,opt.data)}catch(e){ElMessage.error(e.message)}finally{loading.value=false}}
function openCreate(){Object.assign(form,empty(),{optionKey:options.tasks[0]?keyOf(options.tasks[0]):''});dialog.value=true;loadCurrentPeople()}
async function loadCurrentPeople(){if(!selectedOption.value)return;try{currentPeople.value=(await apiRequest(`/projects/${selectedOption.value.projectId}/workspace`)).data.participations}catch(e){ElMessage.error(e.message)}}
function onProof(file){form.proof=file.raw}
function applyPlan(p){form.memberAdds=[...(p.members?.addPersonIds||[])];form.memberRemoves=[...(p.members?.removePersonIds||[])];form.advisorAdds=[...(p.advisors?.addPersonIds||[])];form.advisorRemoves=[...(p.advisors?.removePersonIds||[])];form.newOwnerPersonId=p.ownerChange?.newOwnerPersonId||null;form.previousOwnerDisposition=p.ownerChange?.previousOwnerDisposition||'member'}
async function edit(row){try{const d=(await apiRequest(`/project-changes/${row.id}`)).data;Object.assign(form,empty(),{id:d.id,optionKey:`${d.taskId}:${d.projectId}`});applyPlan(d.proposedChanges);dialog.value=true;await loadCurrentPeople()}catch(e){ElMessage.error(e.message)}}
async function view(row){try{detail.value=(await apiRequest(`/project-changes/${row.id}`)).data;detailDialog.value=true}catch(e){ElMessage.error(e.message)}}
async function save(submit){if(!selectedOption.value)return ElMessage.warning('请选择变更任务和项目');saving.value=true;try{let id=form.id;if(id)await apiRequest(`/project-changes/${id}`,{method:'PUT',body:{proposedChanges:plan()}});else{id=(await apiRequest('/project-changes',{method:'POST',body:{taskId:selectedOption.value.taskId,projectId:selectedOption.value.projectId,proposedChanges:plan()}})).data.id;form.id=id}if(form.proof){const body=new FormData();body.append('file',form.proof);await apiRequest(`/project-changes/${id}/proof`,{method:'POST',body})}if(submit){await apiRequest(`/project-changes/${id}/submit`,{method:'POST'});ElMessage.success('变更申请已提交，待审期间当前权限保持不变')}else ElMessage.success('草稿已保存');dialog.value=false;await load()}catch(e){ElMessage.error(e.message)}finally{saving.value=false}}
onMounted(load)
</script>
