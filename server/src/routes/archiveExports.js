import path from 'node:path';
import { Router } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireAdminPermission } from '../utils/adminPermissions.js';
import { badRequest, notFound } from '../utils/errors.js';
import { paginationFrom } from '../utils/query.js';
import { success } from '../utils/response.js';
import { resolveDownloadFile } from '../utils/safeFiles.js';
import {
  exportStatuses,
  normalizeScope,
  parseJson,
  retryArchiveExport,
  scopeLabel,
  validateAndEnqueueArchiveExport
} from '../services/archiveExportService.js';

const router = Router();

function mapRecord(row) {
  const exportScope = normalizeScope(parseJson(row.exportScope, {}));
  return {
    ...row,
    exportScope,
    exportScopeLabel: scopeLabel(exportScope),
    exportSummary: parseJson(row.exportSummary, null),
    downloadable: row.exportStatus === 'success' && Boolean(row.exportFilePath) && !row.zipCleanupAt
  };
}

router.use(requireAuth, requireRole('admin'), requireAdminPermission('archive_management'));

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
              aer.attempt_count AS attemptCount, aer.max_attempts AS maxAttempts,
              aer.started_at AS startedAt, aer.heartbeat_at AS heartbeatAt, aer.worker_id AS workerId,
              aer.export_file_path AS exportFilePath, aer.zip_cleanup_at AS zipCleanupAt,
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
    const queued = await validateAndEnqueueArchiveExport({
      userId: req.user.id,
      archiveTemplateId,
      rawScope: req.body.scope,
      remark: req.body.remark
    });
    res.status(202);
    success(res, queued, 'Archive export queued');
  } catch (error) {
    next(error);
  }
});

router.post('/:id/retry', async (req, res, next) => {
  try {
    await retryArchiveExport(req.params.id);
    success(res, { id: Number(req.params.id), exportStatus: 'queued' }, 'Archive export queued again');
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT aer.id, aer.export_scope AS exportScope, aer.export_summary AS exportSummary,
              aer.export_status AS exportStatus, aer.failure_reason AS failureReason,
              aer.attempt_count AS attemptCount, aer.max_attempts AS maxAttempts,
              aer.started_at AS startedAt, aer.heartbeat_at AS heartbeatAt, aer.worker_id AS workerId,
              aer.export_file_path AS exportFilePath, aer.zip_cleanup_at AS zipCleanupAt,
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
      `SELECT export_file_path AS exportFilePath, export_status AS exportStatus, zip_cleanup_at AS zipCleanupAt
       FROM archive_export_records WHERE id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!record) throw notFound('Archive export record not found');
    if (record.exportStatus !== 'success' || !record.exportFilePath || record.zipCleanupAt) {
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
