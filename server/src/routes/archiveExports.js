import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { Router } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  archivePlacements,
  normalizeArchiveTemplateConfig,
  renderArchiveFolders,
  renderArchivePath,
  uniqueArchiveEntry,
  xlsxBuffer
} from '../utils/archive.js';
import { resolveDownloadFile } from '../utils/safeFiles.js';
import { badRequest, notFound } from '../utils/errors.js';
import { paginationFrom } from '../utils/query.js';
import { success } from '../utils/response.js';

const router = Router();
const exportStatuses = ['processing', 'success', 'failed'];

function parseJson(value, fallback) {
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

function normalizeScope(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    years: numberList(raw.years, 'scope.years', { min: 2000, max: 2100 }),
    groups: textList(raw.groups, 'scope.groups'),
    materialTaskIds: numberList(raw.materialTaskIds, 'scope.materialTaskIds'),
    projectIds: numberList(raw.projectIds, 'scope.projectIds')
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

async function expectedMaterials(scope, templateConfig) {
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
            approved.id AS approvedSubmissionId, approved.submitted_at AS approvedSubmittedAt,
            approved.reviewed_at AS approvedAt, reviewer.display_name AS reviewerName,
            latest.id AS latestSubmissionId, latest.review_status AS latestReviewStatus,
            latest.return_reason AS latestReturnReason
     FROM material_tasks mt
     JOIN material_categories mc ON mc.material_task_id = mt.id
     JOIN projects p ON (
       mt.project_scope_type = 'all'
       OR (mt.project_scope_type = 'year' AND mt.project_year = p.project_year)
       OR (mt.project_scope_type = 'group' AND mt.project_group = p.project_group)
       OR (mt.project_scope_type = 'custom' AND EXISTS (
         SELECT 1 FROM material_task_projects mtp
         WHERE mtp.material_task_id = mt.id AND mtp.project_id = p.id
       ))
     )
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
     LEFT JOIN material_submissions approved ON approved.id = (
       SELECT candidate.id FROM material_submissions candidate
       WHERE candidate.material_task_id = mt.id
         AND candidate.project_id = p.id
         AND candidate.material_category_id = mc.id
         AND candidate.review_status = 'approved'
         AND candidate.deleted_at IS NULL
       ORDER BY COALESCE(candidate.reviewed_at, candidate.submitted_at, candidate.created_at) DESC, candidate.id DESC
       LIMIT 1
     )
     LEFT JOIN users reviewer ON reviewer.id = approved.reviewed_by AND reviewer.deleted_at IS NULL
     LEFT JOIN material_submissions latest ON latest.id = (
       SELECT candidate.id FROM material_submissions candidate
       WHERE candidate.material_task_id = mt.id
         AND candidate.project_id = p.id
         AND candidate.material_category_id = mc.id
         AND candidate.deleted_at IS NULL
       ORDER BY candidate.id DESC LIMIT 1
     )
     WHERE ${conditions.join(' AND ')}
     ORDER BY p.project_year, p.project_group, p.project_code, mt.id, mc.sort_order, mc.id`,
    params
  );
  return rows;
}

async function submissionFiles(submissionIds) {
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

function scopeLabel(scope) {
  const parts = [];
  if (scope.years.length) parts.push(`年度：${scope.years.join('、')}`);
  if (scope.groups.length) parts.push(`组别：${scope.groups.join('、')}`);
  if (scope.materialTaskIds.length) parts.push(`材料任务：${scope.materialTaskIds.length} 项`);
  if (scope.projectIds.length) parts.push(`项目：${scope.projectIds.length} 项`);
  return parts.length ? parts.join('；') : '全部已发布或已关闭材料任务及其适用项目';
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
    if (!row.approvedSubmissionId) {
      missingRows.push([
        row.projectSequence, row.projectYear, row.projectGroup || '', row.projectCode, row.projectTitle, row.owner, row.ownerPhone,
        row.taskName, row.categoryName, missingReason(row)
      ]);
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
        missingRows.push([
          row.projectSequence, row.projectYear, row.projectGroup || '', row.projectCode, row.projectTitle, row.owner, row.ownerPhone,
          row.taskName, row.categoryName, reason
        ]);
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
      missingRows.push([
        row.projectSequence, row.projectYear, row.projectGroup || '', row.projectCode, row.projectTitle, row.owner, row.ownerPhone,
        row.taskName, row.categoryName, '审核通过版本没有关联文件'
      ]);
    }
  }

  if (!rows.length) {
    missingRows.push(['', '', '', '', '', '', '', '', '', '导出范围内没有匹配的材料任务、项目或材料类别']);
  }

  zip.append(xlsxBuffer(
    ['项目序号', '年度', '组别', '项目编号', '作品名称', '负责人', '负责人电话', '材料任务', '材料类别', '原文件名', 'ZIP 内路径', '提交版本ID', '审核通过时间'],
    exportedRows,
    '导出材料清单'
  ), { name: uniqueArchiveEntry('导出材料清单.xlsx', usedEntries) });

  if (missingRows.length) {
    zip.append(xlsxBuffer(
      ['项目序号', '年度', '组别', '项目编号', '作品名称', '负责人', '负责人电话', '材料任务', '材料类别', '缺失原因'],
      missingRows,
      '缺失材料报告'
    ), { name: uniqueArchiveEntry('缺失材料报告.xlsx', usedEntries) });
  }

  const summaryLines = [
    `导出记录：${exportId}`,
    `生成时间：${new Date().toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}`,
    `导出范围：${scopeLabel(scope)}`,
    `应收材料项：${rows.length}`,
    `包含审核通过材料项：${approvedMaterialCount}`,
    `导出文件数：${exportedFileCount}`,
    `缺失报告条目：${missingRows.length}`,
    '',
    '正式材料目录只包含每项材料最新一次“审核通过”的提交版本。',
    '待审核、退回和未提交材料不会进入正式材料目录；没有审核通过版本的项目会列入缺失材料报告。'
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
    fileSize: stat.size
  };
}

async function processArchiveExport(exportId) {
  let temporaryPath;
  try {
    const [[record]] = await pool.execute(
      `SELECT id, export_scope AS exportScope, template_snapshot AS templateSnapshot
       FROM archive_export_records WHERE id = ? AND export_status = 'processing' LIMIT 1`,
      [exportId]
    );
    if (!record) return;
    const scope = normalizeScope(parseJson(record.exportScope, {}));
    const templateConfig = normalizeArchiveTemplateConfig(parseJson(record.templateSnapshot, {}));
    const rows = await expectedMaterials(scope, templateConfig);
    const submissionIds = [...new Set(rows.map((row) => Number(row.approvedSubmissionId)).filter(Boolean))];
    const fileMap = await submissionFiles(submissionIds);
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const finalPath = path.join(env.archive.root, `archive-export-${exportId}-${stamp}.zip`);
    temporaryPath = `${finalPath}.tmp`;
    const summary = await writeZip({ temporaryPath, finalPath, templateConfig, scope, rows, fileMap, exportId });
    await pool.execute(
      `UPDATE archive_export_records
       SET export_file_path = ?, export_summary = ?, export_status = 'success', failure_reason = NULL, finished_at = NOW()
       WHERE id = ?`,
      [finalPath, JSON.stringify(summary), exportId]
    );
  } catch (error) {
    if (temporaryPath) await fs.promises.unlink(temporaryPath).catch(() => undefined);
    const reason = String(error?.message || 'Unknown export error').slice(0, 1000);
    console.error(`Archive export ${exportId} failed`, error);
    await pool.execute(
      `UPDATE archive_export_records
       SET export_status = 'failed', failure_reason = ?, finished_at = NOW()
       WHERE id = ?`,
      [reason, exportId]
    ).catch((updateError) => console.error(`Cannot mark archive export ${exportId} as failed`, updateError));
  }
}

function mapRecord(row) {
  const exportScope = normalizeScope(parseJson(row.exportScope, {}));
  return {
    ...row,
    exportScope,
    exportScopeLabel: scopeLabel(exportScope),
    exportSummary: parseJson(row.exportSummary, null),
    downloadable: row.exportStatus === 'success'
  };
}

router.use(requireAuth, requireRole('admin'));

router.get('/options', async (_req, res, next) => {
  try {
    const [[years], [groups], [tasks], [projects]] = await Promise.all([
      pool.execute('SELECT DISTINCT project_year AS value FROM projects WHERE deleted_at IS NULL ORDER BY project_year DESC'),
      pool.execute("SELECT DISTINCT project_group AS value FROM projects WHERE deleted_at IS NULL AND project_group IS NOT NULL AND project_group <> '' ORDER BY project_group"),
      pool.execute("SELECT id, task_name AS taskName, status FROM material_tasks WHERE deleted_at IS NULL AND status IN ('published', 'closed') ORDER BY created_at DESC"),
      pool.execute('SELECT id, project_year AS projectYear, project_group AS projectGroup, project_code AS projectCode, title FROM projects WHERE deleted_at IS NULL ORDER BY project_year DESC, project_code')
    ]);
    success(res, {
      years: years.map((item) => Number(item.value)),
      groups: groups.map((item) => item.value),
      materialTasks: tasks,
      projects
    });
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { page, pageSize, offset } = paginationFrom(req.query);
    const conditions = ['aer.id IS NOT NULL'];
    const params = [];
    if (req.query.status) {
      if (!exportStatuses.includes(req.query.status)) throw badRequest('status is invalid', 'VALIDATION_ERROR');
      conditions.push('aer.export_status = ?');
      params.push(req.query.status);
    }
    const where = conditions.join(' AND ');
    const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM archive_export_records aer WHERE ${where}`, params);
    const [rows] = await pool.execute(
      `SELECT aer.id, aer.export_scope AS exportScope, aer.export_summary AS exportSummary,
              aer.export_status AS exportStatus, aer.failure_reason AS failureReason,
              aer.remark, aer.created_at AS createdAt, aer.finished_at AS finishedAt,
              COALESCE(at.template_name, '已删除模板') AS templateName,
              u.display_name AS exportUser
       FROM archive_export_records aer
       LEFT JOIN archive_templates at ON at.id = aer.archive_template_id
       JOIN users u ON u.id = aer.export_user_id
       WHERE ${where}
       ORDER BY aer.created_at DESC, aer.id DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    success(res, rows.map(mapRecord), 'ok', {
      pagination: {
        page,
        pageSize,
        total: Number(countRow.total),
        totalPages: Math.ceil(Number(countRow.total) / pageSize)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const archiveTemplateId = Number(req.body.archiveTemplateId);
    if (!archiveTemplateId) throw badRequest('archiveTemplateId is required', 'VALIDATION_ERROR');
    const scope = normalizeScope(req.body.scope);
    const remark = String(req.body.remark || '').trim();
    if (remark.length > 1000) throw badRequest('remark is too long', 'VALIDATION_ERROR');
    const [[template]] = await pool.execute(
      `SELECT id, template_config AS templateConfig
       FROM archive_templates WHERE id = ? AND status = 'enabled' AND deleted_at IS NULL LIMIT 1`,
      [archiveTemplateId]
    );
    if (!template) throw notFound('Enabled archive template not found');
    const templateConfig = normalizeArchiveTemplateConfig(template.templateConfig);
    if (templateConfig.version === 2) {
      const placedTaskIds = new Set(archivePlacements(templateConfig).map((item) => item.materialTaskId));
      const invalidTaskIds = scope.materialTaskIds.filter((id) => !placedTaskIds.has(id));
      if (invalidTaskIds.length) {
        throw badRequest('scope.materialTaskIds contains tasks not placed in this archive template', 'VALIDATION_ERROR');
      }
    }
    const [result] = await pool.execute(
      `INSERT INTO archive_export_records
       (export_user_id, archive_template_id, export_scope, template_snapshot, export_status, remark)
       VALUES (?, ?, ?, ?, 'processing', ?)`,
      [req.user.id, archiveTemplateId, JSON.stringify(scope), JSON.stringify(templateConfig), remark || null]
    );
    setImmediate(() => processArchiveExport(result.insertId));
    res.status(202);
    success(res, { id: result.insertId, exportStatus: 'processing' }, 'Archive export started');
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT aer.id, aer.export_scope AS exportScope, aer.export_summary AS exportSummary,
              aer.export_status AS exportStatus, aer.failure_reason AS failureReason,
              aer.remark, aer.created_at AS createdAt, aer.finished_at AS finishedAt,
              COALESCE(at.template_name, '已删除模板') AS templateName,
              u.display_name AS exportUser
       FROM archive_export_records aer
       LEFT JOIN archive_templates at ON at.id = aer.archive_template_id
       JOIN users u ON u.id = aer.export_user_id
       WHERE aer.id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) throw notFound('Archive export record not found');
    success(res, mapRecord(rows[0]));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/download', async (req, res, next) => {
  try {
    const [[record]] = await pool.execute(
      `SELECT export_file_path AS exportFilePath, export_status AS exportStatus
       FROM archive_export_records WHERE id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!record) throw notFound('Archive export record not found');
    if (record.exportStatus !== 'success' || !record.exportFilePath) {
      throw badRequest('Archive export is not ready for download', 'EXPORT_NOT_READY');
    }
    const filePath = await resolveDownloadFile(env.archive.root, record.exportFilePath, {
      invalidMessage: 'Export file path is outside the system export directory',
      invalidCode: 'EXPORT_PATH_INVALID',
      missingMessage: 'Archive export file not found'
    });
    res.download(filePath, path.basename(filePath));
  } catch (error) {
    next(error);
  }
});

export default router;
