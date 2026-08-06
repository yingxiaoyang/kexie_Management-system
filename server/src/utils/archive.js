import path from 'node:path';
import { badRequest } from './errors.js';

export const ARCHIVE_PLACEHOLDERS = [
  '年度',
  '组别',
  '项目编号',
  '作品名称',
  '负责人',
  '材料任务',
  '材料类别',
  '原文件名'
];

export const DEFAULT_ARCHIVE_CONFIG = {
  version: 1,
  directoryLevels: [
    { pattern: '{年度}年' },
    { pattern: '{组别}' },
    { pattern: '{项目编号}-{作品名称}' },
    { pattern: '{材料任务}' },
    { pattern: '{材料类别}' }
  ],
  fileNameRule: '{项目编号}_{作品名称}_{负责人}_{材料类别}_{原文件名}'
};

const placeholderSet = new Set(ARCHIVE_PLACEHOLDERS);
const windowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function cleanPattern(value, fieldName, maxLength) {
  const pattern = String(value || '').trim();
  if (!pattern) throw badRequest(`${fieldName} cannot be empty`, 'VALIDATION_ERROR');
  if (pattern.length > maxLength) throw badRequest(`${fieldName} is too long`, 'VALIDATION_ERROR');
  const placeholders = pattern.match(/\{[^{}]+\}/g) || [];
  for (const token of placeholders) {
    if (!placeholderSet.has(token.slice(1, -1))) {
      throw badRequest(`Unsupported archive placeholder: ${token}`, 'VALIDATION_ERROR');
    }
  }
  return pattern;
}

export function normalizeArchiveTemplateConfig(input) {
  let raw = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw badRequest('templateConfig must be valid JSON', 'VALIDATION_ERROR');
    }
  }
  if (!raw || typeof raw !== 'object') throw badRequest('templateConfig is required', 'VALIDATION_ERROR');
  if (!Array.isArray(raw.directoryLevels) || !raw.directoryLevels.length || raw.directoryLevels.length > 8) {
    throw badRequest('directoryLevels must contain 1 to 8 levels', 'VALIDATION_ERROR');
  }
  const directoryLevels = raw.directoryLevels.map((item, index) => ({
    pattern: cleanPattern(typeof item === 'string' ? item : item?.pattern, `directoryLevels[${index}]`, 160)
  }));
  return {
    version: 1,
    directoryLevels,
    fileNameRule: cleanPattern(raw.fileNameRule, 'fileNameRule', 240)
  };
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

function placeholderValues(context) {
  const originalName = String(context.originalName || '材料文件');
  const extension = path.extname(originalName);
  return {
    年度: context.projectYear ?? '未知年度',
    组别: context.projectGroup || '未分组',
    项目编号: context.projectCode || '无项目编号',
    作品名称: context.projectTitle || '无作品名称',
    负责人: context.owner || '未登记负责人',
    材料任务: context.taskName || '未命名任务',
    材料类别: context.categoryName || '未命名材料',
    原文件名: originalName.slice(0, Math.max(0, originalName.length - extension.length)) || '材料文件'
  };
}

function renderPattern(pattern, context) {
  const values = placeholderValues(context);
  return pattern.replace(/\{([^{}]+)\}/g, (_match, key) => String(values[key] ?? ''));
}

export function renderArchivePath(configInput, context) {
  const config = normalizeArchiveTemplateConfig(configInput);
  const extension = path.extname(String(context.originalName || '')).toLowerCase();
  const directorySegments = config.directoryLevels.map((level) => sanitizePathComponent(renderPattern(level.pattern, context)));
  const fileBase = sanitizePathComponent(renderPattern(config.fileNameRule, context), '材料文件');
  const safeExtension = extension.replace(/[^.a-zA-Z0-9]/g, '');
  return {
    directorySegments,
    directory: directorySegments.join('/'),
    fileName: `${fileBase}${safeExtension}`
  };
}

export function archivePreview(configInput) {
  return renderArchivePath(configInput, {
    projectYear: 2026,
    projectGroup: '创新组',
    projectCode: 'CX2026-001',
    projectTitle: '智能校园材料管理系统',
    owner: '张同学',
    taskName: '中期检查材料',
    categoryName: '中期报告',
    originalName: '中期报告终稿.docx'
  });
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
  const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return `\ufeff${[headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n')}`;
}
