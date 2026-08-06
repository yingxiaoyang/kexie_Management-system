<template>
  <div>
    <div class="page-header">
      <div><h2 class="page-title">人员库管理</h2><p class="page-desc">可按姓名、学号、工号、电话、QQ、学院或单位统一搜索。</p></div>
      <el-button type="primary" @click="openForm()"><el-icon><Plus /></el-icon>新增人员</el-button>
    </div>
    <div class="panel">
      <div class="toolbar">
        <div class="filters">
          <el-input v-model="filters.keyword" placeholder="姓名、编号、电话、QQ、学院、单位" clearable @keyup.enter="loadPeople"><template #prefix><el-icon><Search /></el-icon></template></el-input>
          <el-select v-model="filters.personType" placeholder="人员类型" clearable style="width: 150px"><el-option label="学生" value="student" /><el-option label="指导老师" value="teacher" /></el-select>
          <el-button :loading="loading" @click="loadPeople">查询</el-button>
        </div>
      </div>
      <el-table v-loading="loading" :data="people" class="desktop-table" style="width: 100%" empty-text="暂无人员数据">
        <el-table-column prop="name" label="姓名" width="100" />
        <el-table-column prop="personType" label="类型" width="110"><template #default="{ row }">{{ row.personType === 'student' ? '学生' : '指导老师' }}</template></el-table-column>
        <el-table-column prop="identifier" label="学号/工号" width="150" />
        <el-table-column prop="organization" label="学院/单位" min-width="150" />
        <el-table-column prop="phone" label="电话" width="140" />
        <el-table-column label="项目统计" width="160"><template #default="{ row }">负责 {{ Number(row.ownerProjectCount) }} / 参与 {{ Number(row.memberProjectCount) }}</template></el-table-column>
        <el-table-column label="操作" width="170" fixed="right"><template #default="{ row }"><el-button text @click="openForm(row)">编辑</el-button><el-button text @click="showProjects(row)">参与项目</el-button></template></el-table-column>
      </el-table>
      <div class="mobile-card-list">
        <el-empty v-if="!people.length && !loading" class="empty-mobile" description="暂无人员数据" :image-size="72" />
        <article v-for="row in people" :key="row.id" class="mobile-data-card">
          <div class="mobile-card-header">
            <div><p class="mobile-card-title">{{ row.name }}</p><div class="mobile-card-meta"><span>{{ row.personType === 'student' ? '学生' : '指导老师' }}</span><span>{{ row.identifier }}</span></div></div>
            <el-tag effect="plain" size="small">负责 {{ Number(row.ownerProjectCount) }}</el-tag>
          </div>
          <div class="mobile-card-body">
            <div><span class="mobile-field-label">学院 / 单位</span><span class="mobile-field-value">{{ row.organization || '未填写' }}</span></div>
            <div><span class="mobile-field-label">联系电话</span><span class="mobile-field-value">{{ row.phone || '未填写' }}</span></div>
          </div>
          <div class="mobile-card-footer"><el-button @click="showProjects(row)">参与项目</el-button><el-button type="primary" plain @click="openForm(row)">编辑资料</el-button></div>
        </article>
      </div>
      <div class="pagination-row" v-if="pagination.total"><el-pagination v-model:current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total" layout="total, prev, pager, next" @current-change="loadPeople" /></div>
    </div>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑人员' : '新增人员'" width="620px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="92px">
        <el-form-item label="人员类型" prop="personType"><el-radio-group v-model="form.personType"><el-radio-button value="student">学生</el-radio-button><el-radio-button value="teacher">指导老师</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="姓名" prop="name"><el-input v-model.trim="form.name" /></el-form-item>
        <el-form-item v-if="form.personType === 'student'" label="学号" prop="studentNo"><el-input v-model.trim="form.studentNo" /></el-form-item>
        <el-form-item v-else label="工号" prop="teacherNo"><el-input v-model.trim="form.teacherNo" /></el-form-item>
        <el-form-item v-if="form.personType === 'student'" label="学院"><el-input v-model.trim="form.college" /></el-form-item>
        <el-form-item v-else label="单位"><el-input v-model.trim="form.unit" /></el-form-item>
        <el-form-item label="电话"><el-input v-model.trim="form.phone" /></el-form-item>
        <el-form-item label="QQ"><el-input v-model.trim="form.qq" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model.trim="form.email" /></el-form-item>
        <el-form-item v-if="form.personType === 'teacher'" label="职务/职称"><el-input v-model.trim="form.title" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="savePerson">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="projectsVisible" :title="`${selectedPerson?.name || ''}参与的项目`" width="720px">
      <el-table v-loading="projectsLoading" :data="personProjects" empty-text="暂无项目参与记录">
        <el-table-column prop="projectCode" label="项目编号" width="150" /><el-table-column prop="title" label="作品名称" min-width="240" /><el-table-column prop="role" label="身份" width="110"><template #default="{ row }">{{ roleLabel(row.role) }}</template></el-table-column><el-table-column prop="status" label="状态" width="100" />
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiRequest } from '../../services/http'

const people = ref([]), loading = ref(false), saving = ref(false), dialogVisible = ref(false), formRef = ref()
const filters = reactive({ keyword: '', personType: '' })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })
const emptyForm = () => ({ id: null, personType: 'student', name: '', studentNo: '', teacherNo: '', college: '', unit: '', phone: '', qq: '', email: '', title: '' })
const form = reactive(emptyForm())
const rules = {
  personType: [{ required: true, message: '请选择人员类型' }], name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  studentNo: [{ validator: (_r, v, cb) => form.personType !== 'student' || v ? cb() : cb(new Error('请输入学号')), trigger: 'blur' }],
  teacherNo: [{ validator: (_r, v, cb) => form.personType !== 'teacher' || v ? cb() : cb(new Error('请输入工号')), trigger: 'blur' }],
}
const projectsVisible = ref(false), projectsLoading = ref(false), selectedPerson = ref(null), personProjects = ref([])
function params() { const p = new URLSearchParams({ page: pagination.page, pageSize: pagination.pageSize }); filters.keyword && p.set('keyword', filters.keyword); filters.personType && p.set('personType', filters.personType); return p }
async function loadPeople() { loading.value = true; try { const r = await apiRequest(`/people?${params()}`); people.value = r.data; Object.assign(pagination, r.pagination) } catch (e) { ElMessage.error(e.message) } finally { loading.value = false } }
function openForm(row) { Object.assign(form, emptyForm(), row || {}); dialogVisible.value = true }
async function savePerson() { if (!(await formRef.value?.validate().catch(() => false))) return; saving.value = true; try { await apiRequest(form.id ? `/people/${form.id}` : '/people', { method: form.id ? 'PUT' : 'POST', body: form }); ElMessage.success('人员信息已保存'); dialogVisible.value = false; await loadPeople() } catch (e) { ElMessage.error(e.message) } finally { saving.value = false } }
async function showProjects(row) { selectedPerson.value = row; projectsVisible.value = true; projectsLoading.value = true; try { personProjects.value = (await apiRequest(`/people/${row.id}/projects`)).data } catch (e) { ElMessage.error(e.message) } finally { projectsLoading.value = false } }
const roleLabel = (role) => ({ owner: '负责人', member: '成员', advisor: '指导老师' }[role] || role)
onMounted(loadPeople)
</script>
