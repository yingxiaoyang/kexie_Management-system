import ExcelJS from 'exceljs';
import path from 'node:path';
import { badRequest } from './errors.js';
import { sanitizePathComponent } from './archive.js';

export const REPORT_FIELD_GROUPS = [
  {
    key: 'project',
    label: '项目信息',
    fields: [
      ['project.year', '年度'],
      ['project.group', '组别'],
      ['project.code', '项目编号'],
      ['project.title', '作品名称'],
      ['project.category', '类别'],
      ['project.approvalDate', '立项时间'],
      ['project.approvalType', '立项类型'],
      ['project.status', '状态'],
      ['project.remark', '备注']
    ]
  },
  {
    key: 'owner',
    label: '负责人',
    fields: [
      ['owner.name', '姓名'],
      ['owner.college', '学院'],
      ['owner.studentNo', '学号'],
      ['owner.phone', '电话'],
      ['owner.qq', 'QQ']
    ]
  },
  {
    key: 'members',
    label: '项目成员',
    fields: [
      ['members.name', '姓名'],
      ['members.college', '学院'],
      ['members.studentNo', '学号'],
      ['members.phone', '电话'],
      ['members.qq', 'QQ']
    ]
  },
  {
    key: 'advisors',
    label: '指导老师',
    fields: [
      ['advisors.name', '姓名'],
      ['advisors.teacherNo', '工号'],
      ['advisors.unit', '单位'],
      ['advisors.phone', '联系方式'],
      ['advisors.title', '职称'],
      ['advisors.email', '邮箱']
    ]
  },
  {
    key: 'checks',
    label: '检查记录',
    fields: [
      ['checks.phase', '阶段'],
      ['checks.researchLogCount', '日志数量'],
      ['checks.rating', '评级'],
      ['checks.checkedAt', '检查时间']
    ]
  },
  {
    key: 'reimbursement',
    label: '报销信息',
    fields: [
      ['reimbursement.budgetAmount', '额度'],
      ['reimbursement.claimAmount', '申报金额'],
      ['reimbursement.actualAmount', '实际金额'],
      ['reimbursement.remainingAmount', '剩余额度']
    ]
  },
  {
    key: 'materials',
    label: '材料信息',
    fields: [
      ['materials.taskName', '任务'],
      ['materials.categoryName', '材料类别'],
      ['materials.submissionStatus', '提交状态'],
      ['materials.reviewStatus', '审核状态'],
      ['materials.lastSubmittedAt', '最后提交时间']
    ]
  }
];

export const REPORT_FIELDS = REPORT_FIELD_GROUPS.flatMap((group) => (
  group.fields.map(([key, label]) => ({ key, label, group: group.key, groupLabel: group.label }))
));

const reportFieldKeys = new Set(REPORT_FIELDS.map((field) => field.key));
const repeatTypes = new Set(['members', 'advisors', 'checks', 'materials']);
const emptyModes = new Set(['blank', 'noneText', 'keepBlank']);
const alignments = new Set(['left', 'center', 'right']);
const verticalAlignments = new Set(['top', 'middle', 'bottom']);

export const DEFAULT_REPORT_CONFIG = {
  version: 1,
  sheet: {
    rowCount: 14,
    columnCount: 8,
    rows: [],
    columns: []
  },
  cells: [
    { row: 1, col: 1, value: '项目编号', style: { bold: true, fill: 'EAF2FF', align: 'center' } },
    { row: 1, col: 2, fieldKey: 'project.code' },
    { row: 1, col: 3, value: '作品名称', style: { bold: true, fill: 'EAF2FF', align: 'center' } },
    { row: 1, col: 4, fieldKey: 'project.title' },
    { row: 2, col: 1, value: '负责人', style: { bold: true, fill: 'EAF2FF', align: 'center' } },
    { row: 2, col: 2, fieldKey: 'owner.name' },
    { row: 2, col: 3, value: '联系电话', style: { bold: true, fill: 'EAF2FF', align: 'center' } },
    { row: 2, col: 4, fieldKey: 'owner.phone' },
    { row: 4, col: 1, value: '成员姓名', style: { bold: true, fill: 'F3F6FA', align: 'center' } },
    { row: 4, col: 2, value: '学院', style: { bold: true, fill: 'F3F6FA', align: 'center' } },
    { row: 4, col: 3, value: '学号', style: { bold: true, fill: 'F3F6FA', align: 'center' } },
    { row: 4, col: 4, value: '电话', style: { bold: true, fill: 'F3F6FA', align: 'center' } },
    { row: 5, col: 1, fieldKey: 'members.name' },
    { row: 5, col: 2, fieldKey: 'members.college' },
    { row: 5, col: 3, fieldKey: 'members.studentNo' },
    { row: 5, col: 4, fieldKey: 'members.phone' },
    { row: 7, col: 1, value: '指导老师', style: { bold: true, fill: 'F3F6FA', align: 'center' } },
    { row: 7, col: 2, value: '单位', style: { bold: true, fill: 'F3F6FA', align: 'center' } },
    { row: 7, col: 3, value: '职称', style: { bold: true, fill: 'F3F6FA', align: 'center' } },
    { row: 8, col: 1, fieldKey: 'advisors.name' },
    { row: 8, col: 2, fieldKey: 'advisors.unit' },
    { row: 8, col: 3, fieldKey: 'advisors.title' }
  ],
  merges: [],
  repeatRegions: [
    { id: 'members-repeat', type: 'members', startRow: 5, endRow: 5, emptyMode: 'noneText' },
    { id: 'advisors-repeat', type: 'advisors', startRow: 8, endRow: 8, emptyMode: 'noneText' }
  ],
  export: {
    layout: 'continuous',
    gapRows: 1,
    sheetNameRule: '{项目编号}-{作品名称}'
  }
};

function positiveInteger(value, fallback, { min = 1, max = 200 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function cleanColor(value) {
  const color = String(value || '').trim().replace(/^#/, '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(color) ? color : '';
}

function cleanCellStyle(style = {}) {
  const result = {};
  if (style.bold != null) result.bold = Boolean(style.bold);
  if (style.italic != null) result.italic = Boolean(style.italic);
  const fontSize = positiveInteger(style.fontSize, 11, { min: 8, max: 36 });
  if (fontSize !== 11) result.fontSize = fontSize;
  const color = cleanColor(style.color);
  if (color) result.color = color;
  const fill = cleanColor(style.fill);
  if (fill) result.fill = fill;
  if (alignments.has(style.align)) result.align = style.align;
  if (verticalAlignments.has(style.verticalAlign)) result.verticalAlign = style.verticalAlign;
  if (style.wrap != null) result.wrap = Boolean(style.wrap);
  if (style.border != null) result.border = Boolean(style.border);
  return result;
}

function normalizeRows(rows = [], rowCount) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    index: positiveInteger(row.index, 1, { min: 1, max: rowCount }),
    height: positiveInteger(row.height, 22, { min: 12, max: 120 })
  }));
}

function normalizeColumns(columns = [], columnCount) {
  if (!Array.isArray(columns)) return [];
  return columns.map((column) => ({
    index: positiveInteger(column.index, 1, { min: 1, max: columnCount }),
    width: positiveInteger(column.width, 14, { min: 6, max: 60 })
  }));
}

function normalizeCells(cells = [], rowCount, columnCount) {
  if (!Array.isArray(cells)) return [];
  return cells.map((cell) => {
    const row = positiveInteger(cell.row, 1, { min: 1, max: rowCount });
    const col = positiveInteger(cell.col, 1, { min: 1, max: columnCount });
    const fieldKey = String(cell.fieldKey || '').trim();
    if (fieldKey && !reportFieldKeys.has(fieldKey)) {
      throw badRequest(`Unsupported report field: ${fieldKey}`, 'VALIDATION_ERROR');
    }
    const fieldMode = ['single', 'summary', 'lines'].includes(cell.fieldMode) ? cell.fieldMode : 'single';
    const value = String(cell.value || '').slice(0, 1000);
    return {
      row,
      col,
      value,
      fieldKey: fieldKey || '',
      fieldMode,
      itemTemplate: String(cell.itemTemplate || '').slice(0, 300),
      itemSeparator: String(cell.itemSeparator || '').slice(0, 40),
      emptyText: String(cell.emptyText || '').slice(0, 80),
      style: cleanCellStyle(cell.style)
    };
  }).filter((cell) => cell.value || cell.fieldKey || Object.keys(cell.style || {}).length);
}

function normalizeMerges(merges = [], rowCount, columnCount) {
  if (!Array.isArray(merges)) return [];
  return merges.map((merge) => {
    const startRow = positiveInteger(merge.startRow, 1, { min: 1, max: rowCount });
    const startCol = positiveInteger(merge.startCol, 1, { min: 1, max: columnCount });
    const endRow = positiveInteger(merge.endRow, startRow, { min: startRow, max: rowCount });
    const endCol = positiveInteger(merge.endCol, startCol, { min: startCol, max: columnCount });
    return { startRow, startCol, endRow, endCol };
  }).filter((merge) => merge.endRow > merge.startRow || merge.endCol > merge.startCol);
}

function normalizeRepeatRegions(regions = [], rowCount) {
  if (!Array.isArray(regions)) return [];
  const normalized = regions.map((region, index) => {
    const type = String(region.type || '').trim();
    if (!repeatTypes.has(type)) throw badRequest(`repeatRegions[${index}].type is invalid`, 'VALIDATION_ERROR');
    const startRow = positiveInteger(region.startRow, 1, { min: 1, max: rowCount });
    const endRow = positiveInteger(region.endRow, startRow, { min: startRow, max: rowCount });
    const emptyMode = emptyModes.has(region.emptyMode) ? region.emptyMode : 'blank';
    return {
      id: String(region.id || `${type}-${startRow}-${endRow}`).slice(0, 80),
      type,
      startRow,
      endRow,
      emptyMode
    };
  }).sort((left, right) => left.startRow - right.startRow);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].startRow <= normalized[index - 1].endRow) {
      throw badRequest('Repeat regions cannot overlap or nest', 'VALIDATION_ERROR');
    }
  }
  return normalized;
}

export function normalizeReportDesignConfig(input) {
  let raw = input;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { throw badRequest('designConfig must be valid JSON', 'VALIDATION_ERROR'); }
  }
  if (!raw || typeof raw !== 'object') raw = DEFAULT_REPORT_CONFIG;
  const rowCount = positiveInteger(raw.sheet?.rowCount, 14, { min: 1, max: 200 });
  const columnCount = positiveInteger(raw.sheet?.columnCount, 8, { min: 1, max: 40 });
  const layout = raw.export?.layout === 'sheets' ? 'sheets' : 'continuous';
  const gapRows = positiveInteger(raw.export?.gapRows, 1, { min: 0, max: 20 });
  const sheetNameRule = String(raw.export?.sheetNameRule || '{项目编号}-{作品名称}').slice(0, 120);
  return {
    version: 1,
    sheet: {
      rowCount,
      columnCount,
      rows: normalizeRows(raw.sheet?.rows, rowCount),
      columns: normalizeColumns(raw.sheet?.columns, columnCount)
    },
    cells: normalizeCells(raw.cells, rowCount, columnCount),
    merges: normalizeMerges(raw.merges, rowCount, columnCount),
    repeatRegions: normalizeRepeatRegions(raw.repeatRegions, rowCount),
    export: { layout, gapRows, sheetNameRule }
  };
}

export function formatDateText(value, fallback = '') {
  if (!value) return fallback;
  const direct = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

function amountText(...values) {
  const total = values.reduce((sum, value) => sum + (Number(value) || 0), 0);
  return total.toFixed(2);
}

function approvalTypeText(value) {
  return { first: '首次立项', supplement: '补充立项' }[value] || value || '';
}

function projectStatusText(value) {
  return {
    draft: '草稿',
    active: '进行中',
    checking: '检查中',
    completed: '已完成',
    archived: '已归档',
    stopped: '已终止'
  }[value] || value || '';
}

function checkPhaseText(value) {
  return { midterm: '中期检查', stage: '阶段检查' }[value] || value || '';
}

function submissionStatusText(value) {
  return {
    not_submitted: '未提交',
    submitted: '已提交',
    returned: '退回',
    overdue: '逾期'
  }[value] || value || '';
}

function reviewStatusText(value) {
  return { pending: '待审核', approved: '通过', returned: '退回' }[value] || value || '';
}

export function decorateReportProject(project) {
  const owner = project.owners?.[0] || {};
  return {
    ...project,
    project: {
      year: project.projectYear,
      group: project.projectGroup || '',
      code: project.projectCode || '',
      title: project.title || '',
      category: project.category || '',
      approvalDate: formatDateText(project.approvalDate),
      approvalType: approvalTypeText(project.approvalType),
      status: projectStatusText(project.status),
      remark: project.remark || ''
    },
    owner: {
      name: owner.name || '',
      college: owner.college || '',
      studentNo: owner.studentNo || '',
      phone: owner.phone || '',
      qq: owner.qq || ''
    },
    members: (project.members || []).map((item) => ({
      name: item.name || '',
      college: item.college || '',
      studentNo: item.studentNo || '',
      phone: item.phone || '',
      qq: item.qq || ''
    })),
    advisors: (project.advisors || []).map((item) => ({
      name: item.name || '',
      teacherNo: item.teacherNo || '',
      unit: item.unit || '',
      phone: item.phone || '',
      title: item.title || '',
      email: item.email || ''
    })),
    checks: (project.checks || []).map((item) => ({
      phase: checkPhaseText(item.phase),
      researchLogCount: item.researchLogCount ?? '',
      rating: item.rating || '',
      checkedAt: formatDateText(item.checkedAt)
    })),
    reimbursement: {
      budgetAmount: amountText(project.reimbursement?.budgetAmount),
      claimAmount: amountText(project.reimbursement?.midtermClaimAmount, project.reimbursement?.stageClaimAmount),
      actualAmount: amountText(project.reimbursement?.midtermActualAmount, project.reimbursement?.stageActualAmount),
      remainingAmount: amountText(project.reimbursement?.remainingAmount)
    },
    materials: (project.materials || []).map((item) => ({
      taskName: item.taskName || '',
      categoryName: item.categoryName || '',
      submissionStatus: submissionStatusText(item.submissionStatus),
      reviewStatus: reviewStatusText(item.reviewStatus),
      lastSubmittedAt: formatDateText(item.lastSubmittedAt)
    }))
  };
}

function getCollection(project, type) {
  return Array.isArray(project[type]) ? project[type] : [];
}

function valueForField(project, fieldKey, repeatContext = {}) {
  if (!fieldKey) return '';
  const [group, name] = fieldKey.split('.');
  if (repeatContext.type === group && repeatContext.item) return repeatContext.item[name] ?? '';
  const value = project[group]?.[name];
  if (Array.isArray(project[group])) return project[group].map((item) => item[name]).filter(Boolean).join('、');
  return value ?? '';
}

const collectionTemplateLabels = {
  members: {
    name: '姓名',
    college: '学院',
    studentNo: '学号',
    phone: '电话',
    qq: 'QQ'
  },
  advisors: {
    name: '姓名',
    teacherNo: '工号',
    unit: '单位',
    phone: '联系方式',
    title: '职称',
    email: '邮箱'
  },
  checks: {
    phase: '阶段',
    researchLogCount: '日志数量',
    rating: '评级',
    checkedAt: '检查时间'
  },
  materials: {
    taskName: '任务',
    categoryName: '材料类别',
    submissionStatus: '提交状态',
    reviewStatus: '审核状态',
    lastSubmittedAt: '最后提交时间'
  }
};

function renderCollectionItem(group, item, fieldName, template) {
  if (!template) return item[fieldName] ?? '';
  const labels = collectionTemplateLabels[group] || {};
  return String(template).replace(/\{([^{}]+)\}/g, (_match, key) => {
    const fieldKey = Object.entries(labels).find(([, label]) => label === key)?.[0] || key;
    return item[fieldKey] ?? '';
  });
}

function valueForCell(project, cell, repeatContext = {}) {
  if (!cell.fieldKey) return cell.value || '';
  const [group, name] = cell.fieldKey.split('.');
  if (cell.fieldMode === 'summary' || cell.fieldMode === 'lines') {
    const collection = getCollection(project, group);
    if (!collection.length) return cell.emptyText || '';
    const separator = cell.itemSeparator || (cell.fieldMode === 'lines' ? '\n' : '、');
    return collection
      .map((item) => renderCollectionItem(group, item, name, cell.itemTemplate))
      .filter(Boolean)
      .join(separator);
  }
  if (repeatContext.empty && repeatContext.type === group && cell.fieldMode === 'single') return repeatContext.noneText || '';
  return valueForField(project, cell.fieldKey, repeatContext);
}

function applyCellStyle(cell, style = {}) {
  cell.numFmt = '@';
  cell.alignment = {
    horizontal: style.align || 'left',
    vertical: style.verticalAlign || 'middle',
    wrapText: style.wrap !== false
  };
  cell.font = {
    name: 'Microsoft YaHei',
    size: style.fontSize || 11,
    bold: Boolean(style.bold),
    italic: Boolean(style.italic),
    color: style.color ? { argb: `FF${style.color}` } : undefined
  };
  if (style.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${style.fill}` } };
  if (style.border) {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD8DEE9' } },
      left: { style: 'thin', color: { argb: 'FFD8DEE9' } },
      bottom: { style: 'thin', color: { argb: 'FFD8DEE9' } },
      right: { style: 'thin', color: { argb: 'FFD8DEE9' } }
    };
  }
}

function rowHeight(config, sourceRow) {
  return config.sheet.rows.find((row) => row.index === sourceRow)?.height || 22;
}

function cellsInRow(config, sourceRow) {
  return config.cells.filter((cell) => cell.row === sourceRow);
}

function sourceRowRegion(config, sourceRow) {
  return config.repeatRegions.find((region) => sourceRow >= region.startRow && sourceRow <= region.endRow);
}

function isRepeatField(cell, type) {
  return String(cell.fieldKey || '').startsWith(`${type}.`);
}

function setRowFromTemplate({ worksheet, config, outputRow, sourceRow, project, repeatContext, skippedDynamicCells }) {
  const row = worksheet.getRow(outputRow);
  row.height = rowHeight(config, sourceRow);
  for (let col = 1; col <= config.sheet.columnCount; col += 1) {
    const cell = row.getCell(col);
    cell.numFmt = '@';
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
    };
  }
  for (const cellConfig of cellsInRow(config, sourceRow)) {
    const skipKey = `${cellConfig.row}:${cellConfig.col}`;
    if (skippedDynamicCells?.has(skipKey)) continue;
    const cell = row.getCell(cellConfig.col);
    cell.value = String(valueForCell(project, cellConfig, repeatContext) ?? '');
    applyCellStyle(cell, cellConfig.style);
  }
  row.commit?.();
}

function rowSpanForRepeat(region, collectionLength) {
  const templateHeight = region.endRow - region.startRow + 1;
  return Math.max(0, collectionLength) * templateHeight;
}

function mergeKey(merge) {
  return `${merge.startRow}:${merge.startCol}:${merge.endRow}:${merge.endCol}`;
}

function addMerge(worksheet, merge, rowOffset, usedMergeKeys) {
  const shifted = {
    startRow: merge.startRow + rowOffset,
    startCol: merge.startCol,
    endRow: merge.endRow + rowOffset,
    endCol: merge.endCol
  };
  const key = mergeKey(shifted);
  if (usedMergeKeys.has(key)) return;
  usedMergeKeys.add(key);
  worksheet.mergeCells(shifted.startRow, shifted.startCol, shifted.endRow, shifted.endCol);
}

function sourceMergeForCell(config, row, col) {
  return config.merges.find((merge) => (
    row >= merge.startRow && row <= merge.endRow && col >= merge.startCol && col <= merge.endCol
  ));
}

function mergeHasDynamicFixedField(config, merge, repeatType) {
  return config.cells.some((cell) => (
    cell.row >= merge.startRow
    && cell.row <= merge.endRow
    && cell.col >= merge.startCol
    && cell.col <= merge.endCol
    && cell.fieldKey
    && !isRepeatField(cell, repeatType)
  ));
}

function applyProjectBlock({ worksheet, config, project, startRow }) {
  const usedMergeKeys = new Set();
  let outputRow = startRow;
  let sourceRow = 1;
  const sourceToOutput = new Map();

  while (sourceRow <= config.sheet.rowCount) {
    const region = config.repeatRegions.find((item) => item.startRow === sourceRow);
    if (!region) {
      sourceToOutput.set(sourceRow, outputRow);
      setRowFromTemplate({ worksheet, config, outputRow, sourceRow, project });
      outputRow += 1;
      sourceRow += 1;
      continue;
    }

    const collection = getCollection(project, region.type);
    const templateRows = [];
    for (let row = region.startRow; row <= region.endRow; row += 1) templateRows.push(row);
    const copies = collection.length
      ? collection.map((item) => ({ item }))
      : region.emptyMode === 'blank'
        ? []
        : [{ item: {}, empty: true, noneText: region.emptyMode === 'noneText' ? '无' : '' }];
    const regionStartOutput = outputRow;
    const dynamicCells = new Map();

    for (const copy of copies) {
      for (const templateRow of templateRows) {
        sourceToOutput.set(templateRow, sourceToOutput.get(templateRow) || outputRow);
        const skippedDynamicCells = new Set();
        for (const cell of cellsInRow(config, templateRow)) {
          if (isRepeatField(cell, region.type)) continue;
          const sourceMerge = sourceMergeForCell(config, cell.row, cell.col);
          if (!sourceMerge) continue;
          dynamicCells.set(`${cell.row}:${cell.col}`, { cell, merge: sourceMerge });
          if (outputRow !== regionStartOutput + (cell.row - region.startRow)) skippedDynamicCells.add(`${cell.row}:${cell.col}`);
        }
        setRowFromTemplate({
          worksheet,
          config,
          outputRow,
          sourceRow: templateRow,
          project,
          repeatContext: { type: region.type, item: copy.item, empty: copy.empty, noneText: copy.noneText },
          skippedDynamicCells
        });
        outputRow += 1;
      }
    }

    const expandedHeight = outputRow - regionStartOutput;
    for (const { cell, merge } of dynamicCells.values()) {
      if (expandedHeight <= 1) continue;
      const relativeStart = cell.row - region.startRow;
      const firstRow = regionStartOutput + relativeStart;
      const lastRow = regionStartOutput + expandedHeight - 1;
      addMerge(worksheet, {
        startRow: firstRow,
        startCol: merge.startCol,
        endRow: lastRow,
        endCol: merge.endCol
      }, 0, usedMergeKeys);
    }

    sourceRow = region.endRow + 1;
  }

  for (const merge of config.merges) {
    const region = sourceRowRegion(config, merge.startRow);
    if (region) {
      if (mergeHasDynamicFixedField(config, merge, region.type)) continue;
      const collectionLength = getCollection(project, region.type).length || (region.emptyMode === 'blank' ? 0 : 1);
      const templateHeight = region.endRow - region.startRow + 1;
      for (let copyIndex = 0; copyIndex < collectionLength; copyIndex += 1) {
        const rowOffset = (sourceToOutput.get(region.startRow) || startRow) - region.startRow + copyIndex * templateHeight;
        addMerge(worksheet, merge, rowOffset, usedMergeKeys);
      }
    } else {
      addMerge(worksheet, merge, (sourceToOutput.get(merge.startRow) || startRow) - merge.startRow, usedMergeKeys);
    }
  }

  return outputRow - startRow;
}

function sheetNameFromRule(rule, project, usedNames) {
  const text = String(rule || '{项目编号}-{作品名称}')
    .replace(/\{项目编号\}/g, project.project.code || '')
    .replace(/\{作品名称\}/g, project.project.title || '')
    .replace(/\{年度\}/g, project.project.year || '')
    .replace(/\{组别\}/g, project.project.group || '');
  let base = sanitizePathComponent(text, '项目报表').replace(/[:\\/?*\[\]]/g, '_').slice(0, 31).trim();
  if (!base) base = '项目报表';
  let candidate = base;
  let index = 2;
  while (usedNames.has(candidate.toLocaleLowerCase())) {
    const suffix = `_${index}`;
    candidate = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    index += 1;
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

function prepareWorksheet(worksheet, config) {
  for (let col = 1; col <= config.sheet.columnCount; col += 1) {
    const configured = config.sheet.columns.find((item) => item.index === col);
    worksheet.getColumn(col).width = configured?.width || 14;
    worksheet.getColumn(col).style = { numFmt: '@' };
  }
  worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 0 }];
}

export async function reportWorkbookBuffer(configInput, rawProjects, layoutInput = '') {
  const config = normalizeReportDesignConfig(configInput);
  const layout = layoutInput === 'sheets' ? 'sheets' : config.export.layout;
  const projects = rawProjects.map(decorateReportProject);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'kexie-server';
  workbook.created = new Date();

  if (layout === 'sheets') {
    const usedNames = new Set();
    for (const project of projects) {
      const worksheet = workbook.addWorksheet(sheetNameFromRule(config.export.sheetNameRule, project, usedNames));
      prepareWorksheet(worksheet, config);
      applyProjectBlock({ worksheet, config, project, startRow: 1 });
    }
  } else {
    const worksheet = workbook.addWorksheet('项目报表');
    prepareWorksheet(worksheet, config);
    let currentRow = 1;
    for (const project of projects) {
      const height = applyProjectBlock({ worksheet, config, project, startRow: currentRow });
      currentRow += height + config.export.gapRows;
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function reportPreviewGrid(configInput, rawProject) {
  const config = normalizeReportDesignConfig(configInput);
  const project = decorateReportProject(rawProject);
  const rows = [];
  const fakeWorksheet = {
    data: rows,
    getRow(rowNumber) {
      if (!rows[rowNumber - 1]) rows[rowNumber - 1] = { rowNumber, cells: Array.from({ length: config.sheet.columnCount }, () => ''), height: 22 };
      const row = rows[rowNumber - 1];
      return {
        set height(value) { row.height = value; },
        getCell(col) {
          return {
            set value(value) { row.cells[col - 1] = value; },
            get value() { return row.cells[col - 1]; },
            set numFmt(_value) {},
            set alignment(_value) {},
            set font(_value) {},
            set fill(_value) {},
            set border(_value) {}
          };
        }
      };
    },
    mergeCells() {}
  };
  applyProjectBlock({ worksheet: fakeWorksheet, config, project, startRow: 1 });
  return rows.filter(Boolean).map((row) => ({ rowNumber: row.rowNumber, height: row.height, cells: row.cells }));
}

export function reportFileName(exportId) {
  return `report-export-${exportId}.xlsx`;
}

export function reportFilePath(root, exportId) {
  return path.join(root, reportFileName(exportId));
}
