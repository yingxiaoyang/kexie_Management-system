<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">项目数据报表设计器</h2>
        <p class="page-desc">在模拟 Excel 网格中设计一个项目区块，导出时按项目实际成员、老师和检查记录数量自动展开。</p>
      </div>
      <div class="page-actions">
        <el-button @click="openExportDialog"><el-icon><Download /></el-icon>发起导出</el-button>
        <el-button type="primary" @click="saveDesign"><el-icon><DocumentChecked /></el-icon>保存方案</el-button>
      </div>
    </div>

    <section class="summary-strip section">
      <div v-for="item in summaries" :key="item.label" class="summary-item">
        <p class="summary-value">{{ item.value }}</p>
        <p class="summary-label">{{ item.label }}</p>
      </div>
    </section>

    <section class="report-mobile-export panel section">
      <div class="panel-body">
        <div class="panel-heading">
          <div>
            <h3 class="panel-title">手机端导出</h3>
            <p class="panel-subtitle">手机端可查看方案并发起导出，复杂网格编辑请在电脑端完成。</p>
          </div>
          <el-button type="primary" @click="openExportDialog"><el-icon><Download /></el-icon>导出</el-button>
        </div>
        <el-table :data="designs" empty-text="暂无可复用方案" style="width: 100%; margin-top: 14px">
          <el-table-column prop="designName" label="方案名称" min-width="160" />
          <el-table-column prop="status" label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status === 'enabled' ? 'success' : 'info'">{{ row.status === 'enabled' ? '启用' : '停用' }}</el-tag></template></el-table-column>
        </el-table>
      </div>
    </section>

    <section class="desktop-report-designer">
      <div class="report-designer-layout">
        <aside class="report-side panel">
          <div class="panel-body">
            <el-tabs v-model="sideTab">
              <el-tab-pane label="字段库" name="fields">
                <el-input v-model="fieldKeyword" clearable placeholder="搜索字段" />
                <div class="report-field-groups">
                  <div v-for="group in filteredFieldGroups" :key="group.key" class="report-field-group">
                    <p>{{ group.label }}</p>
                    <button
                      v-for="field in group.fields"
                      :key="field.key"
                      class="report-field-pill"
                      draggable="true"
                      @click="applyField(field.key)"
                      @dragstart="onFieldDrag(field.key, $event)"
                    >
                      {{ field.label }}
                    </button>
                  </div>
                </div>
              </el-tab-pane>
              <el-tab-pane label="方案" name="designs">
                <el-input v-model="filters.keyword" clearable placeholder="搜索方案" @change="loadDesigns" />
                <div class="report-design-list">
                  <article v-for="item in designs" :key="item.id" class="report-design-item" @click="loadDesign(item)">
                    <strong>{{ item.designName }}</strong>
                    <span>{{ formatTime(item.updatedAt) }}</span>
                  </article>
                  <el-empty v-if="!designs.length" description="暂无方案" :image-size="68" />
                </div>
              </el-tab-pane>
            </el-tabs>
          </div>
        </aside>

        <main class="report-canvas panel">
          <div class="report-toolbar">
            <el-input v-model="designName" placeholder="方案名称" style="width: 220px" />
            <el-segmented v-model="config.export.layout" :options="layoutOptions" />
            <el-input-number v-model="config.export.gapRows" :min="0" :max="20" controls-position="right" />
            <el-button-group>
              <el-tooltip content="撤销"><el-button :disabled="!undoStack.length" @click="undo"><el-icon><RefreshLeft /></el-icon></el-button></el-tooltip>
              <el-tooltip content="重做"><el-button :disabled="!redoStack.length" @click="redo"><el-icon><RefreshRight /></el-icon></el-button></el-tooltip>
            </el-button-group>
            <el-button @click="requestPreview"><el-icon><View /></el-icon>动态预览</el-button>
          </div>

          <div class="report-formatbar">
            <el-button-group>
              <el-button :type="selectedStyle.bold ? 'primary' : 'default'" @click="toggleStyle('bold')"><strong>B</strong></el-button>
              <el-button :type="selectedStyle.wrap ? 'primary' : 'default'" @click="toggleStyle('wrap')"><el-icon><Fold /></el-icon></el-button>
              <el-button :type="selectedStyle.border ? 'primary' : 'default'" @click="toggleStyle('border')"><el-icon><Grid /></el-icon></el-button>
            </el-button-group>
            <el-input-number v-model="selectedStyle.fontSize" :min="8" :max="36" controls-position="right" @change="setStyle('fontSize', selectedStyle.fontSize)" />
            <el-color-picker v-model="styleColor" @change="setStyle('color', colorWithoutHash(styleColor))" />
            <el-color-picker v-model="styleFill" @change="setStyle('fill', colorWithoutHash(styleFill))" />
            <el-select v-model="selectedStyle.align" style="width: 116px" @change="setStyle('align', selectedStyle.align)">
              <el-option label="左对齐" value="left" /><el-option label="居中" value="center" /><el-option label="右对齐" value="right" />
            </el-select>
            <el-button @click="mergeSelection"><el-icon><Connection /></el-icon>合并</el-button>
            <el-button @click="unmergeSelection"><el-icon><Crop /></el-icon>取消合并</el-button>
          </div>

          <div class="report-formatbar">
            <el-button @click="insertRow"><el-icon><Plus /></el-icon>插入行</el-button>
            <el-button @click="deleteRow"><el-icon><Delete /></el-icon>删除行</el-button>
            <el-button @click="insertColumn"><el-icon><Plus /></el-icon>插入列</el-button>
            <el-button @click="deleteColumn"><el-icon><Delete /></el-icon>删除列</el-button>
            <el-button @click="moveRow(-1)"><el-icon><Top /></el-icon>行上移</el-button>
            <el-button @click="moveRow(1)"><el-icon><Bottom /></el-icon>行下移</el-button>
            <el-input-number v-model="selectedRowHeight" :min="12" :max="120" controls-position="right" @change="setRowHeight" />
            <el-input-number v-model="selectedColumnWidth" :min="6" :max="60" controls-position="right" @change="setColumnWidth" />
          </div>

          <div class="excel-scroll">
            <table class="excel-grid" @mouseup="dragSelecting = false">
              <thead>
                <tr>
                  <th class="excel-corner"></th>
                  <th v-for="col in config.sheet.columnCount" :key="col" :style="{ width: `${columnWidth(col) * 8}px` }">{{ columnLabel(col) }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in config.sheet.rowCount" :key="row" :style="{ height: `${rowHeight(row)}px` }">
                  <th class="excel-row-head">{{ row }}</th>
                  <td
                    v-for="col in config.sheet.columnCount"
                    :key="`${row}-${col}`"
                    :class="cellClass(row, col)"
                    :style="cellCss(row, col)"
                    @mousedown="startSelect(row, col)"
                    @mouseenter="extendSelect(row, col)"
                    @dragover.prevent
                    @drop="dropField(row, col, $event)"
                  >
                    <span>{{ displayCell(row, col) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </main>

        <aside class="report-side panel">
          <div class="panel-body">
            <h3 class="panel-title">单元格</h3>
            <el-form label-width="78px" class="report-property-form">
              <el-form-item label="固定文字"><el-input v-model="currentCell.value" type="textarea" :rows="3" @input="setCellText" /></el-form-item>
              <el-form-item label="绑定字段"><el-select v-model="currentCell.fieldKey" clearable filterable style="width: 100%" @change="setCellField"><el-option v-for="field in allFields" :key="field.key" :label="`${field.groupLabel} / ${field.label}`" :value="field.key" /></el-select></el-form-item>
              <el-form-item label="多条数据"><el-select v-model="currentCell.fieldMode" style="width: 100%" @change="setCellMode"><el-option label="单项/区域逐行" value="single" /><el-option label="单格汇总" value="summary" /><el-option label="单格换行" value="lines" /></el-select></el-form-item>
              <template v-if="isCollectionCell">
                <el-form-item label="条目模板">
                  <el-input v-model="currentCell.itemTemplate" placeholder="例如：{姓名}（{学号}）" @input="setCellCollectionOption('itemTemplate', currentCell.itemTemplate)" />
                  <p class="table-note">可用占位：{{ collectionTemplateHint }}</p>
                </el-form-item>
                <el-form-item label="条目间隔">
                  <el-select v-model="currentCell.itemSeparator" allow-create filterable clearable style="width: 100%" @change="setCellCollectionOption('itemSeparator', currentCell.itemSeparator)">
                    <el-option label="顿号：、" value="、" />
                    <el-option label="分号：；" value="；" />
                    <el-option label="逗号：，" value="，" />
                    <el-option label="空格" value=" " />
                    <el-option label="换行" :value="'\n'" />
                  </el-select>
                </el-form-item>
                <el-form-item label="空数据">
                  <el-input v-model="currentCell.emptyText" placeholder="例如：无" @input="setCellCollectionOption('emptyText', currentCell.emptyText)" />
                </el-form-item>
              </template>
            </el-form>

            <el-divider />
            <h3 class="panel-title">重复区域</h3>
            <el-form label-width="78px" class="report-property-form">
              <el-form-item label="区域类型"><el-select v-model="repeatForm.type" style="width: 100%"><el-option label="项目成员" value="members" /><el-option label="指导老师" value="advisors" /><el-option label="检查记录" value="checks" /><el-option label="材料信息" value="materials" /></el-select></el-form-item>
              <el-form-item label="空数据"><el-select v-model="repeatForm.emptyMode" style="width: 100%"><el-option label="保留空白" value="keepBlank" /><el-option label="显示无" value="noneText" /><el-option label="不生成行" value="blank" /></el-select></el-form-item>
              <el-button style="width: 100%" @click="setRepeatRegion">将当前选区设为重复区域</el-button>
            </el-form>
            <div class="repeat-region-list">
              <el-tag v-for="region in config.repeatRegions" :key="region.id" closable @close="removeRepeatRegion(region.id)">
                {{ repeatLabel(region.type) }} {{ region.startRow }}-{{ region.endRow }}
              </el-tag>
            </div>

            <el-divider />
            <h3 class="panel-title">动态预览</h3>
            <el-select v-model="previewProjectId" filterable clearable placeholder="选择真实项目" style="width: 100%; margin: 10px 0">
              <el-option v-for="project in options.projects" :key="project.id" :label="`${project.projectCode}｜${project.title}`" :value="project.id" />
            </el-select>
            <div class="report-preview-grid">
              <table v-if="previewRows.length">
                <tr v-for="row in previewRows" :key="row.rowNumber"><td v-for="(cell, index) in row.cells" :key="index">{{ cell }}</td></tr>
              </table>
              <el-empty v-else description="点击动态预览" :image-size="64" />
            </div>
          </div>
        </aside>
      </div>
    </section>

    <section class="panel section">
      <div class="toolbar">
        <div class="filters">
          <el-select v-model="exportFilters.status" clearable placeholder="导出状态" style="width: 150px" @change="loadExportRecords">
            <el-option label="排队中" value="queued" /><el-option label="生成中" value="processing" /><el-option label="成功" value="success" /><el-option label="失败" value="failed" />
          </el-select>
          <el-button :loading="recordsLoading" @click="loadExportRecords"><el-icon><Refresh /></el-icon>刷新记录</el-button>
        </div>
      </div>
      <el-table v-loading="recordsLoading" :data="exportRecords" class="desktop-table" empty-text="暂无报表导出记录" style="width: 100%">
        <el-table-column label="批次" width="135"><template #default="{ row }">{{ reportBatch(row) }}</template></el-table-column>
        <el-table-column prop="designName" label="方案" min-width="150" />
        <el-table-column prop="exportScopeLabel" label="范围" min-width="220" show-overflow-tooltip />
        <el-table-column prop="exportLayout" label="布局" width="110"><template #default="{ row }">{{ row.exportLayout === 'sheets' ? '项目分工作表' : '连续排列' }}</template></el-table-column>
        <el-table-column label="状态" width="86"><template #default="{ row }"><el-tag :type="statusType(row.exportStatus)">{{ statusLabel(row.exportStatus) }}</el-tag></template></el-table-column>
        <el-table-column label="项目数" width="90"><template #default="{ row }">{{ row.exportSummary?.projectCount || '-' }}</template></el-table-column>
        <el-table-column label="创建时间" width="165"><template #default="{ row }">{{ formatTime(row.createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="170" fixed="right"><template #default="{ row }"><el-button text @click="showExportDetail(row)">详情</el-button><el-button v-if="row.exportStatus === 'failed'" text type="warning" @click="retryExport(row)">重试</el-button><el-button text type="primary" :disabled="!row.downloadable" @click="downloadExport(row)">下载</el-button></template></el-table-column>
      </el-table>
      <div v-if="exportPagination.total" class="pagination-row"><el-pagination v-model:current-page="exportPagination.page" :page-size="exportPagination.pageSize" :total="exportPagination.total" layout="total, prev, pager, next" @current-change="loadExportRecords" /></div>
    </section>

    <el-dialog v-model="exportDialogVisible" title="发起项目数据报表导出" width="760px">
      <el-form label-width="104px" class="export-scope-form">
        <el-form-item label="导出来源"><el-radio-group v-model="exportForm.source"><el-radio-button label="current">当前设计</el-radio-button><el-radio-button label="saved">已保存方案</el-radio-button></el-radio-group></el-form-item>
        <el-form-item v-if="exportForm.source === 'saved'" label="报表方案"><el-select v-model="exportForm.reportDesignId" filterable style="width: 100%"><el-option v-for="item in options.designs" :key="item.id" :label="item.designName" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="导出布局"><el-radio-group v-model="exportForm.layout"><el-radio-button label="continuous">同一工作表连续排列</el-radio-button><el-radio-button label="sheets">每项目独立工作表</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="年度"><el-select v-model="exportForm.years" multiple clearable collapse-tags style="width: 100%"><el-option v-for="year in options.years" :key="year" :label="`${year} 年`" :value="year" /></el-select></el-form-item>
        <el-form-item label="组别"><el-select v-model="exportForm.groups" multiple clearable collapse-tags style="width: 100%"><el-option v-for="group in options.groups" :key="group" :label="group" :value="group" /></el-select></el-form-item>
        <el-form-item label="指定项目"><el-select v-model="exportForm.projectIds" multiple clearable filterable collapse-tags style="width: 100%"><el-option v-for="project in filteredExportProjects" :key="project.id" :label="`${project.projectCode}｜${project.title}`" :value="project.id" /></el-select></el-form-item>
        <el-form-item label="备注"><el-input v-model="exportForm.remark" type="textarea" :rows="3" maxlength="1000" show-word-limit /></el-form-item>
      </el-form>
      <template #footer><el-button @click="exportDialogVisible = false">取消</el-button><el-button type="primary" :loading="exporting" @click="createExport">加入导出队列</el-button></template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="报表导出详情" width="660px">
      <el-descriptions v-if="selectedExport" :column="1" border>
        <el-descriptions-item label="批次">{{ reportBatch(selectedExport) }}</el-descriptions-item>
        <el-descriptions-item label="方案">{{ selectedExport.designName }}</el-descriptions-item>
        <el-descriptions-item label="范围">{{ selectedExport.exportScopeLabel }}</el-descriptions-item>
        <el-descriptions-item label="状态"><el-tag :type="statusType(selectedExport.exportStatus)">{{ statusLabel(selectedExport.exportStatus) }}</el-tag></el-descriptions-item>
        <el-descriptions-item label="尝试次数">{{ selectedExport.attemptCount || 0 }} / {{ selectedExport.maxAttempts || 3 }}</el-descriptions-item>
        <el-descriptions-item label="统计">{{ selectedExport.exportSummary ? `项目 ${selectedExport.exportSummary.projectCount} 个，文件 ${formatFileSize(selectedExport.exportSummary.fileSize)}` : '生成完成后显示' }}</el-descriptions-item>
        <el-descriptions-item v-if="selectedExport.failureReason" label="失败原因"><span class="danger-text">{{ selectedExport.failureReason }}</span></el-descriptions-item>
        <el-descriptions-item label="创建 / 完成">{{ formatTime(selectedExport.createdAt) }} / {{ formatTime(selectedExport.finishedAt) }}</el-descriptions-item>
      </el-descriptions>
      <template #footer><el-button @click="detailVisible = false">关闭</el-button><el-button v-if="selectedExport?.exportStatus === 'failed'" type="warning" @click="retryExport(selectedExport)">重试</el-button><el-button type="primary" :disabled="!selectedExport?.downloadable" @click="downloadExport(selectedExport)">下载 Excel</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { apiRequest, downloadFile } from '../../services/http'

const sideTab = ref('fields')
const designName = ref('项目数据报表方案')
const designId = ref(null)
const config = reactive(emptyConfig())
const designs = ref([])
const fieldGroups = ref([])
const fieldKeyword = ref('')
const previewRows = ref([])
const previewProjectId = ref(null)
const undoStack = ref([])
const redoStack = ref([])
const dragSelecting = ref(false)
const selected = reactive({ startRow: 1, startCol: 1, endRow: 1, endCol: 1 })
const repeatForm = reactive({ type: 'members', emptyMode: 'noneText' })
const filters = reactive({ keyword: '' })
const options = reactive({ years: [], groups: [], projects: [], designs: [] })
const exportRecords = ref([])
const recordsLoading = ref(false)
const exportFilters = reactive({ status: '' })
const exportPagination = reactive({ page: 1, pageSize: 20, total: 0 })
const exportDialogVisible = ref(false)
const exporting = ref(false)
const detailVisible = ref(false)
const selectedExport = ref(null)
const exportForm = reactive(newExportForm())
let pollingTimer

const layoutOptions = [{ label: '连续排列', value: 'continuous' }, { label: '独立工作表', value: 'sheets' }]
const allFields = computed(() => fieldGroups.value.flatMap((group) => group.fields.map((field) => ({ ...field, groupLabel: group.label, groupKey: group.key }))))
const filteredFieldGroups = computed(() => {
  const keyword = fieldKeyword.value.trim()
  if (!keyword) return fieldGroups.value
  return fieldGroups.value.map((group) => ({ ...group, fields: group.fields.filter((field) => `${group.label}${field.label}${field.key}`.includes(keyword)) })).filter((group) => group.fields.length)
})
const summaries = computed(() => [
  { label: '已保存方案', value: designs.value.length },
  { label: '网格规模', value: `${config.sheet.rowCount} x ${config.sheet.columnCount}` },
  { label: '重复区域', value: config.repeatRegions.length },
  { label: '本页导出', value: exportRecords.value.length },
])
const range = computed(() => ({
  top: Math.min(selected.startRow, selected.endRow),
  bottom: Math.max(selected.startRow, selected.endRow),
  left: Math.min(selected.startCol, selected.endCol),
  right: Math.max(selected.startCol, selected.endCol),
}))
const currentCell = computed(() => getCell(selected.endRow, selected.endCol, true))
const collectionGroups = new Set(['members', 'advisors', 'checks', 'materials'])
const selectedFieldGroup = computed(() => String(currentCell.value.fieldKey || '').split('.')[0])
const isCollectionCell = computed(() => collectionGroups.has(selectedFieldGroup.value) && ['summary', 'lines'].includes(currentCell.value.fieldMode))
const collectionTemplateHint = computed(() => ({
  members: '{姓名} {学院} {学号} {电话} {QQ}',
  advisors: '{姓名} {工号} {单位} {联系方式} {职称} {邮箱}',
  checks: '{阶段} {日志数量} {评级} {检查时间}',
  materials: '{任务} {材料类别} {提交状态} {审核状态} {最后提交时间}',
}[selectedFieldGroup.value] || ''))
const selectedStyle = reactive({ bold: false, wrap: true, border: true, fontSize: 11, color: '', fill: '', align: 'left' })
const styleColor = ref('#172033')
const styleFill = ref('#FFFFFF')
const selectedRowHeight = ref(22)
const selectedColumnWidth = ref(14)
const filteredExportProjects = computed(() => options.projects.filter((item) => (!exportForm.years.length || exportForm.years.includes(Number(item.projectYear))) && (!exportForm.groups.length || exportForm.groups.includes(item.projectGroup))))

function emptyConfig() {
  return { version: 1, sheet: { rowCount: 14, columnCount: 8, rows: [], columns: [] }, cells: [], merges: [], repeatRegions: [], export: { layout: 'continuous', gapRows: 1, sheetNameRule: '{项目编号}-{作品名称}' } }
}

function newExportForm() {
  return { source: 'current', reportDesignId: null, layout: 'continuous', years: [], groups: [], projectIds: [], remark: '' }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function replaceConfig(nextConfig) {
  Object.assign(config, emptyConfig(), clone(nextConfig))
}

function pushHistory() {
  undoStack.value.push(clone(config))
  if (undoStack.value.length > 50) undoStack.value.shift()
  redoStack.value = []
}

function undo() {
  if (!undoStack.value.length) return
  redoStack.value.push(clone(config))
  replaceConfig(undoStack.value.pop())
}

function redo() {
  if (!redoStack.value.length) return
  undoStack.value.push(clone(config))
  replaceConfig(redoStack.value.pop())
}

function columnLabel(index) {
  let value = index
  let label = ''
  while (value > 0) {
    const modulo = (value - 1) % 26
    label = String.fromCharCode(65 + modulo) + label
    value = Math.floor((value - modulo) / 26)
  }
  return label
}

function getCell(row, col, create = false) {
  let cell = config.cells.find((item) => item.row === row && item.col === col)
  if (!cell && create) {
    cell = { row, col, value: '', fieldKey: '', fieldMode: 'single', itemTemplate: '', itemSeparator: '', emptyText: '', style: { border: true, wrap: true } }
    config.cells.push(cell)
  }
  return cell || { row, col, value: '', fieldKey: '', fieldMode: 'single', itemTemplate: '', itemSeparator: '', emptyText: '', style: {} }
}

function displayCell(row, col) {
  const cell = getCell(row, col)
  if (cell.fieldKey) {
    const field = allFields.value.find((item) => item.key === cell.fieldKey)
    return `{${field?.label || cell.fieldKey}}`
  }
  return cell.value || ''
}

function selectedMerge(row, col) {
  return config.merges.find((merge) => row >= merge.startRow && row <= merge.endRow && col >= merge.startCol && col <= merge.endCol)
}

function cellClass(row, col) {
  const active = row >= range.value.top && row <= range.value.bottom && col >= range.value.left && col <= range.value.right
  return { selected: active, merged: Boolean(selectedMerge(row, col)), repeat: Boolean(config.repeatRegions.find((region) => row >= region.startRow && row <= region.endRow)) }
}

function cellCss(row, col) {
  const style = getCell(row, col).style || {}
  return {
    width: `${columnWidth(col) * 8}px`,
    minWidth: `${columnWidth(col) * 8}px`,
    color: style.color ? `#${style.color}` : undefined,
    background: style.fill ? `#${style.fill}` : undefined,
    fontWeight: style.bold ? 800 : 400,
    textAlign: style.align || 'left',
    whiteSpace: style.wrap === false ? 'nowrap' : 'pre-wrap',
  }
}

function rowHeight(row) {
  return config.sheet.rows.find((item) => item.index === row)?.height || 22
}

function columnWidth(col) {
  return config.sheet.columns.find((item) => item.index === col)?.width || 14
}

function startSelect(row, col) {
  selected.startRow = row
  selected.startCol = col
  selected.endRow = row
  selected.endCol = col
  dragSelecting.value = true
  refreshSelectedProperties()
}

function extendSelect(row, col) {
  if (!dragSelecting.value) return
  selected.endRow = row
  selected.endCol = col
}

function refreshSelectedProperties() {
  const cell = getCell(selected.endRow, selected.endCol)
  Object.assign(selectedStyle, { bold: false, wrap: true, border: true, fontSize: 11, color: '', fill: '', align: 'left' }, cell.style || {})
  styleColor.value = selectedStyle.color ? `#${selectedStyle.color}` : '#172033'
  styleFill.value = selectedStyle.fill ? `#${selectedStyle.fill}` : '#FFFFFF'
  selectedRowHeight.value = rowHeight(selected.endRow)
  selectedColumnWidth.value = columnWidth(selected.endCol)
}

watch(() => [selected.endRow, selected.endCol], refreshSelectedProperties)

function cellsInSelection() {
  const cells = []
  for (let row = range.value.top; row <= range.value.bottom; row += 1) {
    for (let col = range.value.left; col <= range.value.right; col += 1) cells.push(getCell(row, col, true))
  }
  return cells
}

function setCellText() {
  pushHistory()
  currentCell.value.fieldKey = ''
}

function setCellField(value) {
  pushHistory()
  currentCell.value.fieldKey = value || ''
  if (value) currentCell.value.value = ''
}

function setCellMode(value) {
  pushHistory()
  currentCell.value.fieldMode = value || 'single'
  if (currentCell.value.fieldMode === 'lines' && !currentCell.value.itemSeparator) currentCell.value.itemSeparator = '\n'
}

function setCellCollectionOption(key, value) {
  pushHistory()
  currentCell.value[key] = value || ''
}

function applyField(fieldKey) {
  setCellField(fieldKey)
}

function onFieldDrag(fieldKey, event) {
  event.dataTransfer?.setData('text/plain', fieldKey)
}

function dropField(row, col, event) {
  const fieldKey = event.dataTransfer?.getData('text/plain')
  if (!fieldKey) return
  startSelect(row, col)
  pushHistory()
  const cell = getCell(row, col, true)
  cell.fieldKey = fieldKey
  cell.value = ''
}

function toggleStyle(key) {
  setStyle(key, !selectedStyle[key])
}

function setStyle(key, value) {
  pushHistory()
  for (const cell of cellsInSelection()) {
    cell.style = { ...(cell.style || {}), [key]: value }
  }
  selectedStyle[key] = value
}

function colorWithoutHash(value) {
  return String(value || '').replace('#', '').toUpperCase()
}

function upsertByIndex(list, index, payload) {
  const existing = list.find((item) => item.index === index)
  if (existing) Object.assign(existing, payload)
  else list.push({ index, ...payload })
}

function setRowHeight(value) {
  pushHistory()
  upsertByIndex(config.sheet.rows, selected.endRow, { height: Number(value) || 22 })
}

function setColumnWidth(value) {
  pushHistory()
  upsertByIndex(config.sheet.columns, selected.endCol, { width: Number(value) || 14 })
}

function mergeSelection() {
  if (range.value.top === range.value.bottom && range.value.left === range.value.right) return
  pushHistory()
  config.merges = config.merges.filter((merge) => merge.endRow < range.value.top || merge.startRow > range.value.bottom || merge.endCol < range.value.left || merge.startCol > range.value.right)
  config.merges.push({ startRow: range.value.top, startCol: range.value.left, endRow: range.value.bottom, endCol: range.value.right })
}

function unmergeSelection() {
  pushHistory()
  config.merges = config.merges.filter((merge) => merge.endRow < range.value.top || merge.startRow > range.value.bottom || merge.endCol < range.value.left || merge.startCol > range.value.right)
}

function shiftRows(fromRow, delta) {
  for (const cell of config.cells) if (cell.row >= fromRow) cell.row += delta
  for (const merge of config.merges) {
    if (merge.startRow >= fromRow) merge.startRow += delta
    if (merge.endRow >= fromRow) merge.endRow += delta
  }
  for (const region of config.repeatRegions) {
    if (region.startRow >= fromRow) region.startRow += delta
    if (region.endRow >= fromRow) region.endRow += delta
  }
}

function shiftCols(fromCol, delta) {
  for (const cell of config.cells) if (cell.col >= fromCol) cell.col += delta
  for (const merge of config.merges) {
    if (merge.startCol >= fromCol) merge.startCol += delta
    if (merge.endCol >= fromCol) merge.endCol += delta
  }
}

function insertRow() {
  pushHistory()
  shiftRows(selected.endRow, 1)
  config.sheet.rowCount += 1
}

function deleteRow() {
  if (config.sheet.rowCount <= 1) return
  pushHistory()
  config.cells = config.cells.filter((cell) => cell.row !== selected.endRow)
  shiftRows(selected.endRow + 1, -1)
  config.sheet.rowCount -= 1
}

function insertColumn() {
  pushHistory()
  shiftCols(selected.endCol, 1)
  config.sheet.columnCount += 1
}

function deleteColumn() {
  if (config.sheet.columnCount <= 1) return
  pushHistory()
  config.cells = config.cells.filter((cell) => cell.col !== selected.endCol)
  shiftCols(selected.endCol + 1, -1)
  config.sheet.columnCount -= 1
}

function moveRow(direction) {
  const row = selected.endRow
  const target = row + direction
  if (target < 1 || target > config.sheet.rowCount) return
  pushHistory()
  for (const cell of config.cells) {
    if (cell.row === row) cell.row = target
    else if (cell.row === target) cell.row = row
  }
  selected.endRow = target
  selected.startRow = target
}

function setRepeatRegion() {
  pushHistory()
  const id = `${repeatForm.type}-${range.value.top}-${range.value.bottom}-${Date.now()}`
  config.repeatRegions = config.repeatRegions.filter((region) => region.endRow < range.value.top || region.startRow > range.value.bottom)
  config.repeatRegions.push({ id, type: repeatForm.type, startRow: range.value.top, endRow: range.value.bottom, emptyMode: repeatForm.emptyMode })
  config.repeatRegions.sort((left, right) => left.startRow - right.startRow)
}

function removeRepeatRegion(id) {
  pushHistory()
  config.repeatRegions = config.repeatRegions.filter((region) => region.id !== id)
}

async function loadFields() {
  const response = await apiRequest('/report-designs/fields')
  fieldGroups.value = response.data
}

async function loadDefaultConfig() {
  const response = await apiRequest('/report-designs/default-config')
  replaceConfig(response.data)
}

async function loadOptions() {
  const response = await apiRequest('/report-designs/options')
  Object.assign(options, response.data)
}

async function loadDesigns() {
  const query = new URLSearchParams({ page: 1, pageSize: 100 })
  if (filters.keyword) query.set('keyword', filters.keyword)
  const response = await apiRequest(`/report-designs?${query}`)
  designs.value = response.data
}

function loadDesign(item) {
  designId.value = item.id
  designName.value = item.designName
  replaceConfig(item.designConfig)
  ElMessage.success('已载入方案')
}

async function saveDesign() {
  try {
    const body = { designName: designName.value, designConfig: config, status: 'enabled' }
    if (designId.value) await apiRequest(`/report-designs/${designId.value}`, { method: 'PUT', body })
    else {
      const response = await apiRequest('/report-designs', { method: 'POST', body })
      designId.value = response.data.id
    }
    ElMessage.success('方案已保存')
    await Promise.all([loadDesigns(), loadOptions()])
  } catch (error) {
    ElMessage.error(error.message)
  }
}

async function requestPreview() {
  try {
    const response = await apiRequest('/report-designs/preview', { method: 'POST', body: { designConfig: config, scope: { projectIds: previewProjectId.value ? [previewProjectId.value] : [] } } })
    previewRows.value = response.data.rows
    ElMessage.success(`已预览：${response.data.project.projectCode}`)
  } catch (error) {
    ElMessage.error(error.message)
  }
}

async function loadExportRecords(silent = false) {
  if (!silent) recordsLoading.value = true
  try {
    const query = new URLSearchParams({ page: exportPagination.page, pageSize: exportPagination.pageSize })
    if (exportFilters.status) query.set('status', exportFilters.status)
    const response = await apiRequest(`/report-designs/exports/records?${query}`)
    exportRecords.value = response.data
    Object.assign(exportPagination, response.pagination)
  } catch (error) {
    if (!silent) ElMessage.error(error.message)
  } finally {
    if (!silent) recordsLoading.value = false
  }
}

async function openExportDialog() {
  Object.assign(exportForm, newExportForm(), { layout: config.export.layout })
  exportDialogVisible.value = true
  await loadOptions()
}

async function createExport() {
  if (exportForm.source === 'saved' && !exportForm.reportDesignId) return ElMessage.warning('请选择已保存方案')
  if (!exportForm.years.length && !exportForm.groups.length && !exportForm.projectIds.length) return ElMessage.warning('请至少选择年度、组别或指定项目中的一种范围')
  exporting.value = true
  try {
    await apiRequest('/report-designs/exports', {
      method: 'POST',
      body: {
        reportDesignId: exportForm.source === 'saved' ? exportForm.reportDesignId : null,
        designConfig: exportForm.source === 'current' ? config : null,
        layout: exportForm.layout,
        scope: { years: exportForm.years, groups: exportForm.groups, projectIds: exportForm.projectIds },
        remark: exportForm.remark,
      },
    })
    ElMessage.success('报表导出任务已加入队列')
    exportDialogVisible.value = false
    await loadExportRecords()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    exporting.value = false
  }
}

async function showExportDetail(row) {
  try {
    const response = await apiRequest(`/report-designs/exports/${row.id}`)
    selectedExport.value = response.data
    detailVisible.value = true
  } catch (error) {
    ElMessage.error(error.message)
  }
}

async function retryExport(row) {
  try {
    await apiRequest(`/report-designs/exports/${row.id}/retry`, { method: 'POST' })
    ElMessage.success('报表导出任务已重新加入队列')
    detailVisible.value = false
    await loadExportRecords(true)
  } catch (error) {
    ElMessage.error(error.message)
  }
}

async function downloadExport(row) {
  if (!row?.downloadable) return
  try {
    await downloadFile(`/report-designs/exports/${row.id}/download`, `${reportBatch(row)}.xlsx`)
  } catch (error) {
    ElMessage.error(error.message)
  }
}

function startPolling() {
  pollingTimer = window.setInterval(() => {
    if (exportRecords.value.some((item) => ['queued', 'processing'].includes(item.exportStatus))) loadExportRecords(true)
  }, 3000)
}

const repeatLabel = (value) => ({ members: '成员', advisors: '指导老师', checks: '检查记录', materials: '材料' }[value] || value)
const statusLabel = (value) => ({ queued: '排队中', processing: '生成中', success: '成功', failed: '失败' }[value] || value)
const statusType = (value) => ({ queued: 'info', processing: 'warning', success: 'success', failed: 'danger' }[value] || 'info')
const reportBatch = (row) => `RPT-${String(row.id).padStart(6, '0')}`
const formatTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
const formatFileSize = (value) => value ? `${(Number(value) / 1024).toFixed(1)} KB` : '-'

onMounted(async () => {
  await Promise.all([loadFields(), loadDefaultConfig(), loadOptions(), loadDesigns(), loadExportRecords()])
  startPolling()
})

onBeforeUnmount(() => window.clearInterval(pollingTimer))
</script>
