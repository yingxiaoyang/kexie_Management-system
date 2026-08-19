import path from 'node:path';
import { badRequest } from './errors.js';

const MAX_BATCH_SUBMISSIONS = 100;

export function parseSubmissionIds(value) {
  if (!Array.isArray(value) || !value.length) {
    throw badRequest('请至少选择一条材料审核任务', 'VALIDATION_ERROR');
  }
  const ids = [...new Set(value.map(Number))];
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw badRequest('材料审核任务编号无效', 'VALIDATION_ERROR');
  }
  if (ids.length > MAX_BATCH_SUBMISSIONS) {
    throw badRequest(`单次最多处理 ${MAX_BATCH_SUBMISSIONS} 条材料审核任务`, 'BATCH_LIMIT_EXCEEDED');
  }
  return ids.sort((left, right) => left - right);
}

export function expectedAssignmentVersion(value, submissionId) {
  const raw = value?.[String(submissionId)] ?? value?.[submissionId];
  const version = Number(raw);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw badRequest('页面数据不完整，请刷新材料审核列表后重试', 'ASSIGNMENT_VERSION_REQUIRED');
  }
  return version;
}

export function sanitizeZipSegment(value, fallback = '未命名') {
  const segment = String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/_+/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!segment || segment === '.' || segment === '..') return fallback;
  return segment.slice(0, 120);
}

export function uniqueZipEntryName(directory, fileName, usedNames) {
  const safeDirectory = String(directory || '')
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => sanitizeZipSegment(segment))
    .join('/');
  const safeFileName = sanitizeZipSegment(fileName, '文件');
  const extension = path.extname(safeFileName);
  const stem = path.basename(safeFileName, extension) || '文件';
  let candidate = `${safeDirectory}/${safeFileName}`;
  let index = 2;
  while (usedNames.has(candidate.toLocaleLowerCase('zh-CN'))) {
    candidate = `${safeDirectory}/${stem} (${index})${extension}`;
    index += 1;
  }
  usedNames.add(candidate.toLocaleLowerCase('zh-CN'));
  return candidate;
}
