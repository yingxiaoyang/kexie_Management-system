import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import archiver from 'archiver';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import {
  archivePlacements,
  normalizeArchiveTemplateConfig,
  renderArchiveFolders,
  renderArchivePath,
  uniqueArchiveEntry,
  xlsxBuffer
} from '../utils/archive.js';
import { badRequest, notFound, tooManyRequests } from '../utils/errors.js';
import { resolveDownloadFile, isPathInside } from '../utils/safeFiles.js';

const workerLockName = 'kexie_archive_export_worker_lock';
const queueLockName = 'kexie_archive_export_queue_lock';
const batchDir = path.resolve(env.upload.root, '../imports/batches');

export const exportStatuses = ['queued', 'processing', 'success', 'failed'];

export function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function numberList(value, fieldName, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw badRequest(`${fieldName} must be an array`, 'VALIDATION_ERROR');
  const values = value.map(Number);
  if (values.some((item) => !Number.isInteger(item) || item < min || item > max)) {
    throw badRequest(`${fieldName} contains an invalid value`, 'VALIDATION_ERROR');
  }
  return [...new Set(values)];
}

function textList(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw badRequest(`${fieldName} must be an array`, 'VALIDATION_ERROR');
  const values = value.map((item) => String(item || '').trim());
  if (values.some((item) => !item || item.length > 80)) {
    throw badRequest(`${fieldName} contains an invalid value`, 'VALIDATION_ERROR');
  }
  return [...new Set(values)];
}

export function normalizeScope(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const projectFilter = raw.projectFilter && typeof raw.projectFilter === 'object' && !Array.isArray(raw.projectFilter)
    ? {
        keyword: String(raw.projectFilter.keyword || '').trim().slice(0, 160),
        status: String(raw.projectFilter.status || '').trim().slice(0, 30),
        category: String(raw.projectFilter.category || '').trim().slice(0, 120)
      }
    : { keyword: '', status: '', category: '' };
  return {
    years: numberList(raw.years, 'scope.years', { min: 2000, max: 2100 }),
    groups: textList(raw.groups, 'scope.groups'),
    materialTaskIds: numberList(raw.materialTaskIds, 'scope.materialTaskIds'),
    projectIds: numberList(raw.projectIds, 'scope.projectIds'),
    selectionMode: ['selected', 'filtered', 'scope'].includes(raw.selectionMode) ? raw.selectionMode : 'scope',
    snapshotLocked: raw.snapshotLocked === true,
    projectFilter
  };
}

function addInCondition(conditions, params, column, values) {
  if (!values.length) return;
  conditions.push(`${column} IN (${values.map(() => '?').join(',')})`);
  params.push(...values);
}

function missingReason(row) {
  if (!row.latestSubmissionId) return '未提交：没有任何提交记录';
  if (row.latestReviewStatus === 'pending') return '待审核：没有审核通过版本';
  if (row.latestReviewStatus === 'returned') return `已退回：没有审核通过版本${row.latestReturnReason ? `（${row.latestReturnReason}）` : ''}`;
  return '没有可导出的审核通过版本';
}

export async function expectedMaterials(scope, templateConfig) {
  const conditions = [
    'mt.deleted_at IS NULL',
    "mt.status IN ('published', 'closed')",
    'mc.deleted_at IS NULL',
    'p.deleted_at IS NULL'
  ];
  const params = [];
  addInCondition(conditions, params, 'p.project_year', scope.years);
  addInCondition(conditions, params, 'p.project_group', scope.groups);
  addInCondition(conditions, params, 'mt.id', scope.materialTaskIds);
  addInCondition(conditions, params, 'p.id', scope.projectIds);
  if (templateConfig.version === 2) {
    addInCondition(conditions, params, 'mc.id', archivePlacements(templateConfig).map((item) => item.fileTaskId));
  }
  const [rows] = await pool.execute(
    `SELECT mt.id AS taskId, mt.task_name AS taskName,
            p.id AS projectId, p.project_year AS projectYear, p.project_group AS projectGroup,
            p.project_code AS projectCode, p.title AS projectTitle,
            p.category AS projectCategory, p.approval_date AS approvalDate,
            mc.id AS categoryId, mc.category_name AS categoryName,
            COALESCE(owners.ownerNames, '未登记负责人') AS owner,
            COALESCE(owners.ownerIdentifiers, '未登记编号') AS ownerIdentifiers,
            COALESCE(owners.ownerOrganizations, '未登记单位') AS ownerOrganizations,
            COALESCE(owners.ownerPhones, '未登记电话') AS ownerPhone,
            COALESCE(members.memberNames, '未登记成员') AS memberNames,
            COALESCE(advisors.advisorNames, '未登记指导教师') AS advisorNames,
            CASE WHEN latest.review_status = 'approved' THEN latest.id END AS approvedSubmissionId,
            CASE WHEN latest.review_status = 'approved' THEN latest.submitted_at END AS approvedSubmittedAt,
            CASE WHEN latest.review_status = 'approved' THEN latest.reviewed_at END AS approvedAt,
            reviewer.display_name AS reviewerName, mc.is_required AS taskRequired,
            CASE WHEN (
              mt.project_scope_type = 'all'
              OR (mt.project_scope_type = 'year' AND mt.project_year = p.project_year)
              OR (mt.project_scope_type = 'group' AND mt.project_group = p.project_group)
              OR (mt.project_scope_type = 'custom' AND EXISTS (
                SELECT 1 FROM material_task_projects applicable_mtp
                WHERE applicable_mtp.material_task_id = mt.id AND applicable_mtp.project_id = p.id
              ))
            ) THEN 1 ELSE 0 END AS isApplicable,
            latest.id AS latestSubmissionId, latest.review_status AS latestReviewStatus,
            latest.return_reason AS latestReturnReason
     FROM material_tasks mt
     JOIN material_categories mc ON mc.material_task_id = mt.id
     JOIN projects p ON 1 = 1
     LEFT JOIN (
       SELECT pp.project_id,
              GROUP_CONCAT(pe.name ORDER BY pp.is_primary_owner DESC, pe.name SEPARATOR '、') AS ownerNames,
              GROUP_CONCAT(COALESCE(NULLIF(CASE WHEN pe.person_type = 'student' THEN pe.student_no ELSE pe.teacher_no END, ''), '未登记编号') ORDER BY pp.is_primary_owner DESC, pe.name SEPARATOR '、') AS ownerIdentifiers,
              GROUP_CONCAT(COALESCE(NULLIF(pe.college, ''), NULLIF(pe.unit, ''), '未登记单位') ORDER BY pp.is_primary_owner DESC, pe.name SEPARATOR '、') AS ownerOrganizations,
              GROUP_CONCAT(COALESCE(NULLIF(pe.phone, ''), '未登记电话') ORDER BY pp.is_primary_owner DESC, pe.name SEPARATOR '、') AS ownerPhones
       FROM project_participations pp
       JOIN people pe ON pe.id = pp.person_id AND pe.deleted_at IS NULL
       WHERE pp.role = 'owner' AND pp.deleted_at IS NULL
       GROUP BY pp.project_id
     ) owners ON owners.project_id = p.id
     LEFT JOIN (
       SELECT pp.project_id, GROUP_CONCAT(pe.name ORDER BY pe.name SEPARATOR '、') AS memberNames
       FROM project_participations pp
       JOIN people pe ON pe.id = pp.person_id AND pe.deleted_at IS NULL
       WHERE pp.role = 'member' AND pp.deleted_at IS NULL
       GROUP BY pp.project_id
     ) members ON members.project_id = p.id
     LEFT JOIN (
       SELECT pp.project_id, GROUP_CONCAT(pe.name ORDER BY pe.name SEPARATOR '、') AS advisorNames
       FROM project_participations pp
       JOIN people pe ON pe.id = pp.person_id AND pe.deleted_at IS NULL
       WHERE pp.role = 'advisor' AND pp.deleted_at IS NULL
       GROUP BY pp.project_id
     ) advisors ON advisors.project_id = p.id
     LEFT JOIN material_submissions latest ON latest.id = (
       SELECT candidate.id FROM material_submissions candidate
       WHERE candidate.material_task_id = mt.id
         AND candidate.project_id = p.id
         AND candidate.material_category_id = mc.id
         AND candidate.deleted_at IS NULL
       ORDER BY candidate.id DESC LIMIT 1
     )
     LEFT JOIN users reviewer ON reviewer.id = latest.reviewed_by AND reviewer.deleted_at IS NULL
     WHERE ${conditions.join(' AND ')}
     ORDER BY p.project_year, p.project_group, p.project_code, mt.id, mc.sort_order, mc.id`,
    params
  );
  const placements = new Map((templateConfig.version === 2 ? archivePlacements(templateConfig) : [])
    .map((item) => [Number(item.fileTaskId), item]));
  return rows.map((row) => {
    const placement = placements.get(Number(row.categoryId));
    const requiredMode = placement?.requiredMode || 'inherit';
    return {
      ...row,
      isApplicable: Boolean(row.isApplicable),
      effectiveRequired: requiredMode === 'required' || (requiredMode === 'inherit' && Boolean(row.taskRequired)),
      requiredMode,
      requiredReviewNeeded: Boolean(placement?.requiredReviewNeeded)
    };
  });
}

export async function submissionFiles(submissionIds) {
  if (!submissionIds.length) return new Map();
  const [rows] = await pool.execute(
    `SELECT submission_id AS submissionId, original_name AS originalName, storage_path AS storagePath,
            file_size AS fileSize, mime_type AS mimeType
     FROM material_files
     WHERE deleted_at IS NULL AND submission_id IN (${submissionIds.map(() => '?').join(',')})
     ORDER BY submission_id, id`,
    submissionIds
  );
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(Number(row.submissionId))) grouped.set(Number(row.submissionId), []);
    grouped.get(Number(row.submissionId)).push(row);
  }
  return grouped;
}

export function scopeLabel(scope) {
  const parts = [];
  if (scope.years.length) parts.push(`年度：${scope.years.join('、')}`);
  if (scope.groups.length) parts.push(`组别：${scope.groups.join('、')}`);
  if (scope.materialTaskIds.length) parts.push(`材料任务：${scope.materialTaskIds.length} 项`);
  if (scope.projectIds.length) parts.push(`项目：${scope.projectIds.length} 项`);
  return parts.length ? parts.join('；') : '全部已发布或已关闭材料任务及其适用项目';
}

function archiveRequiredFreeBytes(sourceBytes = 0) {
  return Math.ceil(env.archive.minFreeBytes + Math.max(0, Number(sourceBytes) || 0) * 1.1);
}

async function ensureDiskSpace(bytesNeeded = archiveRequiredFreeBytes()) {
  const requiredBytes = Math.max(0, Number(bytesNeeded) || 0);
  if (!requiredBytes) return;
  await fs.promises.mkdir(env.archive.root, { recursive: true });
  if (typeof fs.promises.statfs !== 'function') return;
  const stat = await fs.promises.statfs(env.archive.root);
  const available = Number(stat.bavail) * Number(stat.bsize);
  if (Number.isFinite(available) && available < requiredBytes) {
    throw badRequest('Export disk free space is below the configured limit', 'EXPORT_DISK_SPACE_LOW');
  }
}

async function estimateArchiveExport(scope, templateConfig) {
  const rows = await expectedMaterials(scope, templateConfig);
  const projectCount = new Set(rows.map((row) => Number(row.projectId))).size;
  const submissionIds = [...new Set(rows.map((row) => Number(row.approvedSubmissionId)).filter(Boolean))];
  const fileMap = await submissionFiles(submissionIds);
  let totalFileBytes = 0;
  for (const files of fileMap.values()) {
    for (const file of files) totalFileBytes += Number(file.fileSize) || 0;
  }
  return { rows, projectCount, totalFileBytes };
}

async function snapshotProjects(scope) {
  if (scope.snapshotLocked && scope.projectIds.length) return scope;
  if (scope.selectionMode === 'selected' && scope.projectIds.length) return { ...scope, snapshotLocked: true };
  if (scope.selectionMode === 'scope' && scope.projectIds.length) return { ...scope, snapshotLocked: true };
  const conditions = ['p.deleted_at IS NULL'];
  const params = [];
  addInCondition(conditions, params, 'p.project_year', scope.years);
  addInCondition(conditions, params, 'p.project_group', scope.groups);
  if (scope.projectFilter.status) { conditions.push('p.status = ?'); params.push(scope.projectFilter.status); }
  if (scope.projectFilter.category) { conditions.push('p.category = ?'); params.push(scope.projectFilter.category); }
  if (scope.projectFilter.keyword) {
    const keyword = `%${scope.projectFilter.keyword}%`;
    conditions.push(`(p.project_code LIKE ? OR p.title LIKE ? OR EXISTS (
      SELECT 1 FROM project_participations pp JOIN people pe ON pe.id = pp.person_id
      WHERE pp.project_id = p.id AND pp.role = 'owner' AND pp.deleted_at IS NULL AND pe.name LIKE ?
    ))`);
    params.push(keyword, keyword, keyword);
  }
  const [projects] = await pool.execute(
    `SELECT p.id FROM projects p WHERE ${conditions.join(' AND ')} ORDER BY p.id`, params
  );
  return { ...scope, projectIds: projects.map((row) => Number(row.id)), snapshotLocked: true };
}

export function archiveMaterialState(row) {
  if (!row.isApplicable) return 'not_applicable';
  if (row.latestReviewStatus === 'approved') return 'formal';
  if (row.effectiveRequired) {
    if (!row.latestSubmissionId) return 'required_missing';
    return row.latestReviewStatus === 'pending' ? 'required_pending' : 'required_returned';
  }
  if (!row.latestSubmissionId) return 'optional_skipped';
  return row.latestReviewStatus === 'pending' ? 'optional_pending' : 'optional_returned';
}

function preflightCounts(rows) {
  const projectIds = new Set(rows.map((row) => Number(row.projectId)));
  const applicableTasks = new Set();
  const counts = {
    projectCount: projectIds.size, applicableTaskCount: 0, formalMaterialCount: 0,
    requiredMissingCount: 0, requiredPendingCount: 0, requiredReturnedCount: 0,
    optionalNotSubmittedCount: 0, optionalAnomalyCount: 0, notApplicableCount: 0
  };
  for (const row of rows) {
    const state = archiveMaterialState(row);
    if (state === 'not_applicable') { counts.notApplicableCount += 1; continue; }
    applicableTasks.add(`${row.projectId}:${row.taskId}`);
    if (state === 'formal') counts.formalMaterialCount += 1;
    else if (state === 'required_missing') counts.requiredMissingCount += 1;
    else if (state === 'required_pending') counts.requiredPendingCount += 1;
    else if (state === 'required_returned') counts.requiredReturnedCount += 1;
    else if (state === 'optional_skipped') counts.optionalNotSubmittedCount += 1;
    else counts.optionalAnomalyCount += 1;
  }
  counts.applicableTaskCount = applicableTasks.size;
  counts.requiredIssueCount = counts.requiredMissingCount + counts.requiredPendingCount + counts.requiredReturnedCount;
  return counts;
}

async function loadEnabledTemplate(archiveTemplateId) {
  const [[template]] = await pool.execute(
    `SELECT id, template_config AS templateConfig
     FROM archive_templates WHERE id = ? AND status = 'enabled' AND deleted_at IS NULL LIMIT 1`,
    [archiveTemplateId]
  );
  if (!template) throw notFound('Enabled archive template not found');
  return normalizeArchiveTemplateConfig(template.templateConfig);
}

export async function preflightArchiveExport({ archiveTemplateId, rawScope }) {
  let scope = normalizeScope(rawScope);
  const templateConfig = await loadEnabledTemplate(archiveTemplateId);
  if (templateConfig.version === 2) {
    const placedTaskIds = new Set(archivePlacements(templateConfig).map((item) => item.materialTaskId));
    const invalidTaskIds = scope.materialTaskIds.filter((id) => !placedTaskIds.has(id));
    if (invalidTaskIds.length) throw badRequest('scope.materialTaskIds contains tasks not placed in this archive template', 'VALIDATION_ERROR');
  }
  scope = await snapshotProjects(scope);
  if (!scope.projectIds.length) throw badRequest('导出范围没有匹配项目', 'ARCHIVE_EXPORT_EMPTY_SCOPE');
  const estimate = await estimateArchiveExport(scope, templateConfig);
  if (estimate.projectCount > env.archive.maxProjects) throw badRequest(`Export project count exceeds the configured limit of ${env.archive.maxProjects}`, 'ARCHIVE_EXPORT_PROJECT_LIMIT');
  if (estimate.totalFileBytes > env.archive.maxTotalFileBytes) throw badRequest('Export source file size exceeds the configured limit', 'ARCHIVE_EXPORT_SIZE_LIMIT');
  const counts = preflightCounts(estimate.rows);
  counts.projectCount = scope.projectIds.length;
  return { scopeSnapshot: scope, counts, totalFileBytes: estimate.totalFileBytes };
}

async function withQueueLock(callback) {
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const [[lockRow]] = await connection.execute('SELECT GET_LOCK(?, 5) AS lockAcquired', [queueLockName]);
    locked = Number(lockRow.lockAcquired) === 1;
    if (!locked) throw tooManyRequests('Archive export queue is busy, please try again later', 'ARCHIVE_QUEUE_BUSY');
    return await callback(connection);
  } finally {
    if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [queueLockName]).catch(() => undefined);
    connection.release();
  }
}

async function assertQueueHasCapacity(connection) {
  const [[queueCount]] = await connection.execute(
    "SELECT COUNT(*) AS total FROM archive_export_records WHERE export_status IN ('queued', 'processing')"
  );
  if (Number(queueCount.total) >= env.archive.maxQueued) {
    throw tooManyRequests('Too many archive exports are already queued', 'ARCHIVE_QUEUE_FULL');
  }
}

export async function validateAndEnqueueArchiveExport({ userId, archiveTemplateId, rawScope, remark }) {
  const preflight = await preflightArchiveExport({ archiveTemplateId, rawScope });
  const scope = preflight.scopeSnapshot;
  const cleanRemark = String(remark || '').trim();
  if (cleanRemark.length > 1000) throw badRequest('remark is too long', 'VALIDATION_ERROR');
  const templateConfig = await loadEnabledTemplate(archiveTemplateId);
  const estimate = await estimateArchiveExport(scope, templateConfig);
  if (estimate.projectCount > env.archive.maxProjects) {
    throw badRequest(`Export project count exceeds the configured limit of ${env.archive.maxProjects}`, 'ARCHIVE_EXPORT_PROJECT_LIMIT');
  }
  if (estimate.totalFileBytes > env.archive.maxTotalFileBytes) {
    throw badRequest('Export source file size exceeds the configured limit', 'ARCHIVE_EXPORT_SIZE_LIMIT');
  }
  await ensureDiskSpace(archiveRequiredFreeBytes(estimate.totalFileBytes));

  return withQueueLock(async (connection) => {
    await assertQueueHasCapacity(connection);
    const [result] = await connection.execute(
      `INSERT INTO archive_export_records
       (export_user_id, archive_template_id, export_scope, template_snapshot, export_status, max_attempts, remark)
       VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
      [userId, archiveTemplateId, JSON.stringify(scope), JSON.stringify(templateConfig), env.archive.maxAttempts, cleanRemark || null]
    );
    return { id: result.insertId, exportStatus: 'queued', preflight: preflight.counts };
  });
}

async function writeZip({ temporaryPath, finalPath, templateConfig, scope, rows, fileMap, exportId }) {
  await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });
  const output = fs.createWriteStream(temporaryPath);
  const zip = archiver('zip', { zlib: { level: 9 } });
  const completed = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    zip.on('error', reject);
    zip.on('warning', reject);
  });
  zip.pipe(output);

  const usedEntries = new Set();
  const exportedRows = [];
  const missingRows = [];
  const optionalStatusRows = [];
  const matrixRows = [];
  let approvedMaterialCount = 0;
  let exportedFileCount = 0;

  const exportBatch = `ARCH-${String(exportId).padStart(6, '0')}`;
  const exportDate = new Date();
  const projectSequences = new Map();
  const placementSequences = new Map(
    (templateConfig.version === 2 ? archivePlacements(templateConfig) : [])
      .map((item, index) => [Number(item.fileTaskId), index + 1])
  );
  const fallbackMaterialSequences = new Map();
  const fallbackMaterialCounters = new Map();
  const archiveRows = rows.map((row) => {
    const projectId = Number(row.projectId);
    if (!projectSequences.has(projectId)) projectSequences.set(projectId, projectSequences.size + 1);
    const fallbackKey = `${projectId}:${Number(row.categoryId)}`;
    if (!fallbackMaterialSequences.has(fallbackKey)) {
      const next = (fallbackMaterialCounters.get(projectId) || 0) + 1;
      fallbackMaterialCounters.set(projectId, next);
      fallbackMaterialSequences.set(fallbackKey, next);
    }
    return {
      ...row,
      projectSequence: projectSequences.get(projectId),
      materialSequence: placementSequences.get(Number(row.categoryId)) || fallbackMaterialSequences.get(fallbackKey),
      exportBatch,
      exportDate
    };
  });

  if (templateConfig.version === 2 && templateConfig.preserveEmptyFolders) {
    const projects = new Map();
    for (const row of archiveRows) {
      if (!projects.has(Number(row.projectId))) projects.set(Number(row.projectId), row);
    }
    for (const project of projects.values()) {
      for (const folder of renderArchiveFolders(templateConfig, project)) {
        const entryName = `${folder.replace(/\/+$/, '')}/`;
        const key = entryName.toLocaleLowerCase();
        if (usedEntries.has(key)) continue;
        usedEntries.add(key);
        zip.append('', { name: entryName });
      }
    }
  }

  for (const row of archiveRows) {
    const requiredText = row.effectiveRequired ? '必填' : '选填';
    const applicabilityText = row.isApplicable ? '适用' : '不适用';
    const stateText = !row.isApplicable ? '不适用'
      : !row.latestSubmissionId ? '未提交'
        : row.latestReviewStatus === 'approved' ? '审核通过'
          : row.latestReviewStatus === 'pending' ? '待审核' : '已退回';
    const stateReason = !row.isApplicable ? '任务未实际发布给该项目'
      : row.latestReviewStatus === 'returned' ? (row.latestReturnReason || '审核退回') : stateText;
    matrixRows.push([row.projectSequence, row.projectYear, row.projectGroup || '', row.projectCode, row.projectTitle,
      row.taskName, row.categoryName, applicabilityText, requiredText, row.requiredMode, stateText, stateReason]);
    if (!row.isApplicable) continue;
    if (!row.approvedSubmissionId) {
      if (row.effectiveRequired) {
        missingRows.push([
          row.projectSequence, row.projectYear, row.projectGroup || '', row.projectCode, row.projectTitle, row.owner, row.ownerPhone,
          row.taskName, row.categoryName, missingReason(row)
        ]);
      } else if (row.latestSubmissionId) {
        optionalStatusRows.push([
          row.projectSequence, row.projectYear, row.projectGroup || '', row.projectCode, row.projectTitle,
          row.taskName, row.categoryName, stateText, stateReason
        ]);
      }
      continue;
    }
    const files = fileMap.get(Number(row.approvedSubmissionId)) || [];
    let materialFileCount = 0;
    for (const file of files) {
      let sourcePath;
      try {
        sourcePath = await resolveDownloadFile(env.upload.root, file.storagePath, {
          invalidMessage: 'Submission file path is outside the system upload directory',
          invalidCode: 'SUBMISSION_FILE_PATH_INVALID',
          missingMessage: 'Submission file not found'
        });
      } catch (error) {
        const reason = error?.code === 'SUBMISSION_FILE_PATH_INVALID'
          ? `审核通过版本的文件路径不在系统上传目录：${file.originalName}`
          : `审核通过版本的文件不存在：${file.originalName}`;
        const target = row.effectiveRequired ? missingRows : optionalStatusRows;
        target.push(row.effectiveRequired
          ? [row.projectSequence, row.projectYear, row.projectGroup || '', row.projectCode, row.projectTitle, row.owner, row.ownerPhone, row.taskName, row.categoryName, reason]
          : [row.projectSequence, row.projectYear, row.projectGroup || '', row.projectCode, row.projectTitle, row.taskName, row.categoryName, '文件异常', reason]);
        continue;
      }
      const rendered = renderArchivePath(templateConfig, { ...row, originalName: file.originalName });
      if (rendered.placed === false) continue;
      const desiredEntry = path.posix.join(...rendered.directorySegments, rendered.fileName);
      const archiveEntry = uniqueArchiveEntry(desiredEntry, usedEntries);
      zip.file(sourcePath, { name: archiveEntry });
      materialFileCount += 1;
      exportedFileCount += 1;
      exportedRows.push([
        row.projectSequence, row.projectYear, row.projectGroup || '', row.projectCode, row.projectTitle, row.owner, row.ownerPhone,
        row.taskName, row.categoryName, file.originalName, archiveEntry,
        row.approvedSubmissionId, row.approvedAt || ''
      ]);
    }
    if (materialFileCount) approvedMaterialCount += 1;
    if (!files.length) {
      const reason = '审核通过版本没有关联文件';
      (row.effectiveRequired ? missingRows : optionalStatusRows).push(row.effectiveRequired
        ? [row.projectSequence, row.projectYear, row.projectGroup || '', row.projectCode, row.projectTitle, row.owner, row.ownerPhone, row.taskName, row.categoryName, reason]
        : [row.projectSequence, row.projectYear, row.projectGroup || '', row.projectCode, row.projectTitle, row.taskName, row.categoryName, '文件异常', reason]);
    }
  }

  if (!rows.length) {
    missingRows.push(['', '', '', '', '', '', '', '', '', '导出范围内没有匹配的材料任务、项目或材料类别']);
  }

  zip.append(await xlsxBuffer(
    ['项目序号', '年度', '组别', '项目编号', '作品名称', '负责人', '负责人电话', '材料任务', '材料类别', '原文件名', 'ZIP 内路径', '提交版本ID', '审核通过时间'],
    exportedRows,
    '导出材料清单'
  ), { name: uniqueArchiveEntry('导出材料清单.xlsx', usedEntries) });

  if (missingRows.length) {
    zip.append(await xlsxBuffer(
      ['项目序号', '年度', '组别', '项目编号', '作品名称', '负责人', '负责人电话', '材料任务', '材料类别', '缺失原因'],
      missingRows,
      '缺失材料报告'
    ), { name: uniqueArchiveEntry('缺失材料报告.xlsx', usedEntries) });
  }

  if (optionalStatusRows.length) {
    zip.append(await xlsxBuffer(
      ['项目序号', '年度', '组别', '项目编号', '作品名称', '材料任务', '材料类别', '状态', '说明'],
      optionalStatusRows,
      '选填材料状态报告'
    ), { name: uniqueArchiveEntry('选填材料状态报告.xlsx', usedEntries) });
  }

  zip.append(await xlsxBuffer(
    ['项目序号', '年度', '组别', '项目编号', '作品名称', '材料任务', '材料类别', '适用性', '必填性', '模板规则', '状态', '原因'],
    matrixRows,
    '材料适用性明细'
  ), { name: uniqueArchiveEntry('材料适用性明细.xlsx', usedEntries) });

  const summaryLines = [
    `导出记录：${exportId}`,
    `生成时间：${new Date().toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}`,
    `导出范围：${scopeLabel(scope)}`,
    `应收材料项：${rows.length}`,
    `包含审核通过材料项：${approvedMaterialCount}`,
    `导出文件数：${exportedFileCount}`,
    `缺失报告条目：${missingRows.length}`,
    `选填异常条目：${optionalStatusRows.length}`,
    '',
    '正式材料目录只包含每项材料最新一次“审核通过”的提交版本。',
    '必填材料的待审核、退回和未提交进入缺失报告；选填材料未提交正常跳过，待审核或退回进入单独状态报告。',
    '未实际发布给项目的任务标记为不适用，不计入缺失。'
  ];
  zip.append(summaryLines.join('\r\n'), { name: uniqueArchiveEntry('导出说明.txt', usedEntries) });

  await zip.finalize();
  await completed;
  await fs.promises.rename(temporaryPath, finalPath);
  const stat = await fs.promises.stat(finalPath);
  return {
    expectedMaterialCount: rows.length,
    approvedMaterialCount,
    exportedFileCount,
    missingCount: missingRows.length,
    missingReportIncluded: missingRows.length > 0,
    optionalIssueCount: optionalStatusRows.length,
    optionalStatusReportIncluded: optionalStatusRows.length > 0,
    matrixReportIncluded: true,
    fileSize: stat.size
  };
}

async function runArchiveExport(record) {
  let temporaryPath;
  const scope = normalizeScope(parseJson(record.exportScope, {}));
  const templateConfig = normalizeArchiveTemplateConfig(parseJson(record.templateSnapshot, {}));
  const rows = await expectedMaterials(scope, templateConfig);
  const projectCount = new Set(rows.map((row) => Number(row.projectId))).size;
  if (projectCount > env.archive.maxProjects) {
    throw badRequest(`Export project count exceeds the configured limit of ${env.archive.maxProjects}`, 'ARCHIVE_EXPORT_PROJECT_LIMIT');
  }
  const submissionIds = [...new Set(rows.map((row) => Number(row.approvedSubmissionId)).filter(Boolean))];
  const fileMap = await submissionFiles(submissionIds);
  let totalFileBytes = 0;
  for (const files of fileMap.values()) {
    for (const file of files) totalFileBytes += Number(file.fileSize) || 0;
  }
  if (totalFileBytes > env.archive.maxTotalFileBytes) {
    throw badRequest('Export source file size exceeds the configured limit', 'ARCHIVE_EXPORT_SIZE_LIMIT');
  }
  await ensureDiskSpace(archiveRequiredFreeBytes(totalFileBytes));
  const finalPath = path.join(env.archive.root, `archive-export-${record.id}.zip`);
  temporaryPath = `${finalPath}.tmp`;
  try {
    const temporaryCleanup = await deleteFileIfInside(env.archive.root, temporaryPath);
    if (!temporaryCleanup.cleanupSafe) throw badRequest('Previous temporary export file cannot be cleaned up', 'ARCHIVE_EXPORT_FILE_BUSY');
    const finalCleanup = await deleteFileIfInside(env.archive.root, finalPath);
    if (!finalCleanup.cleanupSafe) throw badRequest('Previous archive export file cannot be cleaned up', 'ARCHIVE_EXPORT_FILE_BUSY');
    const summary = await writeZip({ temporaryPath, finalPath, templateConfig, scope, rows, fileMap, exportId: record.id });
    await pool.execute(
      `UPDATE archive_export_records
       SET export_file_path = ?, export_summary = ?, export_status = 'success',
           failure_reason = NULL, worker_id = NULL, heartbeat_at = NULL, finished_at = NOW()
       WHERE id = ?`,
      [finalPath, JSON.stringify(summary), record.id]
    );
  } catch (error) {
    if (temporaryPath) await fs.promises.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function markExportFailedOrRetry(record, error) {
  const reason = String(error?.message || 'Unknown export error').slice(0, 1000);
  const exhausted = Number(record.attemptCount) >= Number(record.maxAttempts);
  if (exhausted) {
    await pool.execute(
      `UPDATE archive_export_records
       SET export_status = 'failed', failure_reason = ?, worker_id = NULL, heartbeat_at = NULL, finished_at = NOW()
       WHERE id = ?`,
      [reason, record.id]
    );
    return;
  }
  await pool.execute(
    `UPDATE archive_export_records
     SET export_status = 'queued', failure_reason = ?, worker_id = NULL, heartbeat_at = NULL
     WHERE id = ?`,
    [reason, record.id]
  );
}

export async function recoverTimedOutArchiveExports() {
  const timeoutSeconds = Math.max(1, Math.ceil(env.archive.workerTimeoutMs / 1000));
  await pool.execute(
    `UPDATE archive_export_records
     SET export_status = 'failed',
         failure_reason = 'Archive export worker heartbeat timed out and retry limit has been reached',
         worker_id = NULL,
         heartbeat_at = NULL,
         finished_at = NOW()
     WHERE export_status = 'processing'
       AND attempt_count >= max_attempts
       AND (heartbeat_at IS NULL OR heartbeat_at < DATE_SUB(NOW(), INTERVAL ${timeoutSeconds} SECOND))`
  );
  await pool.execute(
    `UPDATE archive_export_records
     SET export_status = 'queued',
         failure_reason = 'Archive export worker heartbeat timed out; task has been requeued',
         worker_id = NULL,
         heartbeat_at = NULL
     WHERE export_status = 'processing'
       AND attempt_count < max_attempts
       AND (heartbeat_at IS NULL OR heartbeat_at < DATE_SUB(NOW(), INTERVAL ${timeoutSeconds} SECOND))`
  );
}

async function claimNextArchiveExport(workerId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, export_scope AS exportScope, template_snapshot AS templateSnapshot,
              attempt_count AS attemptCount, max_attempts AS maxAttempts
       FROM archive_export_records
       WHERE export_status = 'queued' AND attempt_count < max_attempts
       ORDER BY created_at, id
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );
    if (!rows[0]) {
      await connection.commit();
      return null;
    }
    await connection.execute(
      `UPDATE archive_export_records
       SET export_status = 'processing', attempt_count = attempt_count + 1,
           started_at = NOW(), heartbeat_at = NOW(), worker_id = ?, finished_at = NULL
       WHERE id = ?`,
      [workerId, rows[0].id]
    );
    await connection.commit();
    return { ...rows[0], attemptCount: Number(rows[0].attemptCount) + 1 };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function processNextArchiveExport(workerId) {
  await recoverTimedOutArchiveExports();
  const lockConnection = await pool.getConnection();
  let locked = false;
  try {
    const [[lockRow]] = await lockConnection.execute('SELECT GET_LOCK(?, 0) AS lockAcquired', [workerLockName]);
    locked = Number(lockRow.lockAcquired) === 1;
    if (!locked) return false;
    const record = await claimNextArchiveExport(workerId);
    if (!record) return false;
    const heartbeat = setInterval(() => {
      pool.execute(
        "UPDATE archive_export_records SET heartbeat_at = NOW() WHERE id = ? AND export_status = 'processing'",
        [record.id]
      ).catch((error) => console.error(`Cannot update archive export heartbeat ${record.id}`, error));
    }, env.archive.workerHeartbeatMs);
    try {
      await runArchiveExport(record);
    } catch (error) {
      console.error(`Archive export ${record.id} failed`, error);
      await markExportFailedOrRetry(record, error);
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  } finally {
    if (locked) await lockConnection.execute('SELECT RELEASE_LOCK(?)', [workerLockName]).catch(() => undefined);
    lockConnection.release();
  }
}

export async function retryArchiveExport(exportId) {
  await withQueueLock(async (connection) => {
    await assertQueueHasCapacity(connection);
    const [result] = await connection.execute(
      `UPDATE archive_export_records
       SET export_status = 'queued', attempt_count = 0, started_at = NULL, heartbeat_at = NULL,
           worker_id = NULL, failure_reason = NULL, finished_at = NULL
       WHERE id = ? AND export_status = 'failed'`,
      [exportId]
    );
    if (!result.affectedRows) throw badRequest('Only failed archive exports can be retried', 'ARCHIVE_EXPORT_NOT_RETRYABLE');
  });
}

async function deleteFileIfInside(rootPath, storedPath) {
  const rawPath = typeof storedPath === 'string' ? storedPath.trim() : '';
  if (!rawPath || rawPath.includes('\0')) return { cleanupSafe: false, deleted: false };
  const rootRealPath = await fs.promises.realpath(rootPath).catch(() => null);
  if (!rootRealPath) return { cleanupSafe: false, deleted: false };
  const candidatePath = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(rootPath, rawPath);
  if (!isPathInside(rootRealPath, candidatePath)) return { cleanupSafe: false, deleted: false };
  let fileRealPath;
  try {
    fileRealPath = await fs.promises.realpath(candidatePath);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { cleanupSafe: true, deleted: false, missing: true };
    return { cleanupSafe: false, deleted: false, error };
  }
  if (!isPathInside(rootRealPath, fileRealPath)) return { cleanupSafe: false, deleted: false };
  const stat = await fs.promises.stat(fileRealPath).catch((error) => ({ error }));
  if (stat?.error) return { cleanupSafe: false, deleted: false, error: stat.error };
  if (!stat?.isFile()) return { cleanupSafe: false, deleted: false };
  try {
    await fs.promises.unlink(fileRealPath);
    return { cleanupSafe: true, deleted: true };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { cleanupSafe: true, deleted: false, missing: true };
    return { cleanupSafe: false, deleted: false, error };
  }
}

async function cleanupOldArchiveZips() {
  const days = Math.max(1, env.archive.zipRetentionDays);
  const [rows] = await pool.execute(
    `SELECT id, export_file_path AS exportFilePath
     FROM archive_export_records
     WHERE export_status = 'success'
       AND export_file_path IS NOT NULL
       AND finished_at IS NOT NULL
       AND finished_at < DATE_SUB(NOW(), INTERVAL ${days} DAY)
     LIMIT 200`
  );
  for (const row of rows) {
    const cleanup = await deleteFileIfInside(env.archive.root, row.exportFilePath);
    if (cleanup.cleanupSafe) {
      await pool.execute(
        'UPDATE archive_export_records SET export_file_path = NULL, zip_cleanup_at = NOW() WHERE id = ?',
        [row.id]
      );
    } else if (cleanup.error) {
      console.error(`Cannot delete expired archive ZIP for export ${row.id}`, cleanup.error);
    }
  }
}

async function cleanupOrphanArchiveZips() {
  await fs.promises.mkdir(env.archive.root, { recursive: true });
  const rootRealPath = await fs.promises.realpath(env.archive.root).catch(() => null);
  if (!rootRealPath) return;
  const [rows] = await pool.execute(
    'SELECT export_file_path AS exportFilePath FROM archive_export_records WHERE export_file_path IS NOT NULL'
  );
  const referenced = new Set();
  for (const row of rows) {
    const rawPath = String(row.exportFilePath || '').trim();
    if (!rawPath || rawPath.includes('\0')) continue;
    const candidatePath = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(env.archive.root, rawPath);
    if (!isPathInside(rootRealPath, candidatePath)) continue;
    referenced.add(path.resolve(candidatePath).toLocaleLowerCase());
  }
  const cutoff = Date.now() - Math.max(env.archive.workerTimeoutMs, 60 * 60 * 1000);
  const entries = await fs.promises.readdir(env.archive.root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !/^archive-export-\d+(?:-\d{14})?\.zip$/i.test(entry.name)) continue;
    const filePath = path.join(env.archive.root, entry.name);
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat || stat.mtimeMs >= cutoff) continue;
    if (referenced.has(path.resolve(filePath).toLocaleLowerCase())) continue;
    await fs.promises.unlink(filePath).catch((error) => console.error(`Cannot delete orphan archive ZIP ${filePath}`, error));
  }
}

async function cleanupTemporaryExportFiles() {
  await fs.promises.mkdir(env.archive.root, { recursive: true });
  const entries = await fs.promises.readdir(env.archive.root, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - Math.max(env.archive.workerTimeoutMs, 60 * 60 * 1000);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.tmp')) continue;
    const filePath = path.join(env.archive.root, entry.name);
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) await fs.promises.unlink(filePath).catch(() => undefined);
  }
}

async function cleanupImportBatches() {
  const entries = await fs.promises.readdir(batchDir, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - env.archive.importBatchRetentionHours * 60 * 60 * 1000;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(batchDir, entry.name);
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat) continue;
    let expired = stat.mtimeMs < cutoff;
    if (!expired) {
      try {
        const batch = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
        expired = batch.expiresAt && new Date(batch.expiresAt).getTime() < Date.now();
      } catch {
        expired = true;
      }
    }
    if (expired) await fs.promises.unlink(filePath).catch(() => undefined);
  }
}

export async function cleanupArchiveStorage() {
  await Promise.all([
    cleanupOldArchiveZips(),
    cleanupOrphanArchiveZips(),
    cleanupTemporaryExportFiles(),
    cleanupImportBatches()
  ]);
}

export function defaultArchiveWorkerId() {
  return `${os.hostname()}-${process.pid}`;
}
