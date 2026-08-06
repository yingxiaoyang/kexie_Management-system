<template>
  <div><div class="page-header"><div><h2 class="page-title">我的项目</h2><p class="page-desc">查看当前账号负责的项目、组别和指导老师信息。</p></div></div><div class="panel"><el-table v-loading="loading" :data="projects" class="desktop-table" style="width: 100%" empty-text="当前账号尚未关联负责项目"><el-table-column prop="projectCode" label="项目编号" width="150" /><el-table-column prop="title" label="作品名称" min-width="230" /><el-table-column prop="projectGroup" label="组别" width="130" /><el-table-column prop="category" label="项目类别" width="130" /><el-table-column prop="advisors" label="指导老师" width="130" /><el-table-column prop="status" label="状态" width="110"><template #default="{ row }"><el-tag effect="plain">{{ statusLabel(row.status) }}</el-tag></template></el-table-column></el-table><div class="mobile-card-list"><el-empty v-if="!projects.length && !loading" class="empty-mobile" description="当前账号尚未关联负责项目" :image-size="72" /><article v-for="row in projects" :key="row.id" class="mobile-data-card"><div class="mobile-card-header"><div><p class="project-code">{{ row.projectCode }}</p><p class="mobile-card-title">{{ row.title }}</p></div><el-tag effect="plain" size="small">{{ statusLabel(row.status) }}</el-tag></div><div class="mobile-card-body"><div><span class="mobile-field-label">组别</span><span class="mobile-field-value">{{ row.projectGroup || '未分组' }}</span></div><div><span class="mobile-field-label">项目类别</span><span class="mobile-field-value">{{ row.category || '未填写' }}</span></div><div style="grid-column: 1 / -1"><span class="mobile-field-label">指导老师</span><span class="mobile-field-value">{{ row.advisors || '暂未填写' }}</span></div></div></article></div></div></div>
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
