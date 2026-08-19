import { Router } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireAdminPermission } from '../utils/adminPermissions.js';
import { badRequest, notFound } from '../utils/errors.js';
import { paginationFrom, requiredText } from '../utils/query.js';
import { success } from '../utils/response.js';
import { resolveDownloadFile } from '../utils/safeFiles.js';
import {
  DEFAULT_REPORT_CONFIG,
  REPORT_FIELD_GROUPS,
  normalizeReportDesignConfig,
  reportPreviewGrid
} from '../utils/reportDesign.js';
import {
  reportExportStatuses,
  reportProjects,
  reportScopeLabel,
  retryReportExport,
  validateAndEnqueueReportExport
} from '../services/reportExportService.js';
import { normalizeScope, parseJson } from '../services/archiveExportService.js';

const router = Router();
const statuses = ['enabled', 'disabled'];

function designPayload(body) {
  const status = body.status || 'enabled';
  if (!statuses.includes(status)) throw badRequest('status is invalid', 'VALIDATION_ERROR');
  return {
    designName: requiredText(body.designName, 'designName', 160),
    designConfig: normalizeReportDesignConfig(body.designConfig),
    status
  };
}

function mapDesign(row) {
  return {
    ...row,
    designConfig: normalizeReportDesignConfig(row.designConfig)
  };
}

function mapExport(row) {
  const exportScope = normalizeScope(parseJson(row.exportScope, {}));
  return {
    ...row,
    exportScope,
    exportScopeLabel: reportScopeLabel(exportScope),
    exportSummary: parseJson(row.exportSummary, null),
    designSnapshot: row.designSnapshot ? normalizeReportDesignConfig(row.designSnapshot) : null,
    downloadable: row.exportStatus === 'success' && Boolean(row.exportFilePath) && !row.fileCleanupAt
  };
}

router.use(requireAuth, requireRole('admin'), requireAdminPermission('report_management'));

router.get('/fields', (_req, res) => {
  success(res, REPORT_FIELD_GROUPS.map((group) => ({
    ...group,
    fields: group.fields.map(([key, label]) => ({ key, label }))
  })));
});

router.get('/default-config', (_req, res) => {
  success(res, DEFAULT_REPORT_CONFIG);
});

router.get('/options', async (_req, res, next) => {
  try {
    const [[years], [groups], [projects], [designs]] = await Promise.all([
      pool.execute('SELECT DISTINCT project_year AS value FROM projects WHERE deleted_at IS NULL ORDER BY project_year DESC'),
      pool.execute("SELECT DISTINCT project_group AS value FROM projects WHERE deleted_at IS NULL AND project_group IS NOT NULL AND project_group <> '' ORDER BY project_group"),
      pool.execute('SELECT id, project_year AS projectYear, project_group AS projectGroup, project_code AS projectCode, title FROM projects WHERE deleted_at IS NULL ORDER BY project_year DESC, project_code'),
      pool.execute("SELECT id, design_name AS designName FROM report_designs WHERE status = 'enabled' AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC")
    ]);
    success(res, {
      years: years.map((item) => Number(item.value)),
      groups: groups.map((item) => item.value),
      projects,
      designs
    });
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { page, pageSize, offset } = paginationFrom(req.query);
    const conditions = ['rd.deleted_at IS NULL'];
    const params = [];
    if (req.query.status) {
      if (!statuses.includes(req.query.status)) throw badRequest('status is invalid', 'VALIDATION_ERROR');
      conditions.push('rd.status = ?');
      params.push(req.query.status);
    }
    if (req.query.keyword) {
      conditions.push('rd.design_name LIKE ?');
      params.push(`%${String(req.query.keyword).trim()}%`);
    }
    const where = conditions.join(' AND ');
    const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM report_designs rd WHERE ${where}`, params);
    const [rows] = await pool.execute(
      `SELECT rd.id, rd.design_name AS designName, rd.design_config AS designConfig,
              rd.status, rd.created_at AS createdAt, rd.updated_at AS updatedAt,
              u.display_name AS createdBy
       FROM report_designs rd
       JOIN users u ON u.id = rd.created_by
       WHERE ${where}
       ORDER BY rd.updated_at DESC, rd.id DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    success(res, rows.map(mapDesign), 'ok', {
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

router.post('/preview', async (req, res, next) => {
  try {
    const designConfig = normalizeReportDesignConfig(req.body.designConfig);
    const scope = normalizeScope(req.body.scope || {});
    const projectIds = scope.projectIds.length ? scope.projectIds.slice(0, 1) : [];
    let projects = await reportProjects({ ...scope, projectIds });
    if (!projects.length) projects = await reportProjects({ years: [], groups: [], materialTaskIds: [], projectIds: [] });
    if (!projects.length) throw badRequest('Preview needs at least one project', 'REPORT_PREVIEW_EMPTY');
    success(res, {
      project: {
        id: projects[0].id,
        projectCode: projects[0].projectCode,
        title: projects[0].title
      },
      rows: reportPreviewGrid(designConfig, projects[0])
    });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = designPayload(req.body);
    const [result] = await pool.execute(
      `INSERT INTO report_designs (design_name, design_config, status, created_by)
       VALUES (?, ?, ?, ?)`,
      [data.designName, JSON.stringify(data.designConfig), data.status, req.user.id]
    );
    success(res, { id: result.insertId }, 'Report design created');
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = designPayload(req.body);
    const [result] = await pool.execute(
      `UPDATE report_designs
       SET design_name = ?, design_config = ?, status = ?, updated_at = NOW()
       WHERE id = ? AND deleted_at IS NULL`,
      [data.designName, JSON.stringify(data.designConfig), data.status, req.params.id]
    );
    if (!result.affectedRows) throw notFound('Report design not found');
    success(res, null, 'Report design updated');
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const status = req.body.status;
    if (!statuses.includes(status)) throw badRequest('status is invalid', 'VALIDATION_ERROR');
    const [result] = await pool.execute(
      'UPDATE report_designs SET status = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [status, req.params.id]
    );
    if (!result.affectedRows) throw notFound('Report design not found');
    success(res, null, status === 'enabled' ? 'Report design enabled' : 'Report design disabled');
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const [result] = await pool.execute(
      `UPDATE report_designs
       SET status = 'disabled', deleted_at = NOW(), updated_at = NOW()
       WHERE id = ? AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!result.affectedRows) throw notFound('Report design not found');
    success(res, null, 'Report design deleted');
  } catch (error) {
    next(error);
  }
});

router.get('/exports/records', async (req, res, next) => {
  try {
    const { page, pageSize, offset } = paginationFrom(req.query);
    const conditions = ['rer.id IS NOT NULL'];
    const params = [];
    if (req.query.status) {
      if (!reportExportStatuses.includes(req.query.status)) throw badRequest('status is invalid', 'VALIDATION_ERROR');
      conditions.push('rer.export_status = ?');
      params.push(req.query.status);
    }
    const where = conditions.join(' AND ');
    const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM report_export_records rer WHERE ${where}`, params);
    const [rows] = await pool.execute(
      `SELECT rer.id, rer.export_scope AS exportScope, rer.design_snapshot AS designSnapshot,
              rer.export_layout AS exportLayout, rer.export_summary AS exportSummary,
              rer.export_status AS exportStatus, rer.failure_reason AS failureReason,
              rer.attempt_count AS attemptCount, rer.max_attempts AS maxAttempts,
              rer.started_at AS startedAt, rer.heartbeat_at AS heartbeatAt, rer.worker_id AS workerId,
              rer.export_file_path AS exportFilePath, rer.file_cleanup_at AS fileCleanupAt,
              rer.remark, rer.created_at AS createdAt, rer.finished_at AS finishedAt,
              COALESCE(rd.design_name, '仅本次导出') AS designName,
              u.display_name AS exportUser
       FROM report_export_records rer
       LEFT JOIN report_designs rd ON rd.id = rer.report_design_id
       JOIN users u ON u.id = rer.export_user_id
       WHERE ${where}
       ORDER BY rer.created_at DESC, rer.id DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    success(res, rows.map(mapExport), 'ok', {
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

router.post('/exports', async (req, res, next) => {
  try {
    const queued = await validateAndEnqueueReportExport({
      userId: req.user.id,
      reportDesignId: Number(req.body.reportDesignId) || null,
      designConfig: req.body.designConfig,
      rawScope: req.body.scope,
      layout: req.body.layout,
      remark: req.body.remark
    });
    res.status(202);
    success(res, queued, 'Report export queued');
  } catch (error) {
    next(error);
  }
});

router.post('/exports/:id/retry', async (req, res, next) => {
  try {
    await retryReportExport(req.params.id);
    success(res, { id: Number(req.params.id), exportStatus: 'queued' }, 'Report export queued again');
  } catch (error) {
    next(error);
  }
});

router.get('/exports/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT rer.id, rer.export_scope AS exportScope, rer.design_snapshot AS designSnapshot,
              rer.export_layout AS exportLayout, rer.export_summary AS exportSummary,
              rer.export_status AS exportStatus, rer.failure_reason AS failureReason,
              rer.attempt_count AS attemptCount, rer.max_attempts AS maxAttempts,
              rer.started_at AS startedAt, rer.heartbeat_at AS heartbeatAt, rer.worker_id AS workerId,
              rer.export_file_path AS exportFilePath, rer.file_cleanup_at AS fileCleanupAt,
              rer.remark, rer.created_at AS createdAt, rer.finished_at AS finishedAt,
              COALESCE(rd.design_name, '仅本次导出') AS designName,
              u.display_name AS exportUser
       FROM report_export_records rer
       LEFT JOIN report_designs rd ON rd.id = rer.report_design_id
       JOIN users u ON u.id = rer.export_user_id
       WHERE rer.id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) throw notFound('Report export record not found');
    success(res, mapExport(rows[0]));
  } catch (error) {
    next(error);
  }
});

router.get('/exports/:id/download', async (req, res, next) => {
  try {
    const [[record]] = await pool.execute(
      `SELECT export_file_path AS exportFilePath, export_status AS exportStatus, file_cleanup_at AS fileCleanupAt
       FROM report_export_records WHERE id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!record) throw notFound('Report export record not found');
    if (record.exportStatus !== 'success' || !record.exportFilePath || record.fileCleanupAt) {
      throw badRequest('Report export is not ready for download', 'REPORT_EXPORT_NOT_READY');
    }
    const filePath = await resolveDownloadFile(env.archive.root, record.exportFilePath, {
      invalidMessage: 'Report export file path is outside the system export directory',
      invalidCode: 'REPORT_EXPORT_PATH_INVALID',
      missingMessage: 'Report export file not found'
    });
    res.download(filePath, `项目数据报表-${req.params.id}.xlsx`);
  } catch (error) {
    next(error);
  }
});

export default router;
