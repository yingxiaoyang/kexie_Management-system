<template>
  <div><div class="page-header"><div><h2 class="page-title">我的项目</h2><p class="page-desc">进入项目全景详情，查看团队、全流程时间轴和所有材料版本。</p></div></div><div class="panel"><el-table v-loading="loading" :data="projects" class="desktop-table" style="width: 100%" empty-text="当前账号尚未关联负责项目" @row-click="openWorkspace"><el-table-column prop="projectCode" label="项目编号" width="150" /><el-table-column prop="title" label="作品名称" min-width="230" /><el-table-column prop="projectGroup" label="组别" width="130" /><el-table-column prop="category" label="项目类别" width="130" /><el-table-column prop="advisors" label="指导老师" width="130" /><el-table-column prop="status" label="状态" width="110"><template #default="{ row }"><el-tag effect="plain">{{ statusLabel(row.status) }}</el-tag></template></el-table-column><el-table-column label="操作" width="100"><template #default="{ row }"><el-button type="primary" link @click.stop="openWorkspace(row)">查看详情</el-button></template></el-table-column></el-table><div class="mobile-card-list"><el-empty v-if="!projects.length && !loading" class="empty-mobile" description="当前账号尚未关联负责项目" :image-size="72" /><article v-for="row in projects" :key="row.id" class="mobile-data-card"><div class="mobile-card-header"><div><p class="project-code">{{ row.projectCode }}</p><p class="mobile-card-title">{{ row.title }}</p></div><el-tag effect="plain" size="small">{{ statusLabel(row.status) }}</el-tag></div><div class="mobile-card-body"><div><span class="mobile-field-label">组别</span><span class="mobile-field-value">{{ row.projectGroup || '未分组' }}</span></div><div><span class="mobile-field-label">项目类别</span><span class="mobile-field-value">{{ row.category || '未填写' }}</span></div><div style="grid-column: 1 / -1"><span class="mobile-field-label">指导老师</span><span class="mobile-field-value">{{ row.advisors || '暂未填写' }}</span></div></div><div class="mobile-card-footer"><span class="muted">只读项目全景</span><el-button type="primary" plain @click="openWorkspace(row)">查看详情</el-button></div></article></div></div></div>
</template>
<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiRequest } from '../../services/http'
import { useRouter } from 'vue-router'
const projects = ref([]), loading = ref(false)
const router = useRouter()
const statusLabel = (v) => ({ draft: '草稿', active: '进行中', checking: '检查中', completed: '已结项', archived: '已归档', stopped: '已停止' }[v] || v)
async function load() { loading.value = true; try { projects.value = (await apiRequest('/projects?pageSize=100')).data } catch (e) { ElMessage.error(e.message) } finally { loading.value = false } }
function openWorkspace(row) { router.push(`/owner/projects/${row.id}`) }
onMounted(load)
</script>
