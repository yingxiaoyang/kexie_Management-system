import path from 'node:path';
import { badRequest } from './errors.js';
import { xlsxBuffer } from './excel.js';

export const ARCHIVE_PLACEHOLDERS = [
  '项目序号', '项目序号两位', '项目序号三位', '材料序号', '材料序号两位',
  '年度', '组别', '项目编号', '作品名称', '项目类别', '立项日期',
  '负责人', '负责人学号工号', '负责人学院单位', '负责人电话', '项目成员', '指导教师',
  '材料任务', '材料类别', '原文件名', '原扩展名', '提交日期', '审核通过日期',
  '导出日期', '导出批次'
];

export const DEFAULT_ARCHIVE_CONFIG = {
  version: 2,
  projectRootRule: '{项目编号}-{作品名称}',
  preserveEmptyFolders: false,
  defaultFileNameRule: '{材料类别}_{原文件名}',
  nodes: [
    { id: 'folder-materials', type: 'folder', nameRule: '材料', children: [] }
  ]
};

const placeholderSet = new Set(ARCHIVE_PLACEHOLDERS);
const windowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function cleanPattern(value, fieldName, maxLength, allowEmpty = false) {
  const pattern = String(value ?? '').trim();
  if (!pattern && !allowEmpty) throw badRequest(`${fieldName} cannot be empty`, 'VALIDATION_ERROR');
  if (pattern.length > maxLength) throw badRequest(`${fieldName} is too long`, 'VALIDATION_ERROR');
  const placeholders = pattern.match(/\{[^{}]+\}/g) || [];
  for (const token of placeholders) {
    if (!placeholderSet.has(token.slice(1, -1))) {
      throw badRequest(`Unsupported archive placeholder: ${token}`, 'VALIDATION_ERROR');
    }
  }
  return pattern;
}

function normalizeLegacy(raw) {
  if (!Array.isArray(raw.directoryLevels) || !raw.directoryLevels.length || raw.directoryLevels.length > 8) {
    throw badRequest('directoryLevels must contain 1 to 8 levels', 'VALIDATION_ERROR');
  }
  return {
    version: 1,
    directoryLevels: raw.directoryLevels.map((item, index) => ({
      pattern: cleanPattern(typeof item === 'string' ? item : item?.pattern, `directoryLevels[${index}]`, 160)
    })),
    fileNameRule: cleanPattern(raw.fileNameRule, 'fileNameRule', 240)
  };
}

function normalizeV2(raw) {
  if (!Array.isArray(raw.nodes) || raw.nodes.length > 40) {
    throw badRequest('nodes must be an array with at most 40 root nodes', 'VALIDATION_ERROR');
  }
  const ids = new Set();
  const fileTaskIds = new Set();
  let nodeCount = 0;
  let taskCount = 0;
  const defaultFileNameRule = cleanPattern(raw.defaultFileNameRule || '{材料类别}_{原文件名}', 'defaultFileNameRule', 240);
  function walk(nodes, depth, parentPath) {
    if (depth > 8) throw badRequest('Archive folder nesting cannot exceed 8 levels', 'VALIDATION_ERROR');
    if (!Array.isArray(nodes)) throw badRequest(`${parentPath}.children must be an array`, 'VALIDATION_ERROR');
    return nodes.map((item, index) => {
      nodeCount += 1;
      if (nodeCount > 300) throw badRequest('Archive template contains too many nodes', 'VALIDATION_ERROR');
      const nodePath = `${parentPath}[${index}]`;
      const type = item?.type;
      const id = String(item?.id || '').trim();
      if (!id || id.length > 80 || ids.has(id)) throw badRequest(`${nodePath}.id is invalid or duplicated`, 'VALIDATION_ERROR');
      ids.add(id);
      if (type === 'folder') {
        return {
          id,
          type: 'folder',
          nameRule: cleanPattern(item.nameRule, `${nodePath}.nameRule`, 160),
          children: walk(item.children || [], depth + 1, `${nodePath}.children`)
        };
      }
      if (type !== 'task') throw badRequest(`${nodePath}.type is invalid`, 'VALIDATION_ERROR');
      const materialTaskId = Number(item.materialTaskId);
      const fileTaskId = Number(item.fileTaskId);
      if (!Number.isInteger(materialTaskId) || materialTaskId < 1) throw badRequest(`${nodePath}.materialTaskId is invalid`, 'VALIDATION_ERROR');
      if (!Number.isInteger(fileTaskId) || fileTaskId < 1 || fileTaskIds.has(fileTaskId)) {
        throw badRequest(`${nodePath}.fileTaskId is invalid or duplicated`, 'VALIDATION_ERROR');
      }
      fileTaskIds.add(fileTaskId);
      taskCount += 1;
      const explicitMode = ['inherit', 'required', 'optional'].includes(item.requiredMode)
        ? item.requiredMode
        : (typeof item.isRequired === 'boolean' ? (item.isRequired ? 'required' : 'optional') : 'inherit');
      return {
        id,
        type: 'task',
        materialTaskId,
        fileTaskId,
        materialTaskName: String(item.materialTaskName || '').trim().slice(0, 160),
        fileTaskName: String(item.fileTaskName || '').trim().slice(0, 120),
        fileNameRule: cleanPattern(item.fileNameRule || defaultFileNameRule, `${nodePath}.fileNameRule`, 240),
        requiredMode: explicitMode,
        requiredReviewNeeded: item.requiredMode == null && typeof item.isRequired !== 'boolean'
      };
    });
  }
  const nodes = walk(raw.nodes, 1, 'nodes');
  if (!taskCount) throw badRequest('Archive template must place at least one file task', 'VALIDATION_ERROR');
  return {
    version: 2,
    projectRootRule: cleanPattern(raw.projectRootRule || '{项目编号}-{作品名称}', 'projectRootRule', 160),
    preserveEmptyFolders: Boolean(raw.preserveEmptyFolders),
    defaultFileNameRule,
    nodes
  };
}

export function normalizeArchiveTemplateConfig(input) {
  let raw = input;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { throw badRequest('templateConfig must be valid JSON', 'VALIDATION_ERROR'); }
  }
  if (!raw || typeof raw !== 'object') throw badRequest('templateConfig is required', 'VALIDATION_ERROR');
  return Number(raw.version) >= 2 ? normalizeV2(raw) : normalizeLegacy(raw);
}

export function sanitizePathComponent(value, fallback = '未命名') {
  let result = String(value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!result || result === '.' || result === '..') result = fallback;
  if (windowsReservedName.test(result)) result = `_${result}`;
  if (result.length > 120) result = result.slice(0, 120).replace(/[. ]+$/g, '');
  return result || fallback;
}

function sequenceText(value, width = 0) {
  const sequence = Math.max(1, Number(value) || 1);
  return width ? String(sequence).padStart(width, '0') : String(sequence);
}

function dateText(value, fallback = '未填写日期') {
  if (!value) return fallback;
  const direct = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function placeholderValues(context) {
  const originalName = String(context.originalName || '材料文件');
  const extension = path.extname(originalName);
  return {
    项目序号: sequenceText(context.projectSequence),
    项目序号两位: sequenceText(context.projectSequence, 2),
    项目序号三位: sequenceText(context.projectSequence, 3),
    材料序号: sequenceText(context.materialSequence),
    材料序号两位: sequenceText(context.materialSequence, 2),
    年度: context.projectYear ?? '未知年度',
    组别: context.projectGroup || '未分组',
    项目编号: context.projectCode || '无项目编号',
    作品名称: context.projectTitle || '无作品名称',
    项目类别: context.projectCategory || '未设置类别',
    立项日期: dateText(context.approvalDate),
    负责人: context.owner || '未登记负责人',
    负责人学号工号: context.ownerIdentifiers || '未登记编号',
    负责人学院单位: context.ownerOrganizations || '未登记单位',
    负责人电话: context.ownerPhone || '未登记电话',
    项目成员: context.memberNames || '未登记成员',
    指导教师: context.advisorNames || '未登记指导教师',
    材料任务: context.taskName || '未命名任务',
    材料类别: context.categoryName || '未命名材料',
    原文件名: originalName.slice(0, Math.max(0, originalName.length - extension.length)) || '材料文件',
    原扩展名: extension.replace(/^\./, '').toLowerCase() || '无扩展名',
    提交日期: dateText(context.approvedSubmittedAt),
    审核通过日期: dateText(context.approvedAt),
    导出日期: dateText(context.exportDate || new Date()),
    导出批次: context.exportBatch || 'ARCH-000001'
  };
}

export function renderPattern(pattern, context) {
  const values = placeholderValues(context);
  return String(pattern || '').replace(/\{([^{}]+)\}/g, (_match, key) => String(values[key] ?? ''));
}

function walkTree(nodes, folderSegments = [], result = []) {
  for (const node of nodes || []) {
    if (node.type === 'folder') {
      const next = [...folderSegments, node.nameRule];
      result.push({ node, folderSegments: next });
      walkTree(node.children, next, result);
    } else if (node.type === 'task') {
      result.push({ node, folderSegments });
    }
  }
  return result;
}

export function archivePlacements(configInput) {
  const config = normalizeArchiveTemplateConfig(configInput);
  if (config.version === 1) return [];
  return walkTree(config.nodes).filter((item) => item.node.type === 'task').map((item) => ({
    ...item,
    fileTaskId: Number(item.node.fileTaskId),
    materialTaskId: Number(item.node.materialTaskId),
    requiredMode: item.node.requiredMode || 'inherit',
    requiredReviewNeeded: Boolean(item.node.requiredReviewNeeded)
  }));
}

export function renderArchiveFolders(configInput, context) {
  const config = normalizeArchiveTemplateConfig(configInput);
  if (config.version === 1) {
    return config.directoryLevels.map((level) => sanitizePathComponent(renderPattern(level.pattern, context)));
  }
  const root = sanitizePathComponent(renderPattern(config.projectRootRule, context), '项目');
  const folders = new Set([root]);
  for (const placement of walkTree(config.nodes)) {
    if (placement.node.type !== 'folder') continue;
    const segments = [root, ...placement.folderSegments.map((rule) => sanitizePathComponent(renderPattern(rule, context)))];
    for (let index = 1; index <= segments.length; index += 1) folders.add(segments.slice(0, index).join('/'));
  }
  return [...folders];
}

export function renderArchivePath(configInput, context) {
  const config = normalizeArchiveTemplateConfig(configInput);
  const extension = path.extname(String(context.originalName || '')).toLowerCase().replace(/[^.a-zA-Z0-9]/g, '');
  if (config.version === 1) {
    const directorySegments = config.directoryLevels.map((level) => sanitizePathComponent(renderPattern(level.pattern, context)));
    const fileBase = sanitizePathComponent(renderPattern(config.fileNameRule, context), '材料文件');
    return { directorySegments, directory: directorySegments.join('/'), fileName: `${fileBase}${extension}` };
  }
  const placement = archivePlacements(config).find((item) => item.fileTaskId === Number(context.categoryId));
  if (!placement) return { placed: false, directorySegments: [], directory: '', fileName: '' };
  const root = sanitizePathComponent(renderPattern(config.projectRootRule, context), '项目');
  const directorySegments = [root, ...placement.folderSegments.map((rule) => sanitizePathComponent(renderPattern(rule, context)))];
  const rule = placement.node.fileNameRule || config.defaultFileNameRule;
  const fileBase = sanitizePathComponent(renderPattern(rule, context), '材料文件');
  return { placed: true, directorySegments, directory: directorySegments.join('/'), fileName: `${fileBase}${extension}` };
}

export function archivePreview(configInput) {
  const config = normalizeArchiveTemplateConfig(configInput);
  const context = {
    projectSequence: 1, materialSequence: 1,
    projectYear: 2026, projectGroup: '创新组', projectCode: 'CX2026-001',
    projectTitle: '智能校园材料管理系统', projectCategory: '科技创新类', approvalDate: '2026-03-15',
    owner: '张同学', ownerIdentifiers: '20260001', ownerOrganizations: '计算机学院',
    ownerPhone: '13800000000', memberNames: '李同学、王同学', advisorNames: '赵老师',
    taskName: '中期检查材料', categoryName: '中期报告', categoryId: 1,
    originalName: '中期报告终稿.docx', approvedSubmittedAt: '2026-08-05', approvedAt: '2026-08-06',
    exportDate: '2026-08-06', exportBatch: 'ARCH-000123'
  };
  const preview = config.version === 1
    ? renderArchivePath(config, context)
    : (() => {
      const placement = archivePlacements(config)[0];
      const rendered = placement
        ? renderArchivePath(config, { ...context, categoryId: placement.fileTaskId })
        : { directory: sanitizePathComponent(renderPattern(config.projectRootRule, context), '项目'), fileName: '' };
      return rendered;
    })();
  return {
    ...preview,
    projectRoot: config.version === 2 ? sanitizePathComponent(renderPattern(config.projectRootRule, context), '项目') : preview.directorySegments?.[0] || '',
    entries: config.version === 2 ? archivePlacements(config).slice(0, 8).map((placement) => {
      const rendered = renderArchivePath(config, { ...context, categoryId: placement.fileTaskId });
      return { task: placement.node.fileTaskName || context.categoryName, directory: rendered.directory, fileName: rendered.fileName };
    }) : []
  };
}

export function isPathInside(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function uniqueArchiveEntry(entryName, usedEntries) {
  const normalized = path.posix.normalize(String(entryName || '').replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw badRequest('Generated archive path is invalid', 'VALIDATION_ERROR');
  }
  let candidate = normalized;
  let index = 2;
  const directory = path.posix.dirname(normalized);
  const extension = path.posix.extname(normalized);
  const baseName = path.posix.basename(normalized, extension);
  while (usedEntries.has(candidate.toLocaleLowerCase())) {
    const nextName = `${baseName}_${index}${extension}`;
    candidate = directory === '.' ? nextName : path.posix.join(directory, nextName);
    index += 1;
  }
  usedEntries.add(candidate.toLocaleLowerCase());
  return candidate;
}

export function csvText(headers, rows) {
  const escapeCell = (value) => `"${safeSpreadsheetText(value).replace(/"/g, '""')}"`;
  return `\ufeff${[headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n')}`;
}

export function safeSpreadsheetText(value) {
  const text = String(value ?? '');
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export { xlsxBuffer };
