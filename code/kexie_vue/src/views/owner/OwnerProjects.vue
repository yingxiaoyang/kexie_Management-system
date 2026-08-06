<template>
  <div><div class="page-header"><div><h2 class="page-title">我的项目</h2><p class="page-desc">仅展示当前账号绑定人员负责的项目。</p></div></div><div class="panel"><el-table v-loading="loading" :data="projects" style="width: 100%" empty-text="当前账号尚未关联负责项目"><el-table-column prop="projectCode" label="项目编号" width="150" /><el-table-column prop="title" label="作品名称" min-width="230" /><el-table-column prop="projectGroup" label="组别" width="130" /><el-table-column prop="category" label="项目类别" width="130" /><el-table-column prop="advisors" label="指导老师" width="130" /><el-table-column prop="status" label="状态" width="110"><template #default="{ row }"><el-tag effect="plain">{{ statusLabel(row.status) }}</el-tag></template></el-table-column></el-table></div></div>
</template>
<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiRequest } from '../../services/http'
const projects = ref([]), loading = ref(false)
const statusLabel = (v) => ({ draft: '草稿', active: '进行中', checking: '检查中', completed: '已结项', archived: '已归档', stopped: '已停止' }[v] || v)
async function load() { loading.value = true; try { projects.value = (await apiRequest('/projects?pageSize=100')).data } catch (e) { ElMessage.error(e.message) } finally { loading.value = false } }
onMounted(load)
</script>
