<template>
  <div><div class="page-header"><div><h2 class="page-title">项目通讯录</h2><p class="page-desc">只展示本人负责项目中的成员和指导老师联系方式。</p></div></div><div class="panel"><div class="toolbar"><div class="filters"><el-select v-model="projectId" placeholder="选择项目" style="width: 320px" @change="loadContacts"><el-option v-for="project in projects" :key="project.id" :label="`${project.projectCode} ${project.title}`" :value="project.id" /></el-select><el-input v-model="keyword" placeholder="搜索姓名、学院、电话" clearable><template #prefix><el-icon><Search /></el-icon></template></el-input></div></div><el-table v-loading="loading" :data="filteredContacts" style="width: 100%" empty-text="暂无联系人"><el-table-column prop="name" label="姓名" width="110" /><el-table-column prop="role" label="项目角色" width="130"><template #default="{ row }">{{ roleLabel(row.role) }}</template></el-table-column><el-table-column prop="organization" label="学院/单位" min-width="150" /><el-table-column prop="phone" label="电话" width="140" /><el-table-column prop="qq" label="QQ" width="110" /><el-table-column prop="email" label="邮箱" min-width="190" /></el-table></div></div>
</template>
<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiRequest } from '../../services/http'
const projects = ref([]), projectId = ref(null), contacts = ref([]), keyword = ref(''), loading = ref(false)
const filteredContacts = computed(() => { const q = keyword.value.trim().toLowerCase(); return !q ? contacts.value : contacts.value.filter((item) => [item.name, item.organization, item.phone, item.qq, item.email].some((v) => String(v || '').toLowerCase().includes(q))) })
const roleLabel = (v) => ({ owner: '项目负责人', member: '项目成员', advisor: '指导老师' }[v] || v)
async function loadContacts() { if (!projectId.value) return; loading.value = true; try { contacts.value = (await apiRequest(`/projects/${projectId.value}/participations`)).data } catch (e) { ElMessage.error(e.message) } finally { loading.value = false } }
async function init() { try { projects.value = (await apiRequest('/projects?pageSize=100')).data; projectId.value = projects.value[0]?.id || null; if (projectId.value) await loadContacts() } catch (e) { ElMessage.error(e.message) } }
onMounted(init)
</script>
