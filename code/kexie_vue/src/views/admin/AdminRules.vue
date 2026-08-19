<template>
  <div>
    <div class="page-header">
      <div><h2 class="page-title">参与规则</h2><p class="page-desc">导入或编辑项目参与关系时，用这些规则提前拦截违规数据。</p></div>
      <el-button type="primary" @click="openCreate"><el-icon><Plus /></el-icon>新建规则</el-button>
    </div>
    <div class="panel">
      <el-table v-loading="loading" :data="rules" style="width: 100%" empty-text="暂无参与规则">
        <el-table-column prop="ruleName" label="规则名称" min-width="180" />
        <el-table-column prop="ruleKey" label="规则标识" min-width="220" />
        <el-table-column label="数量上限" width="110"><template #default="{ row }">{{ row.limitCount }}</template></el-table-column>
        <el-table-column prop="remark" label="说明" min-width="220" show-overflow-tooltip />
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="170" fixed="right"><template #default="{ row }"><el-button text @click="openEdit(row)">编辑</el-button><el-button text @click="toggleStatus(row)">{{ row.enabled ? '停用' : '启用' }}</el-button></template></el-table-column>
      </el-table>
    </div>
    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑参与规则' : '新建参与规则'" width="560px">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="92px">
        <el-form-item label="规则名称" prop="ruleName"><el-input v-model.trim="form.ruleName" /></el-form-item>
        <el-form-item label="规则标识" prop="ruleKey"><el-input v-model.trim="form.ruleKey" :disabled="Boolean(form.id)" placeholder="例如 max_owner_projects" /></el-form-item>
        <el-form-item label="数量上限" prop="limitCount"><el-input-number v-model="form.limitCount" :min="1" :max="100" /></el-form-item>
        <el-form-item label="启用状态"><el-switch v-model="form.enabled" /></el-form-item>
        <el-form-item label="说明"><el-input v-model.trim="form.remark" type="textarea" :rows="3" maxlength="500" show-word-limit /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiRequest } from '../../services/http'

const rules = ref([]), loading = ref(false), saving = ref(false), dialogVisible = ref(false), formRef = ref()
const form = reactive({ id: null, ruleKey: '', ruleName: '', limitCount: 1, enabled: true, remark: '' })
const formRules = {
  ruleName: [{ required: true, message: '请输入规则名称', trigger: 'blur' }],
  ruleKey: [{ required: true, message: '请输入规则标识', trigger: 'blur' }, { pattern: /^[a-z][a-z0-9_]{2,79}$/, message: '仅支持小写字母、数字和下划线', trigger: 'blur' }],
}
async function loadRules() { loading.value = true; try { rules.value = (await apiRequest('/participation-rules')).data } catch (error) { ElMessage.error(error.message) } finally { loading.value = false } }
function openCreate() { Object.assign(form, { id: null, ruleKey: '', ruleName: '', limitCount: 1, enabled: true, remark: '' }); dialogVisible.value = true }
function openEdit(row) { Object.assign(form, row); dialogVisible.value = true }
async function save() { if (!(await formRef.value?.validate().catch(() => false))) return; saving.value = true; try { await apiRequest(form.id ? `/participation-rules/${form.id}` : '/participation-rules', { method: form.id ? 'PUT' : 'POST', body: form }); ElMessage.success('参与规则已保存'); dialogVisible.value = false; await loadRules() } catch (error) { ElMessage.error(error.message) } finally { saving.value = false } }
async function toggleStatus(row) { try { await apiRequest(`/participation-rules/${row.id}/status`, { method: 'PATCH', body: { enabled: !row.enabled } }); ElMessage.success('规则状态已更新'); await loadRules() } catch (error) { ElMessage.error(error.message) } }
onMounted(loadRules)
</script>
