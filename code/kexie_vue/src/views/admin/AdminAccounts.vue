<template>
  <div>
    <div class="page-header"><div><h2 class="page-title">账号管理</h2><p class="page-desc">账号仅分管理员和项目负责人；新建或重置后必须修改初始密码。</p></div><el-button type="primary" @click="openCreate"><el-icon><Plus /></el-icon>新建账号</el-button></div>
    <div class="panel">
      <div class="toolbar"><div class="filters">
        <el-input v-model="filters.keyword" placeholder="搜索姓名或账号" clearable @keyup.enter="loadAccounts"><template #prefix><el-icon><Search /></el-icon></template></el-input>
        <el-select v-model="filters.role" placeholder="角色" clearable style="width: 160px"><el-option label="管理员" value="admin" /><el-option label="项目负责人" value="project_owner" /></el-select>
        <el-button :loading="loading" @click="loadAccounts">查询</el-button>
      </div></div>
      <el-table v-loading="loading" :data="accounts" style="width: 100%" empty-text="暂无账号数据">
        <el-table-column prop="displayName" label="显示名称" width="140" /><el-table-column prop="username" label="账号" min-width="160" />
        <el-table-column prop="role" label="角色" width="140"><template #default="{ row }">{{ row.role === 'admin' ? '管理员' : '项目负责人' }}</template></el-table-column>
        <el-table-column prop="status" label="状态" width="110"><template #default="{ row }"><el-tag :type="row.status === 'enabled' ? 'success' : 'info'">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="首次改密" width="100"><template #default="{ row }"><el-tag v-if="row.passwordResetRequired" type="warning">待修改</el-tag><span v-else>已完成</span></template></el-table-column>
        <el-table-column label="操作" width="210" fixed="right"><template #default="{ row }"><el-button text @click="resetPassword(row)">重置密码</el-button><el-button text :disabled="row.id === authStore.state.user?.id" @click="toggleStatus(row)">{{ row.status === 'enabled' ? '停用' : '启用' }}</el-button></template></el-table-column>
      </el-table>
      <div class="pagination-row" v-if="pagination.total"><el-pagination v-model:current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total" layout="total, prev, pager, next" @current-change="loadAccounts" /></div>
    </div>

    <el-dialog v-model="dialogVisible" title="新建账号" width="560px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="92px">
        <el-form-item label="账号角色" prop="role"><el-select v-model="form.role" style="width: 100%"><el-option label="项目负责人" value="project_owner" /><el-option label="管理员" value="admin" /></el-select></el-form-item>
        <el-form-item v-if="form.role === 'project_owner'" label="绑定人员" prop="personId"><el-select v-model="form.personId" filterable placeholder="搜索学生" style="width: 100%"><el-option v-for="person in personOptions" :key="person.id" :label="`${person.name}（${person.identifier}）`" :value="person.id" /></el-select></el-form-item>
        <el-form-item label="显示名称" prop="displayName"><el-input v-model.trim="form.displayName" /></el-form-item>
        <el-form-item label="登录账号" prop="username"><el-input v-model.trim="form.username" /></el-form-item>
        <el-form-item label="初始密码"><el-input v-model="form.initialPassword" show-password placeholder="留空则由系统自动生成" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="createAccount">创建账号</el-button></template>
    </el-dialog>

    <el-dialog v-model="passwordVisible" title="请妥善交付初始密码" width="500px" :close-on-click-modal="false">
      <el-alert title="该密码只在此处展示一次，用户登录后会被要求立即修改。" type="warning" show-icon :closable="false" />
      <el-input class="section" :model-value="issuedPassword" readonly><template #append><el-button @click="copyPassword">复制</el-button></template></el-input>
      <template #footer><el-button type="primary" @click="passwordVisible = false">我已记录</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiRequest } from '../../services/http'
import { authStore } from '../../stores/auth'

const accounts = ref([]), loading = ref(false), saving = ref(false), dialogVisible = ref(false), formRef = ref(), personOptions = ref([])
const filters = reactive({ keyword: '', role: '' }), pagination = reactive({ page: 1, pageSize: 20, total: 0 })
const form = reactive({ role: 'project_owner', personId: null, displayName: '', username: '', initialPassword: '' })
const passwordVisible = ref(false), issuedPassword = ref('')
const rules = { role: [{ required: true, message: '请选择角色' }], personId: [{ validator: (_r, v, cb) => form.role !== 'project_owner' || v ? cb() : cb(new Error('请选择绑定人员')), trigger: 'change' }], displayName: [{ required: true, message: '请输入显示名称', trigger: 'blur' }], username: [{ required: true, message: '请输入登录账号', trigger: 'blur' }] }
const statusLabel = (v) => ({ enabled: '启用', disabled: '停用', locked: '锁定' }[v] || v)
function params() { const p = new URLSearchParams({ page: pagination.page, pageSize: pagination.pageSize }); filters.keyword && p.set('keyword', filters.keyword); filters.role && p.set('role', filters.role); return p }
async function loadAccounts() { loading.value = true; try { const r = await apiRequest(`/accounts?${params()}`); accounts.value = r.data; Object.assign(pagination, r.pagination) } catch (e) { ElMessage.error(e.message) } finally { loading.value = false } }
async function loadPeople() { try { personOptions.value = (await apiRequest('/people?personType=student&pageSize=100')).data } catch (e) { ElMessage.error(e.message) } }
function openCreate() { Object.assign(form, { role: 'project_owner', personId: null, displayName: '', username: '', initialPassword: '' }); dialogVisible.value = true; if (!personOptions.value.length) loadPeople() }
watch(() => form.personId, (id) => { const person = personOptions.value.find((item) => item.id === id); if (person) { form.displayName = person.name; form.username = person.identifier } })
async function createAccount() { if (!(await formRef.value?.validate().catch(() => false))) return; saving.value = true; try { const r = await apiRequest('/accounts', { method: 'POST', body: form }); issuedPassword.value = r.data.initialPassword; dialogVisible.value = false; passwordVisible.value = true; await loadAccounts() } catch (e) { ElMessage.error(e.message) } finally { saving.value = false } }
async function resetPassword(row) { try { await ElMessageBox.confirm(`确认重置“${row.displayName}”的密码吗？`, '重置密码', { type: 'warning' }); const r = await apiRequest(`/accounts/${row.id}/reset-password`, { method: 'POST', body: {} }); issuedPassword.value = r.data.initialPassword; passwordVisible.value = true; await loadAccounts() } catch (e) { if (e !== 'cancel') ElMessage.error(e.message || '重置失败') } }
async function toggleStatus(row) { try { await apiRequest(`/accounts/${row.id}/status`, { method: 'PATCH', body: { status: row.status === 'enabled' ? 'disabled' : 'enabled' } }); ElMessage.success('账号状态已更新'); await loadAccounts() } catch (e) { ElMessage.error(e.message) } }
async function copyPassword() { await navigator.clipboard.writeText(issuedPassword.value); ElMessage.success('密码已复制') }
onMounted(loadAccounts)
</script>
