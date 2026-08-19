<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">归档模板</h2>
        <p class="page-desc">为所有项目设计同一套目录树，把子文件任务放入指定文件夹并设置归档文件名。</p>
      </div>
      <el-button type="primary" @click="openCreate"><el-icon><Plus /></el-icon>新建模板</el-button>
    </div>

    <section class="summary-strip section">
      <div v-for="item in summaries" :key="item.label" class="summary-item"><p class="summary-value">{{ item.value }}</p><p class="summary-label">{{ item.label }}</p></div>
    </section>

    <div class="panel">
      <div class="toolbar">
        <div class="filters">
          <el-input v-model="filters.keyword" clearable placeholder="搜索模板名称" @keyup.enter="searchTemplates"><template #prefix><el-icon><Search /></el-icon></template></el-input>
          <el-select v-model="filters.status" clearable placeholder="模板状态" style="width: 150px" @change="searchTemplates"><el-option label="启用" value="enabled" /><el-option label="停用" value="disabled" /></el-select>
          <el-button :loading="loading" @click="searchTemplates">查询</el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="templates" class="desktop-table" empty-text="暂无归档模板" style="width: 100%">
        <el-table-column prop="templateName" label="模板名称" min-width="190" />
        <el-table-column label="项目根目录" min-width="230"><template #default="{ row }">{{ projectRootRule(row) }}</template></el-table-column>
        <el-table-column label="目录 / 文件任务" width="150"><template #default="{ row }">{{ nodeStats(row).folders }} 个目录 / {{ nodeStats(row).tasks }} 个任务</template></el-table-column>
        <el-table-column label="保留空目录" width="105"><template #default="{ row }">{{ row.templateConfig.preserveEmptyFolders ? '是' : '否' }}</template></el-table-column>
        <el-table-column prop="updatedAt" label="更新时间" width="180"><template #default="{ row }">{{ formatTime(row.updatedAt) }}</template></el-table-column>
        <el-table-column prop="status" label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status === 'enabled' ? 'success' : 'info'">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="285" fixed="right"><template #default="{ row }"><el-button text @click="openEdit(row)">编辑</el-button><el-button text @click="showRowPreview(row)">预览</el-button><el-button text :type="row.status === 'enabled' ? 'warning' : 'success'" @click="toggleStatus(row)">{{ row.status === 'enabled' ? '停用' : '启用' }}</el-button><el-button text type="danger" @click="deleteTemplate(row)">删除</el-button></template></el-table-column>
      </el-table>

      <div class="mobile-card-list">
        <el-empty v-if="!templates.length && !loading" class="empty-mobile" description="暂无归档模板" :image-size="72" />
        <article v-for="row in templates" :key="row.id" class="mobile-data-card">
          <div class="mobile-card-header"><div><p class="mobile-card-title">{{ row.templateName }}</p><div class="mobile-card-meta"><span>{{ formatTime(row.updatedAt) }}</span></div></div><el-tag :type="row.status === 'enabled' ? 'success' : 'info'" size="small">{{ statusLabel(row.status) }}</el-tag></div>
          <div class="mobile-card-body"><div style="grid-column: 1 / -1"><span class="mobile-field-label">项目根目录</span><span class="mobile-field-value">{{ projectRootRule(row) }}</span></div><div><span class="mobile-field-label">目录</span><span class="mobile-field-value">{{ nodeStats(row).folders }} 个</span></div><div><span class="mobile-field-label">文件任务</span><span class="mobile-field-value">{{ nodeStats(row).tasks }} 个</span></div></div>
          <div class="mobile-card-footer"><el-button @click="openEdit(row)">编辑</el-button><el-button @click="showRowPreview(row)">预览</el-button><el-button :type="row.status === 'enabled' ? 'warning' : 'success'" @click="toggleStatus(row)">{{ row.status === 'enabled' ? '停用' : '启用' }}</el-button><el-button type="danger" plain @click="deleteTemplate(row)">删除</el-button></div>
        </article>
      </div>
      <div v-if="pagination.total" class="pagination-row"><el-pagination v-model:current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total" layout="total, prev, pager, next" @current-change="loadTemplates" /></div>
    </div>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑归档模板' : '新建归档模板'" width="1180px" class="archive-designer-dialog" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="94px" class="archive-basic-form">
        <el-form-item label="模板名称" prop="templateName"><el-input v-model.trim="form.templateName" maxlength="160" show-word-limit placeholder="例如：全校项目结项归档模板" /></el-form-item>
        <el-form-item label="模板状态"><el-switch v-model="form.enabled" active-text="启用" inactive-text="停用" /></el-form-item>
      </el-form>

      <el-alert v-if="form.legacyConverted" class="section" title="这是旧版平铺模板，已转换为项目目录树。请从右侧重新放置子文件任务后再保存。" type="warning" :closable="false" show-icon />

      <div class="archive-designer">
        <section class="archive-tree-panel">
          <header class="designer-panel-head"><div><strong>项目目录树</strong><p>同一棵目录树会套用到每个项目。</p></div><el-button plain @click="addFolder(null)"><el-icon><FolderAdd /></el-icon>新建根文件夹</el-button></header>
          <div class="project-root-editor">
            <el-icon><FolderOpened /></el-icon><span>每个项目</span><el-input v-model.trim="form.projectRootRule" aria-label="项目根目录命名规则" />
          </div>
          <div class="field-insert-row root-placeholder-toolbar"><span>项目根目录字段：</span><ArchivePlaceholderPicker :groups="rootPlaceholderGroups" button-text="选择项目字段" @select="insertRootToken" /></div>

          <div class="archive-tree-canvas" :class="{ 'is-empty': !form.nodes.length }" @dragover.prevent @drop="dropAtRoot">
            <ArchiveTreeNode v-for="(node, index) in form.nodes" :key="node.id" :node="node" :index="index" :count="form.nodes.length" :selected-id="selectedId" @select="selectedId = $event" @add-folder="addFolder" @move="moveNode" @remove="removeNode" @drop-node="handleDrop" />
            <div v-if="!form.nodes.length" class="archive-tree-empty"><el-icon><FolderAdd /></el-icon><strong>先创建文件夹</strong><span>也可以直接把右侧子任务拖到这里</span></div>
          </div>

          <div v-if="selectedNode" class="archive-property-editor">
            <div class="property-editor-title"><el-icon><EditPen /></el-icon>{{ selectedNode.type === 'folder' ? '文件夹命名' : '归档文件命名' }}</div>
            <el-input v-if="selectedNode.type === 'folder'" v-model.trim="selectedNode.nameRule" placeholder="固定文字和占位字段可组合" />
            <el-input v-else v-model.trim="selectedNode.fileNameRule" placeholder="系统会自动保留原扩展名" />
            <el-form-item v-if="selectedNode.type === 'task'" label="必填性" class="section">
              <el-radio-group v-model="selectedNode.requiredMode"><el-radio-button value="inherit">继承任务</el-radio-button><el-radio-button value="required">模板必填</el-radio-button><el-radio-button value="optional">模板选填</el-radio-button></el-radio-group>
              <p v-if="selectedNode.requiredReviewNeeded" class="danger-text">旧模板未保存必填性，当前按任务继承；请核对后保存。</p>
            </el-form-item>
            <div class="field-insert-row"><span>可用命名字段：</span><ArchivePlaceholderPicker :groups="placeholderGroups" @select="insertSelectedToken" /></div>
          </div>
        </section>

        <aside class="archive-library-panel">
          <header class="designer-panel-head"><div><strong>我的材料任务</strong><p>拖动子任务，手机端可点“加入”。</p></div><el-tag type="info">{{ assignedTaskIds.size }} 已放置</el-tag></header>
          <el-input v-model="libraryKeyword" clearable placeholder="搜索统筹任务或子任务"><template #prefix><el-icon><Search /></el-icon></template></el-input>
          <div v-loading="libraryLoading" class="archive-task-library">
            <section v-for="task in filteredLibrary" :key="task.id" class="library-task-group">
              <div class="library-group-title"><el-icon><Folder /></el-icon><div><strong>{{ task.taskName }}</strong><span>{{ taskStatusLabel(task.status) }}</span></div></div>
              <div v-for="fileTask in task.fileTasks" :key="fileTask.id" class="library-file-task" :class="{ 'is-assigned': assignedTaskIds.has(Number(fileTask.id)) }" :draggable="!assignedTaskIds.has(Number(fileTask.id))" @dragstart="startLibraryDrag($event, task, fileTask)">
                <el-icon><Document /></el-icon><div><strong>{{ fileTask.fileTaskName }}</strong><span>{{ fileTask.taskDescription || '单文件提交任务' }}</span></div>
                <el-button circle text :disabled="assignedTaskIds.has(Number(fileTask.id))" aria-label="加入所选文件夹" @click="addLibraryTask(task, fileTask)"><el-icon><Plus /></el-icon></el-button>
              </div>
            </section>
            <el-empty v-if="!filteredLibrary.length && !libraryLoading" description="没有匹配的子任务" :image-size="64" />
          </div>
        </aside>
      </div>

      <div class="archive-options-row"><el-switch v-model="form.preserveEmptyFolders" active-text="保留模板中的空文件夹" /><span>关闭时，只创建实际含审核通过文件的目录。</span></div>
      <section class="archive-preview-card" aria-live="polite">
        <div class="archive-preview-title"><el-icon><View /></el-icon>实时目录预览</div>
        <div class="preview-tree-lines"><code v-for="line in previewLines" :key="line">{{ line }}</code></div>
        <p>{{ assignedTaskIds.size ? '目录和文件名会随上方规则实时变化；文件扩展名沿用负责人提交的原文件。' : '已实时显示项目根目录和文件夹；从右侧放入子任务后会继续显示文件名。' }}</p>
      </section>

      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveTemplate">确认预览并保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="previewDialogVisible" title="模板目录树预览" width="760px">
      <section class="archive-preview-card is-dialog-preview"><div class="preview-tree-lines"><code v-for="line in selectedPreview.lines" :key="line">{{ line }}</code></div></section>
      <template #footer><el-button type="primary" @click="previewDialogVisible = false">关闭</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ArchivePlaceholderPicker from '../../components/ArchivePlaceholderPicker.vue'
import ArchiveTreeNode from '../../components/ArchiveTreeNode.vue'
import { apiRequest } from '../../services/http'

const placeholderGroups = [
  { label: '导出与排序', items: [
    { label: '项目序号', token: '{项目序号}', example: '1', rootAllowed: true },
    { label: '项目序号两位', token: '{项目序号两位}', example: '01', rootAllowed: true },
    { label: '项目序号三位', token: '{项目序号三位}', example: '001', rootAllowed: true },
    { label: '材料序号', token: '{材料序号}', example: '1', rootAllowed: false },
    { label: '材料序号两位', token: '{材料序号两位}', example: '01', rootAllowed: false },
    { label: '导出日期', token: '{导出日期}', example: '2026-08-06', rootAllowed: true },
    { label: '导出批次', token: '{导出批次}', example: 'ARCH-000123', rootAllowed: true }
  ] },
  { label: '项目信息', items: [
    { label: '年度', token: '{年度}', example: '2026', rootAllowed: true },
    { label: '组别', token: '{组别}', example: '创新组', rootAllowed: true },
    { label: '项目编号', token: '{项目编号}', example: 'CX2026-001', rootAllowed: true },
    { label: '作品名称', token: '{作品名称}', example: '智能校园材料管理系统', rootAllowed: true },
    { label: '项目类别', token: '{项目类别}', example: '科技创新类', rootAllowed: true },
    { label: '立项日期', token: '{立项日期}', example: '2026-03-15', rootAllowed: true }
  ] },
  { label: '负责人和团队', items: [
    { label: '负责人', token: '{负责人}', example: '张同学', rootAllowed: true },
    { label: '负责人学号工号', token: '{负责人学号工号}', example: '20260001', rootAllowed: true },
    { label: '负责人学院单位', token: '{负责人学院单位}', example: '计算机学院', rootAllowed: true },
    { label: '负责人电话', token: '{负责人电话}', example: '13800000000', rootAllowed: true },
    { label: '项目成员', token: '{项目成员}', example: '李同学、王同学', rootAllowed: true },
    { label: '指导教师', token: '{指导教师}', example: '赵老师', rootAllowed: true }
  ] },
  { label: '材料和审核', items: [
    { label: '材料任务', token: '{材料任务}', example: '结项材料', rootAllowed: false },
    { label: '材料类别', token: '{材料类别}', example: '项目申报书', rootAllowed: false },
    { label: '原文件名', token: '{原文件名}', example: '申报书终稿', rootAllowed: false },
    { label: '原扩展名', token: '{原扩展名}', example: 'docx', rootAllowed: false },
    { label: '提交日期', token: '{提交日期}', example: '2026-08-05', rootAllowed: false },
    { label: '审核通过日期', token: '{审核通过日期}', example: '2026-08-06', rootAllowed: false }
  ] }
]
const rootPlaceholderGroups = computed(() => placeholderGroups.map((group) => ({ ...group, items: group.items.filter((item) => item.rootAllowed) })).filter((group) => group.items.length))
const sampleValues = {
  项目序号: '1', 项目序号两位: '01', 项目序号三位: '001', 材料序号: '1', 材料序号两位: '01',
  导出日期: '2026-08-06', 导出批次: 'ARCH-000123', 年度: '2026', 组别: '创新组',
  项目编号: 'CX2026-001', 作品名称: '智能校园材料管理系统', 项目类别: '科技创新类', 立项日期: '2026-03-15',
  负责人: '张同学', 负责人学号工号: '20260001', 负责人学院单位: '计算机学院', 负责人电话: '13800000000',
  项目成员: '李同学、王同学', 指导教师: '赵老师', 材料任务: '结项材料', 材料类别: '项目申报书',
  原文件名: '申报书终稿', 原扩展名: 'docx', 提交日期: '2026-08-05', 审核通过日期: '2026-08-06'
}
const templates = ref([])
const taskLibrary = ref([])
const loading = ref(false)
const libraryLoading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const previewDialogVisible = ref(false)
const selectedPreview = reactive({ lines: [] })
const selectedId = ref('')
const libraryKeyword = ref('')
const formRef = ref()
const filters = reactive({ keyword: '', status: '' })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })
let nodeKey = 0
const uid = (prefix) => `${prefix}-${Date.now()}-${++nodeKey}`
const newForm = () => ({ id: null, templateName: '', enabled: true, projectRootRule: '{项目编号}-{作品名称}', preserveEmptyFolders: false, defaultFileNameRule: '{材料类别}_{原文件名}', nodes: [], legacyConverted: false })
const form = reactive(newForm())
const rules = { templateName: [{ required: true, message: '请输入模板名称', trigger: 'blur' }] }

const summaries = computed(() => [
  { label: '模板总数', value: pagination.total || templates.value.length },
  { label: '本页启用', value: templates.value.filter((item) => item.status === 'enabled').length },
  { label: '本页停用', value: templates.value.filter((item) => item.status === 'disabled').length },
  { label: '可用子任务', value: taskLibrary.value.reduce((total, item) => total + item.fileTasks.length, 0) },
])

function walk(nodes, callback, parent = null) {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (callback(node, nodes, index, parent) === false) return false
    if (node.type === 'folder' && walk(node.children, callback, node) === false) return false
  }
  return true
}

function findNode(id) {
  let found = null
  walk(form.nodes, (node, nodes, index, parent) => {
    if (node.id === id) { found = { node, nodes, index, parent }; return false }
  })
  return found
}

const selectedNode = computed(() => findNode(selectedId.value)?.node || null)
const assignedTaskIds = computed(() => {
  const ids = new Set()
  walk(form.nodes, (node) => { if (node.type === 'task') ids.add(Number(node.fileTaskId)) })
  return ids
})
const filteredLibrary = computed(() => {
  const keyword = libraryKeyword.value.trim().toLowerCase()
  if (!keyword) return taskLibrary.value
  return taskLibrary.value.map((task) => ({ ...task, fileTasks: task.fileTasks.filter((item) => [task.taskName, item.fileTaskName, item.taskDescription].some((value) => String(value || '').toLowerCase().includes(keyword))) })).filter((task) => task.fileTasks.length)
})

function cleanComponent(value) {
  let result = String(value || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim()
  if (!result || result === '.' || result === '..') result = '未命名'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(result)) result = `_${result}`
  return result.slice(0, 120)
}
const renderPattern = (pattern, values = sampleValues) => cleanComponent(String(pattern || '').replace(/\{([^{}]+)\}/g, (_match, key) => values[key] || ''))

function previewEntries(nodes, folders = [], lines = [], sequence = { value: 0 }) {
  for (const node of nodes) {
    if (node.type === 'folder') {
      const folderName = renderPattern(node.nameRule)
      lines.push({ depth: folders.length + 1, text: `${folderName}/` })
      previewEntries(node.children, [...folders, folderName], lines, sequence)
    } else {
      sequence.value += 1
      const values = { ...sampleValues, 材料序号: String(sequence.value), 材料序号两位: String(sequence.value).padStart(2, '0'), 材料任务: node.materialTaskName || sampleValues.材料任务, 材料类别: node.fileTaskName || sampleValues.材料类别 }
      lines.push({ depth: folders.length + 1, text: `${renderPattern(node.fileNameRule || form.defaultFileNameRule, values)}.docx` })
    }
  }
  return lines
}
const previewLines = computed(() => {
  const rows = [`${renderPattern(form.projectRootRule)}/`]
  for (const item of previewEntries(form.nodes)) rows.push(`${'  '.repeat(item.depth)}${item.text}`)
  return rows
})

function queryParams() {
  const query = new URLSearchParams({ page: pagination.page, pageSize: pagination.pageSize })
  if (filters.keyword) query.set('keyword', filters.keyword)
  if (filters.status) query.set('status', filters.status)
  return query
}
async function loadTemplates() {
  loading.value = true
  try { const response = await apiRequest(`/archive-templates?${queryParams()}`); templates.value = response.data; Object.assign(pagination, response.pagination) }
  catch (error) { ElMessage.error(error.message) } finally { loading.value = false }
}
async function loadTaskLibrary() {
  libraryLoading.value = true
  try { taskLibrary.value = (await apiRequest('/archive-templates/task-library')).data }
  catch (error) { ElMessage.error(error.message) } finally { libraryLoading.value = false }
}
function searchTemplates() { pagination.page = 1; loadTemplates() }
async function openCreate() { Object.assign(form, newForm()); selectedId.value = ''; libraryKeyword.value = ''; dialogVisible.value = true; await loadTaskLibrary() }

function legacyToV2(config) {
  let children = []
  const levels = (config.directoryLevels || []).filter((level) => !String(level.pattern).includes('{项目编号}') && !String(level.pattern).includes('{作品名称}'))
  for (let index = levels.length - 1; index >= 0; index -= 1) children = [{ id: uid('folder'), type: 'folder', nameRule: levels[index].pattern, children }]
  return { projectRootRule: '{项目编号}-{作品名称}', preserveEmptyFolders: false, defaultFileNameRule: config.fileNameRule || '{材料类别}_{原文件名}', nodes: children, legacyConverted: true }
}
async function openEdit(row) {
  try {
    // templateConfig comes from a reactive table row. structuredClone cannot
    // clone Vue Proxy objects, while the JSON round-trip safely produces the
    // plain data structure required by the editor.
    const rawConfig = JSON.parse(JSON.stringify(row.templateConfig || {}))
    const config = Number(rawConfig.version) >= 2 ? rawConfig : legacyToV2(rawConfig)
    Object.assign(form, newForm(), config, { id: row.id, templateName: row.templateName, enabled: row.status === 'enabled' })
    selectedId.value = ''; libraryKeyword.value = ''; dialogVisible.value = true; await loadTaskLibrary()
  } catch (error) {
    ElMessage.error(error.message || '模板数据读取失败，请刷新后重试')
  }
}
function resetForm() { formRef.value?.clearValidate(); selectedId.value = '' }

function addFolder(parentId) {
  const node = { id: uid('folder'), type: 'folder', nameRule: '新建文件夹', children: [] }
  if (parentId) {
    const parent = findNode(parentId)?.node
    if (parent?.type === 'folder') parent.children.push(node)
  } else form.nodes.push(node)
  selectedId.value = node.id
}
function moveNode(id, offset) {
  const found = findNode(id); if (!found) return
  const target = found.index + offset; if (target < 0 || target >= found.nodes.length) return
  const [node] = found.nodes.splice(found.index, 1); found.nodes.splice(target, 0, node)
}
async function removeNode(id) {
  const found = findNode(id); if (!found) return
  const taskCount = countNodes(found.node).tasks
  try {
    if (found.node.type === 'folder' && taskCount) await ElMessageBox.confirm(`该目录包含 ${taskCount} 个已放置子任务，确认一起移除吗？`, '移除目录', { type: 'warning' })
    found.nodes.splice(found.index, 1); if (selectedId.value === id) selectedId.value = ''
  } catch (error) { if (error !== 'cancel') ElMessage.error(error.message || '操作失败') }
}
function countNodes(root) {
  const stats = { folders: 0, tasks: 0 }
  const nodes = Array.isArray(root) ? root : [root]
  walk(nodes, (node) => { stats[node.type === 'folder' ? 'folders' : 'tasks'] += 1 })
  return stats
}
function containsNode(root, id) {
  let contains = false
  walk([root], (node) => { if (node.id === id) { contains = true; return false } })
  return contains
}
function makeTaskNode(task, fileTask) {
  return { id: uid('task'), type: 'task', materialTaskId: Number(task.id), fileTaskId: Number(fileTask.id), materialTaskName: task.taskName, fileTaskName: fileTask.fileTaskName, fileNameRule: '{材料类别}_{原文件名}', requiredMode: 'inherit', requiredReviewNeeded: false }
}
function insertNode(node, targetId, mode) {
  if (!targetId) form.nodes.push(node)
  else {
    const target = findNode(targetId)
    if (!target) return form.nodes.push(node)
    if (mode === 'inside' && target.node.type === 'folder') target.node.children.push(node)
    else target.nodes.splice(target.index, 0, node)
  }
  selectedId.value = node.id
}
function handleDrop({ payload, targetId, mode }) {
  if (payload.kind === 'library-task') {
    if (assignedTaskIds.value.has(Number(payload.fileTask.id))) return ElMessage.warning('这个子任务已经放入模板')
    insertNode(makeTaskNode(payload.task, payload.fileTask), targetId, mode); return
  }
  const source = findNode(payload.nodeId)
  if (!source || source.node.id === targetId || containsNode(source.node, targetId)) return
  const moving = source.node
  source.nodes.splice(source.index, 1)
  insertNode(moving, targetId, mode)
}
function dragPayload(event) {
  try { return JSON.parse(event.dataTransfer.getData('application/x-archive-node') || event.dataTransfer.getData('text/plain')) } catch { return null }
}
function dropAtRoot(event) {
  const payload = dragPayload(event); if (!payload) return
  handleDrop({ payload, targetId: null, mode: 'inside' })
}
function startLibraryDrag(event, task, fileTask) {
  event.dataTransfer.effectAllowed = 'copy'
  const payload = JSON.stringify({ kind: 'library-task', task, fileTask })
  event.dataTransfer.setData('application/x-archive-node', payload)
  event.dataTransfer.setData('text/plain', payload)
}
function addLibraryTask(task, fileTask) {
  if (assignedTaskIds.value.has(Number(fileTask.id))) return
  const selected = selectedNode.value
  if (!selected || selected.type !== 'folder') return ElMessage.warning('请先在左侧选择要放入的文件夹')
  insertNode(makeTaskNode(task, fileTask), selected.id, 'inside')
}
function insertSelectedToken(token) {
  if (!selectedNode.value) return
  if (selectedNode.value.type === 'folder') selectedNode.value.nameRule += token
  else selectedNode.value.fileNameRule += token
}
function insertRootToken(token) { form.projectRootRule += token }

function configOf() {
  return { version: 2, projectRootRule: form.projectRootRule.trim(), preserveEmptyFolders: form.preserveEmptyFolders, defaultFileNameRule: form.defaultFileNameRule, nodes: form.nodes }
}
async function saveTemplate() {
  if (!(await formRef.value?.validate().catch(() => false))) return
  if (!form.projectRootRule.trim()) return ElMessage.warning('请填写项目根目录命名规则')
  if (!assignedTaskIds.value.size) return ElMessage.warning('请至少把一个子文件任务放入目录树')
  let invalid = false
  walk(form.nodes, (node) => { if ((node.type === 'folder' && !node.nameRule.trim()) || (node.type === 'task' && !node.fileNameRule.trim())) invalid = true })
  if (invalid) return ElMessage.warning('目录名和文件命名规则不能为空')
  saving.value = true
  try {
    await apiRequest(form.id ? `/archive-templates/${form.id}` : '/archive-templates', { method: form.id ? 'PUT' : 'POST', body: { templateName: form.templateName, status: form.enabled ? 'enabled' : 'disabled', templateConfig: configOf() } })
    ElMessage.success(form.id ? '归档模板已更新' : '归档模板已创建'); dialogVisible.value = false; await loadTemplates()
  } catch (error) { ElMessage.error(error.message) } finally { saving.value = false }
}
async function toggleStatus(row) {
  const status = row.status === 'enabled' ? 'disabled' : 'enabled'
  try { await ElMessageBox.confirm(`确认${status === 'enabled' ? '启用' : '停用'}模板“${row.templateName}”吗？`, '模板状态', { type: 'warning' }); await apiRequest(`/archive-templates/${row.id}/status`, { method: 'PATCH', body: { status } }); ElMessage.success('模板状态已更新'); await loadTemplates() }
  catch (error) { if (error !== 'cancel') ElMessage.error(error.message || '操作失败') }
}
async function deleteTemplate(row) {
  try {
    await ElMessageBox.confirm(
      `确认删除模板“${row.templateName}”吗？删除后不能再用于新建导出，已有导出记录不受影响。`,
      '删除归档模板',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
    await apiRequest(`/archive-templates/${row.id}`, { method: 'DELETE' })
    ElMessage.success('归档模板已删除')
    if (templates.value.length === 1 && pagination.page > 1) pagination.page -= 1
    await loadTemplates()
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(error.message || '删除失败')
  }
}
async function showRowPreview(row) {
  try {
    const response = await apiRequest('/archive-templates/preview', { method: 'POST', body: { templateConfig: row.templateConfig } })
    const data = response.data
    selectedPreview.lines = data.entries?.length ? [`${data.projectRoot}/`, ...data.entries.map((item) => `  ${item.directory.replace(`${data.projectRoot}/`, '')}/${item.fileName}`)] : [`${data.directory}/`, `  ${data.fileName}`]
    previewDialogVisible.value = true
  } catch (error) { ElMessage.error(error.message) }
}
const nodeStats = (row) => row.templateConfig.version >= 2 ? countNodes(row.templateConfig.nodes) : { folders: row.templateConfig.directoryLevels.length, tasks: 0 }
const projectRootRule = (row) => row.templateConfig.version >= 2 ? row.templateConfig.projectRootRule : '旧版平铺目录'
const statusLabel = (value) => ({ enabled: '启用', disabled: '停用' }[value] || value)
const taskStatusLabel = (value) => ({ draft: '草稿', published: '收集中', closed: '已关闭' }[value] || value)
const formatTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'

onMounted(async () => { await Promise.all([loadTemplates(), loadTaskLibrary()]) })
</script>
