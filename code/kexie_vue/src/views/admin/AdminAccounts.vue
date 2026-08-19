<template>
  <div>
    <div class="page-header">
      <div><h2 class="page-title">账号与管理员权限</h2><p class="page-desc">仅超级管理员可创建和管理小管理员；学生账号统一使用标准化学号。</p></div>
      <el-button type="primary" @click="openCreate"><el-icon><Plus /></el-icon>新建账号</el-button>
    </div>

    <el-tabs v-model="activeTab" @tab-change="tabChanged">
      <el-tab-pane label="账号管理" name="accounts">
        <div class="panel">
          <div class="toolbar"><div class="filters">
            <el-input v-model="filters.keyword" placeholder="搜索姓名或账号" clearable @keyup.enter="loadAccounts"><template #prefix><el-icon><Search /></el-icon></template></el-input>
            <el-select v-model="filters.role" placeholder="角色" clearable style="width: 180px"><el-option label="管理员" value="admin" /><el-option label="申请人" value="applicant" /><el-option label="项目负责人" value="project_owner" /></el-select>
            <el-button :loading="loading" @click="loadAccounts">查询</el-button>
          </div></div>
          <el-table v-loading="loading" :data="accounts" style="width: 100%" empty-text="暂无账号数据">
            <el-table-column prop="displayName" label="显示名称" width="140" />
            <el-table-column prop="username" label="账号/学号" min-width="150" />
            <el-table-column label="角色" width="130"><template #default="{ row }"><el-tag :type="row.adminLevel === 'super' ? 'danger' : row.role === 'admin' ? 'warning' : ''">{{ roleLabel(row) }}</el-tag></template></el-table-column>
            <el-table-column label="模块权限" min-width="260"><template #default="{ row }"><span v-if="row.adminLevel === 'super'">全部权限</span><template v-else-if="row.role === 'admin'"><el-tag v-for="key in row.permissionKeys" :key="key" class="permission-tag" size="small">{{ permissionName(key) }}</el-tag><span v-if="!row.permissionKeys.length" class="muted">未授予模块</span></template><span v-else>-</span></template></el-table-column>
            <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status === 'enabled' ? 'success' : 'info'">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="330" fixed="right"><template #default="{ row }">
              <el-button v-if="row.role === 'admin' && row.adminLevel === 'limited'" text @click="openPermissions(row)">配置权限</el-button>
              <el-button text :disabled="row.adminLevel === 'super'" @click="resetPassword(row)">重置密码</el-button>
              <el-button text :disabled="row.adminLevel === 'super'" @click="toggleStatus(row)">{{ row.status === 'enabled' ? '停用' : '启用' }}</el-button>
              <el-button text type="danger" :disabled="row.adminLevel === 'super'" @click="deleteAccount(row)">删除</el-button>
            </template></el-table-column>
          </el-table>
          <div class="pagination-row" v-if="pagination.total"><el-pagination v-model:current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total" layout="total, prev, pager, next" @current-change="loadAccounts" /></div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="权限变更记录" name="audits">
        <div class="panel">
          <el-table v-loading="auditLoading" :data="audits" style="width: 100%" empty-text="暂无权限变更记录">
            <el-table-column prop="createdAt" label="时间" width="180"><template #default="{ row }">{{ formatTime(row.createdAt) }}</template></el-table-column>
            <el-table-column prop="actorName" label="操作人" width="130" />
            <el-table-column label="目标账号" min-width="180"><template #default="{ row }">{{ row.targetName }}（{{ row.targetUsername }}）</template></el-table-column>
            <el-table-column label="动作" width="130"><template #default="{ row }">{{ actionLabel(row.action) }}</template></el-table-column>
            <el-table-column label="变更前" min-width="180"><template #default="{ row }">{{ permissionSummary(row.beforePermissions) }}</template></el-table-column>
            <el-table-column label="变更后" min-width="180"><template #default="{ row }">{{ permissionSummary(row.afterPermissions) }}</template></el-table-column>
          </el-table>
          <div class="pagination-row" v-if="auditPagination.total"><el-pagination v-model:current-page="auditPagination.page" :page-size="auditPagination.pageSize" :total="auditPagination.total" layout="total, prev, pager, next" @current-change="loadAudits" /></div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="dialogVisible" title="新建账号" width="620px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="账号类型" prop="role"><el-radio-group v-model="form.role"><el-radio-button value="project_owner">项目负责人</el-radio-button><el-radio-button value="admin">小管理员</el-radio-button></el-radio-group></el-form-item>
        <template v-if="form.role === 'project_owner'">
          <el-form-item label="绑定学生" prop="personId"><el-select v-model="form.personId" filterable placeholder="搜索已有学生记录" style="width: 100%"><el-option v-for="person in personOptions" :key="person.id" :label="`${person.name}（${person.identifier}）`" :value="person.id" /></el-select></el-form-item>
          <el-alert title="系统将直接复用所选人员记录，并强制使用标准化后的学号作为登录账号。" type="info" :closable="false" show-icon />
        </template>
        <template v-else>
          <el-form-item label="显示名称" prop="displayName"><el-input v-model.trim="form.displayName" /></el-form-item>
          <el-form-item label="登录账号" prop="username"><el-input v-model.trim="form.username" autocomplete="off" /></el-form-item>
          <el-form-item label="模块权限" prop="permissionKeys"><el-checkbox-group v-model="form.permissionKeys"><div v-for="item in permissionCatalog" :key="item.permissionKey" class="permission-option"><el-checkbox :value="item.permissionKey">{{ item.permissionName }}</el-checkbox><span class="muted">{{ item.description }}</span></div></el-checkbox-group></el-form-item>
        </template>
        <el-form-item label="初始密码"><el-input v-model="form.initialPassword" show-password autocomplete="new-password" placeholder="留空则由系统自动生成" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="createAccount">创建账号</el-button></template>
    </el-dialog>

    <el-dialog v-model="permissionVisible" :title="`配置权限：${permissionTarget?.displayName || ''}`" width="620px">
      <el-checkbox-group v-model="editingPermissions"><div v-for="item in permissionCatalog" :key="item.permissionKey" class="permission-option"><el-checkbox :value="item.permissionKey">{{ item.permissionName }}</el-checkbox><span class="muted">{{ item.description }}</span></div></el-checkbox-group>
      <template #footer><el-button @click="permissionVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="savePermissions">保存并使旧会话失效</el-button></template>
    </el-dialog>

    <el-dialog v-model="passwordVisible" title="请妥善交付初始密码" width="500px" :close-on-click-modal="false">
      <el-alert title="该密码只在此处展示一次，用户登录后会被要求立即修改。" type="warning" show-icon :closable="false" />
      <el-input class="section" :model-value="issuedPassword" readonly><template #append><el-button @click="copyPassword">复制</el-button></template></el-input>
      <template #footer><el-button type="primary" @click="passwordVisible = false">我已记录</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiRequest } from '../../services/http'

const activeTab = ref('accounts')
const accounts = ref([]), loading = ref(false), saving = ref(false), dialogVisible = ref(false), formRef = ref(), personOptions = ref([])
const permissionCatalog = ref([]), permissionVisible = ref(false), permissionTarget = ref(null), editingPermissions = ref([])
const audits = ref([]), auditLoading = ref(false)
const filters = reactive({ keyword: '', role: '' })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })
const auditPagination = reactive({ page: 1, pageSize: 20, total: 0 })
const form = reactive({ role: 'project_owner', personId: null, displayName: '', username: '', initialPassword: '', permissionKeys: [] })
const passwordVisible = ref(false), issuedPassword = ref('')
const rules = {
  role: [{ required: true, message: '请选择账号类型' }],
  personId: [{ validator: (_r, value, callback) => form.role !== 'project_owner' || value ? callback() : callback(new Error('请选择绑定学生')), trigger: 'change' }],
  displayName: [{ validator: (_r, value, callback) => form.role !== 'admin' || value ? callback() : callback(new Error('请输入显示名称')), trigger: 'blur' }],
  username: [{ validator: (_r, value, callback) => form.role !== 'admin' || /^[A-Za-z0-9_.-]{4,80}$/.test(value) ? callback() : callback(new Error('管理员账号为 4–80 位字母、数字或 ._-')), trigger: 'blur' }],
}
const statusLabel = (value) => ({ enabled: '启用', disabled: '停用', locked: '锁定' }[value] || value)
const roleLabel = (row) => row.adminLevel === 'super' ? '超级管理员' : row.role === 'admin' ? '小管理员' : row.role === 'applicant' ? '申请人' : '项目负责人'
const actionLabel = (value) => ({ admin_created: '创建管理员', permissions_changed: '权限变更', status_changed: '状态变更', password_reset: '重置密码', admin_deleted: '删除管理员' }[value] || value)
const permissionName = (key) => permissionCatalog.value.find((item) => item.permissionKey === key)?.permissionName || key
const jsonArray = (value) => Array.isArray(value) ? value : typeof value === 'string' ? JSON.parse(value || '[]') : []
const permissionSummary = (value) => jsonArray(value).map(permissionName).join('、') || '无'
const formatTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
function params() { const p = new URLSearchParams({ page: pagination.page, pageSize: pagination.pageSize }); filters.keyword && p.set('keyword', filters.keyword); filters.role && p.set('role', filters.role); return p }
async function loadAccounts() { loading.value = true; try { const response = await apiRequest(`/accounts?${params()}`); accounts.value = response.data; Object.assign(pagination, response.pagination) } catch (error) { ElMessage.error(error.message) } finally { loading.value = false } }
async function loadCatalog() { permissionCatalog.value = (await apiRequest('/accounts/permission-catalog')).data }
async function loadPeople() { personOptions.value = (await apiRequest('/people?personType=student&pageSize=100')).data }
async function loadAudits() { auditLoading.value = true; try { const response = await apiRequest(`/accounts/permission-audits?page=${auditPagination.page}&pageSize=${auditPagination.pageSize}`); audits.value = response.data; Object.assign(auditPagination, response.pagination) } catch (error) { ElMessage.error(error.message) } finally { auditLoading.value = false } }
function tabChanged(name) { if (name === 'audits') loadAudits() }
async function openCreate() { Object.assign(form, { role: 'project_owner', personId: null, displayName: '', username: '', initialPassword: '', permissionKeys: [] }); dialogVisible.value = true; if (!personOptions.value.length) await loadPeople().catch((error) => ElMessage.error(error.message)) }
async function createAccount() { if (!(await formRef.value?.validate().catch(() => false))) return; saving.value = true; try { const body = form.role === 'admin' ? { role: form.role, displayName: form.displayName, username: form.username, initialPassword: form.initialPassword, permissionKeys: form.permissionKeys } : { role: form.role, personId: form.personId, initialPassword: form.initialPassword }; const response = await apiRequest('/accounts', { method: 'POST', body }); issuedPassword.value = response.data.initialPassword; dialogVisible.value = false; passwordVisible.value = true; await loadAccounts() } catch (error) { ElMessage.error(error.message) } finally { saving.value = false } }
function openPermissions(row) { permissionTarget.value = row; editingPermissions.value = [...row.permissionKeys]; permissionVisible.value = true }
async function savePermissions() { saving.value = true; try { await apiRequest(`/accounts/${permissionTarget.value.id}/permissions`, { method: 'PUT', body: { permissionKeys: editingPermissions.value } }); ElMessage.success('权限已更新'); permissionVisible.value = false; await loadAccounts() } catch (error) { ElMessage.error(error.message) } finally { saving.value = false } }
async function resetPassword(row) { try { await ElMessageBox.confirm(`确认重置“${row.displayName}”的密码吗？`, '重置密码', { type: 'warning' }); const response = await apiRequest(`/accounts/${row.id}/reset-password`, { method: 'POST', body: {} }); issuedPassword.value = response.data.initialPassword; passwordVisible.value = true; await loadAccounts() } catch (error) { if (error !== 'cancel') ElMessage.error(error.message || '重置失败') } }
async function toggleStatus(row) { try { await apiRequest(`/accounts/${row.id}/status`, { method: 'PATCH', body: { status: row.status === 'enabled' ? 'disabled' : 'enabled' } }); ElMessage.success('账号状态已更新'); await loadAccounts() } catch (error) { ElMessage.error(error.message) } }
async function deleteAccount(row) { try { await ElMessageBox.confirm(`确认删除“${row.displayName}”吗？旧会话会立即失效。`, '删除账号', { type: 'warning', confirmButtonText: '确认删除' }); await apiRequest(`/accounts/${row.id}`, { method: 'DELETE' }); ElMessage.success('账号已删除'); await loadAccounts() } catch (error) { if (error !== 'cancel') ElMessage.error(error.message || '删除失败') } }
async function copyPassword() { await navigator.clipboard.writeText(issuedPassword.value); ElMessage.success('密码已复制') }
onMounted(async () => { await Promise.all([loadCatalog(), loadAccounts()]) })
</script>

<style scoped>
.permission-tag { margin: 2px 4px 2px 0; }
.permission-option { display: grid; grid-template-columns: 120px 1fr; gap: 12px; align-items: start; margin-bottom: 10px; }
</style>
