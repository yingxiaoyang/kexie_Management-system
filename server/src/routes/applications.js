import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import archiver from 'archiver';
import ExcelJS from 'exceljs';
import multer from 'multer';
import { Router } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { paginationFrom, requiredText } from '../utils/query.js';
import { success } from '../utils/response.js';
import { resolveDownloadFile } from '../utils/safeFiles.js';
import { assertFormalProjectOwnership } from '../utils/projectOwnership.js';
import {
  appendApplicationAudit,
  assertApplicationTransition,
  loadApplicationForAccess,
  normalizeApplicationSchema,
  parseJson,
  validateApplicationData
} from '../utils/applicationWorkflow.js';

const router = Router();
const allowedBatchStatuses = new Set(['draft', 'open', 'closed']);
const allowedExtensions = new Set(env.upload.allowedExtensions);

function uploadDirectory(category) {
  const now = new Date();
  return path.join(env.upload.root, 'applications', category, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
}

const applicationStorage = multer.diskStorage({
  destination(req, file, callback) {
    const dir = uploadDirectory('files');
    fs.mkdirSync(dir, { recursive: true });
    callback(null, dir);
  },
  filename(req, file, callback) {
    callback(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
  }
});

const officialStorage = multer.diskStorage({
  destination(req, file, callback) {
    const dir = uploadDirectory('official-results');
    fs.mkdirSync(dir, { recursive: true });
    callback(null, dir);
  },
  filename(req, file, callback) {
    callback(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
  }
});

const applicationUploader = multer({
  storage: applicationStorage,
  limits: { files: 1, fileSize: env.upload.maxFileBytes },
  fileFilter(req, file, callback) {
    const extension = path.extname(file.originalname).slice(1).toLowerCase();
    callback(allowedExtensions.has(extension) ? null : badRequest('File extension is not allowed', 'UPLOAD_TYPE_NOT_ALLOWED'), allowedExtensions.has(extension));
  }
});

const officialUploader = multer({
  storage: officialStorage,
  limits: { files: 1, fileSize: 20 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    const extension = path.extname(file.originalname).slice(1).toLowerCase();
    callback(extension === 'xlsx' ? null : badRequest('Official result must be an .xlsx file', 'UPLOAD_TYPE_NOT_ALLOWED'), extension === 'xlsx');
  }
});

async function unlinkQuiet(filePath) {
  if (filePath) await fs.promises.unlink(filePath).catch(() => undefined);
}

function singleUpload(uploader, fieldName = 'file') {
  return (req, res, next) => uploader.single(fieldName)(req, res, async (error) => {
    if (error) {
      await unlinkQuiet(req.file?.path);
      return next(error);
    }
    next();
  });
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function normalizeRequirements(value) {
  const requirements = parseJson(value, []);
  if (!Array.isArray(requirements) || requirements.length > 30) {
    throw badRequest('materialRequirements must contain at most 30 items', 'VALIDATION_ERROR');
  }
  const codes = new Set();
  return requirements.map((item, index) => {
    const code = String(item?.code || '').trim();
    const name = String(item?.name || '').trim();
    const extensions = Array.isArray(item?.allowedExtensions)
      ? [...new Set(item.allowedExtensions.map((entry) => String(entry).toLowerCase().replace(/^\./, '')))]
      : [];
    const maxFileMb = Number(item?.maxFileMb || 20);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(code) || codes.has(code) || !name || name.length > 160) {
      throw badRequest(`Material requirement ${index + 1} is invalid`, 'VALIDATION_ERROR');
    }
    if (!extensions.length || extensions.some((extension) => !allowedExtensions.has(extension))) {
      throw badRequest(`Material requirement ${code} has invalid extensions`, 'VALIDATION_ERROR');
    }
    if (!Number.isInteger(maxFileMb) || maxFileMb < 1 || maxFileMb > env.upload.maxFileBytes / 1024 / 1024) {
      throw badRequest(`Material requirement ${code} has invalid maxFileMb`, 'VALIDATION_ERROR');
    }
    codes.add(code);
    return {
      code,
      name,
      description: String(item?.description || '').trim().slice(0, 1000) || null,
      required: item?.required !== false,
      allowedExtensions: extensions,
      maxFileMb,
      sortOrder: Number.isInteger(Number(item?.sortOrder)) ? Number(item.sortOrder) : index
    };
  });
}

function safeExcelValue(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function batchPayload(body) {
  const year = Number(body.applicationYear);
  const round = body.approvalRound;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('applicationYear is invalid', 'VALIDATION_ERROR');
  if (!['first', 'supplement'].includes(round)) throw badRequest('approvalRound is invalid', 'VALIDATION_ERROR');
  const isHistorical = Boolean(body.isHistorical);
  if (isHistorical && round !== 'first') throw badRequest('Historical batches must be first-round batches', 'VALIDATION_ERROR');
  const deadlineAt = body.deadlineAt || null;
  if (!isHistorical && !deadlineAt) throw badRequest('deadlineAt is required', 'VALIDATION_ERROR');
  return {
    batchName: requiredText(body.batchName, 'batchName', 160),
    applicationYear: year,
    approvalRound: round,
    isHistorical,
    startsAt: body.startsAt || null,
    deadlineAt,
    applicationSchema: normalizeApplicationSchema(body.applicationSchema || []),
    schoolExportColumns: Array.isArray(body.schoolExportColumns) ? body.schoolExportColumns.slice(0, 50) : [],
    requirements: normalizeRequirements(body.materialRequirements || [])
  };
}

async function insertRequirements(connection, batchId, requirements) {
  for (const item of requirements) {
    await connection.execute(
      `INSERT INTO application_material_requirements
       (application_batch_id, requirement_code, requirement_name, description, is_required, allowed_extensions, max_file_mb, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [batchId, item.code, item.name, item.description, item.required ? 1 : 0, JSON.stringify(item.allowedExtensions), item.maxFileMb, item.sortOrder]
    );
  }
}

router.get('/batches/open', requireAuth, requireRole('applicant'), async (req, res, next) => {
  try {
    const [items] = await pool.execute(
      `SELECT ab.id, ab.batch_name AS batchName, ab.application_year AS applicationYear,
              ab.approval_round AS approvalRound, ab.starts_at AS startsAt, ab.deadline_at AS deadlineAt,
              ab.application_schema AS applicationSchema,
              EXISTS(SELECT 1 FROM project_applications pa WHERE pa.application_batch_id = ab.id AND pa.applicant_user_id = ?) AS applied
       FROM application_batches ab
       WHERE ab.status = 'open' AND ab.is_historical = 0 AND ab.deleted_at IS NULL
         AND (ab.starts_at IS NULL OR ab.starts_at <= NOW()) AND (ab.deadline_at IS NULL OR ab.deadline_at >= NOW())
       ORDER BY ab.deadline_at, ab.id`,
      [req.user.id]
    );
    success(res, items);
  } catch (error) { next(error); }
});

router.get('/batches', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const [items] = await pool.execute(
      `SELECT ab.id, ab.batch_name AS batchName, ab.application_year AS applicationYear,
              ab.approval_round AS approvalRound, ab.status, ab.is_historical AS isHistorical,
              ab.starts_at AS startsAt, ab.deadline_at AS deadlineAt, ab.application_schema AS applicationSchema,
              COUNT(pa.id) AS applicationCount,
              SUM(pa.status = 'submitted') AS pendingReviewCount,
              SUM(pa.status = 'eligible') AS eligibleCount,
              SUM(pa.status = 'frozen') AS frozenCount,
              SUM(pa.status = 'converted') AS convertedCount
       FROM application_batches ab
       LEFT JOIN project_applications pa ON pa.application_batch_id = ab.id
       WHERE ab.deleted_at IS NULL
       GROUP BY ab.id ORDER BY ab.application_year DESC, ab.id DESC`
    );
    success(res, items.map((item) => ({ ...item, isHistorical: Boolean(item.isHistorical) })));
  } catch (error) { next(error); }
});

router.post('/batches', requireAuth, requireRole('admin'), async (req, res, next) => {
  let connection;
  try {
    const data = batchPayload(req.body);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO application_batches
       (batch_name, application_year, approval_round, status, is_historical, starts_at, deadline_at, application_schema, school_export_columns, created_by)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
      [data.batchName, data.applicationYear, data.approvalRound, data.isHistorical ? 1 : 0, data.startsAt, data.deadlineAt,
        JSON.stringify(data.applicationSchema), JSON.stringify(data.schoolExportColumns), req.user.id]
    );
    await insertRequirements(connection, result.insertId, data.requirements);
    await appendApplicationAudit(connection, { eventType: 'batch_created', user: req.user, batchId: result.insertId, payload: { round: data.approvalRound, historical: data.isHistorical }, ip: req.ip });
    await connection.commit();
    success(res, { id: Number(result.insertId) }, 'Batch created');
  } catch (error) {
    await connection?.rollback().catch(() => undefined);
    if (error.code === 'ER_DUP_ENTRY') { error.status = 409; error.code = 'DUPLICATE_RESOURCE'; error.message = 'Batch name already exists in this year'; }
    next(error);
  } finally { connection?.release(); }
});

router.get('/batches/:id', requireAuth, async (req, res, next) => {
  try {
    if (!['admin', 'applicant'].includes(req.user.role)) throw forbidden('No permission to access application batches');
    const [[batch]] = await pool.execute(
      `SELECT ab.id, ab.batch_name AS batchName, ab.application_year AS applicationYear,
              ab.approval_round AS approvalRound, ab.status, ab.is_historical AS isHistorical,
              ab.starts_at AS startsAt, ab.deadline_at AS deadlineAt, ab.application_schema AS applicationSchema,
              ab.school_export_columns AS schoolExportColumns
       FROM application_batches ab WHERE ab.id = ? AND ab.deleted_at IS NULL
         AND (? = 'admin' OR ab.status = 'open' OR EXISTS (
           SELECT 1 FROM project_applications pa WHERE pa.application_batch_id = ab.id AND pa.applicant_user_id = ?
         )) LIMIT 1`,
      [req.params.id, req.user.role, req.user.id]
    );
    if (!batch) throw notFound('Batch not found');
    const [requirements] = await pool.execute(
      `SELECT id, requirement_code AS code, requirement_name AS name, description,
              is_required AS required, allowed_extensions AS allowedExtensions, max_file_mb AS maxFileMb,
              sort_order AS sortOrder, template_original_name AS templateOriginalName,
              template_file_size AS templateFileSize, template_sha256 AS templateSha256
       FROM application_material_requirements WHERE application_batch_id = ? AND deleted_at IS NULL ORDER BY sort_order, id`,
      [batch.id]
    );
    success(res, { ...batch, isHistorical: Boolean(batch.isHistorical), materialRequirements: requirements });
  } catch (error) { next(error); }
});

router.put('/batches/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  let connection;
  try {
    const data = batchPayload(req.body);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[batch]] = await connection.execute('SELECT * FROM application_batches WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [req.params.id]);
    if (!batch) throw notFound('Batch not found');
    if (batch.status !== 'draft') throw badRequest('Only a draft batch can be edited', 'BATCH_NOT_EDITABLE');
    const [[application]] = await connection.execute('SELECT 1 FROM project_applications WHERE application_batch_id = ? LIMIT 1', [batch.id]);
    if (application) throw badRequest('A batch with applications cannot be reconfigured', 'BATCH_NOT_EDITABLE');
    await connection.execute(
      `UPDATE application_batches SET batch_name = ?, application_year = ?, approval_round = ?, is_historical = ?,
       starts_at = ?, deadline_at = ?, application_schema = ?, school_export_columns = ?, updated_at = NOW() WHERE id = ?`,
      [data.batchName, data.applicationYear, data.approvalRound, data.isHistorical ? 1 : 0, data.startsAt, data.deadlineAt,
        JSON.stringify(data.applicationSchema), JSON.stringify(data.schoolExportColumns), batch.id]
    );
    await connection.execute('DELETE FROM application_material_requirements WHERE application_batch_id = ?', [batch.id]);
    await insertRequirements(connection, batch.id, data.requirements);
    await appendApplicationAudit(connection, { eventType: 'batch_configuration_changed', user: req.user, batchId: batch.id, payload: { requirementCount: data.requirements.length }, ip: req.ip });
    await connection.commit();
    success(res, null, 'Batch updated');
  } catch (error) { await connection?.rollback().catch(() => undefined); next(error); }
  finally { connection?.release(); }
});

router.post('/batches/:id/requirements/:requirementId/template', requireAuth, requireRole('admin'), singleUpload(applicationUploader), async (req, res, next) => {
  let connection;
  try {
    if (!req.file) throw badRequest('file is required');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[requirement]] = await connection.execute(
      `SELECT amr.*, ab.status AS batch_status FROM application_material_requirements amr
       JOIN application_batches ab ON ab.id = amr.application_batch_id
       WHERE amr.id = ? AND amr.application_batch_id = ? AND amr.deleted_at IS NULL FOR UPDATE`,
      [req.params.requirementId, req.params.id]
    );
    if (!requirement) throw notFound('Material requirement not found');
    if (requirement.batch_status === 'completed') throw badRequest('Completed batch cannot change templates', 'BATCH_NOT_EDITABLE');
    const digest = await sha256File(req.file.path);
    await connection.execute(
      `UPDATE application_material_requirements SET template_original_name = ?, template_storage_path = ?,
       template_file_size = ?, template_sha256 = ?, updated_at = NOW() WHERE id = ?`,
      [req.file.originalname, req.file.path, req.file.size, digest, requirement.id]
    );
    await appendApplicationAudit(connection, { eventType: 'batch_material_template_changed', user: req.user, batchId: requirement.application_batch_id, payload: { requirementId: Number(requirement.id), originalName: req.file.originalname, size: req.file.size, sha256: digest }, ip: req.ip });
    await connection.commit();
    if (requirement.template_storage_path && requirement.template_storage_path !== req.file.path) {
      const previousPath = await resolveDownloadFile(env.upload.root, requirement.template_storage_path, {
        invalidMessage: 'Previous template path is invalid',
        invalidCode: 'APPLICATION_TEMPLATE_PATH_INVALID',
        missingMessage: 'Previous template file is missing'
      }).catch(() => null);
      await unlinkQuiet(previousPath);
    }
    success(res, { sha256: digest }, 'Template uploaded');
  } catch (error) { await connection?.rollback().catch(() => undefined); await unlinkQuiet(req.file?.path); next(error); }
  finally { connection?.release(); }
});

router.get('/batches/:id/requirements/:requirementId/template/download', requireAuth, async (req, res, next) => {
  try {
    if (!['admin', 'applicant'].includes(req.user.role)) throw forbidden('No permission to download application templates');
    const [[template]] = await pool.execute(
      `SELECT amr.template_original_name, amr.template_storage_path
       FROM application_material_requirements amr JOIN application_batches ab ON ab.id = amr.application_batch_id
       WHERE amr.id = ? AND amr.application_batch_id = ? AND amr.deleted_at IS NULL
         AND amr.template_storage_path IS NOT NULL
         AND (? = 'admin' OR ab.status = 'open' OR EXISTS (
           SELECT 1 FROM project_applications pa WHERE pa.application_batch_id = ab.id AND pa.applicant_user_id = ?
         )) LIMIT 1`,
      [req.params.requirementId, req.params.id, req.user.role, req.user.id]
    );
    if (!template) throw notFound('Template not found');
    const safePath = await resolveDownloadFile(env.upload.root, template.template_storage_path, { invalidMessage: 'Template path is invalid', invalidCode: 'APPLICATION_TEMPLATE_PATH_INVALID', missingMessage: 'Template file is missing' });
    res.download(safePath, template.template_original_name);
  } catch (error) { next(error); }
});

router.patch('/batches/:id/status', requireAuth, requireRole('admin'), async (req, res, next) => {
  let connection;
  try {
    const nextStatus = String(req.body.status || '');
    if (!allowedBatchStatuses.has(nextStatus)) throw badRequest('Batch status is invalid', 'VALIDATION_ERROR');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[batch]] = await connection.execute('SELECT * FROM application_batches WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [req.params.id]);
    if (!batch) throw notFound('Batch not found');
    const legal = (batch.status === 'draft' && ['open', 'closed'].includes(nextStatus))
      || (batch.status === 'open' && nextStatus === 'closed')
      || (batch.status === 'closed' && nextStatus === 'open');
    if (!legal) throw badRequest(`Illegal batch status transition: ${batch.status} -> ${nextStatus}`, 'ILLEGAL_STATUS_TRANSITION');
    if (batch.is_historical && nextStatus === 'open') throw badRequest('Historical batch cannot be opened to applicants', 'VALIDATION_ERROR');
    await connection.execute('UPDATE application_batches SET status = ?, updated_at = NOW() WHERE id = ?', [nextStatus, batch.id]);
    await appendApplicationAudit(connection, { eventType: 'batch_status_changed', user: req.user, batchId: batch.id, payload: { from: batch.status, to: nextStatus }, ip: req.ip });
    await connection.commit();
    success(res, null, 'Batch status updated');
  } catch (error) { await connection?.rollback().catch(() => undefined); next(error); }
  finally { connection?.release(); }
});

router.get('/mine', requireAuth, requireRole('applicant'), async (req, res, next) => {
  try {
    const [items] = await pool.execute(
      `SELECT pa.id, pa.status, pa.application_data AS applicationData, pa.submission_version AS submissionVersion,
              pa.submitted_at AS submittedAt, pa.internal_review_reason AS internalReviewReason,
              pa.school_result_at AS schoolResultAt, pa.school_result_remark AS schoolResultRemark, pa.project_id AS projectId,
              ab.id AS batchId, ab.batch_name AS batchName, ab.application_year AS applicationYear,
              ab.approval_round AS approvalRound, ab.status AS batchStatus, ab.deadline_at AS deadlineAt,
              ab.application_schema AS applicationSchema
       FROM project_applications pa JOIN application_batches ab ON ab.id = pa.application_batch_id
       WHERE pa.applicant_user_id = ? ORDER BY pa.id DESC`,
      [req.user.id]
    );
    success(res, items);
  } catch (error) { next(error); }
});

router.post('/', requireAuth, requireRole('applicant'), async (req, res, next) => {
  let connection;
  try {
    const batchId = Number(req.body.batchId);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[batch]] = await connection.execute(
      `SELECT * FROM application_batches WHERE id = ? AND status = 'open' AND is_historical = 0 AND deleted_at IS NULL
       AND (starts_at IS NULL OR starts_at <= NOW()) AND (deadline_at IS NULL OR deadline_at >= NOW()) FOR UPDATE`,
      [batchId]
    );
    if (!batch) throw badRequest('Batch is not open for applications', 'BATCH_NOT_OPEN');
    const [[owner]] = await connection.execute(
      `SELECT 1 FROM project_participations WHERE person_id = ? AND role = 'owner' AND deleted_at IS NULL LIMIT 1`,
      [req.user.personId]
    );
    if (owner) throw forbidden('A current formal project owner cannot submit another application', 'FORMAL_OWNER_CANNOT_APPLY');
    const data = validateApplicationData(req.body.applicationData || {}, normalizeApplicationSchema(batch.application_schema));
    const [result] = await connection.execute(
      `INSERT INTO project_applications
       (application_batch_id, applicant_user_id, applicant_person_id, status, application_data)
       VALUES (?, ?, ?, 'draft', ?)`,
      [batchId, req.user.id, req.user.personId, JSON.stringify(data)]
    );
    await appendApplicationAudit(connection, { eventType: 'application_created', user: req.user, batchId, applicationId: result.insertId, payload: {}, ip: req.ip });
    await connection.commit();
    success(res, { id: Number(result.insertId) }, 'Application created');
  } catch (error) {
    await connection?.rollback().catch(() => undefined);
    if (error.code === 'ER_DUP_ENTRY') { error.status = 409; error.code = 'ACTIVE_APPLICATION_EXISTS'; error.message = 'Only one active application is allowed per student'; }
    next(error);
  } finally { connection?.release(); }
});

router.put('/:id', requireAuth, requireRole('applicant'), async (req, res, next) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const application = await loadApplicationForAccess(connection, req.params.id, req.user, true);
    if (!['draft', 'returned'].includes(application.status)) throw badRequest('Application is frozen and cannot be edited', 'APPLICATION_FROZEN');
    if (application.batch_status !== 'open' || (application.deadline_at && new Date(application.deadline_at).getTime() < Date.now())) throw badRequest('Batch is not open', 'BATCH_NOT_OPEN');
    const data = validateApplicationData(req.body.applicationData || {}, normalizeApplicationSchema(application.application_schema));
    await connection.execute('UPDATE project_applications SET application_data = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(data), application.id]);
    await appendApplicationAudit(connection, { eventType: 'application_edited', user: req.user, batchId: application.application_batch_id, applicationId: application.id, payload: { fields: Object.keys(data) }, ip: req.ip });
    await connection.commit();
    success(res, null, 'Application saved');
  } catch (error) { await connection?.rollback().catch(() => undefined); next(error); }
  finally { connection?.release(); }
});

router.post('/:id/materials/:requirementId', requireAuth, requireRole('applicant'), singleUpload(applicationUploader), async (req, res, next) => {
  let connection;
  try {
    if (!req.file) throw badRequest('file is required');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const application = await loadApplicationForAccess(connection, req.params.id, req.user, true);
    if (!['draft', 'returned'].includes(application.status)) throw badRequest('Application is frozen and cannot accept files', 'APPLICATION_FROZEN');
    if (application.batch_status !== 'open' || (application.deadline_at && new Date(application.deadline_at).getTime() < Date.now())) throw badRequest('Batch is not open', 'BATCH_NOT_OPEN');
    const [[requirement]] = await connection.execute(
      `SELECT * FROM application_material_requirements WHERE id = ? AND application_batch_id = ? AND deleted_at IS NULL LIMIT 1`,
      [req.params.requirementId, application.application_batch_id]
    );
    if (!requirement) throw notFound('Material requirement not found');
    const extension = path.extname(req.file.originalname).slice(1).toLowerCase();
    const extensions = parseJson(requirement.allowed_extensions, []);
    if (!extensions.includes(extension)) throw badRequest('File extension is not allowed for this material', 'UPLOAD_TYPE_NOT_ALLOWED');
    if (req.file.size > Number(requirement.max_file_mb) * 1024 * 1024) throw badRequest('File exceeds material size limit', 'UPLOAD_FILE_SIZE_EXCEEDED');
    const [[total]] = await connection.execute('SELECT COALESCE(SUM(file_size), 0) AS bytes FROM application_material_files WHERE project_application_id = ?', [application.id]);
    if (Number(total.bytes) + req.file.size > env.upload.applicationMaxBytes) throw badRequest('Application cumulative upload limit exceeded', 'UPLOAD_TOTAL_SIZE_EXCEEDED');
    const [[version]] = await connection.execute(
      'SELECT COALESCE(MAX(file_version), 0) + 1 AS nextVersion FROM application_material_files WHERE project_application_id = ? AND material_requirement_id = ?',
      [application.id, requirement.id]
    );
    const digest = await sha256File(req.file.path);
    const submissionVersion = Number(application.submission_version) + 1;
    const [result] = await connection.execute(
      `INSERT INTO application_material_files
       (project_application_id, material_requirement_id, submission_version, file_version, original_name, storage_path, file_size, mime_type, sha256, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [application.id, requirement.id, submissionVersion, version.nextVersion, req.file.originalname, req.file.path, req.file.size, req.file.mimetype, digest, req.user.id]
    );
    await appendApplicationAudit(connection, { eventType: 'application_material_uploaded', user: req.user, batchId: application.application_batch_id, applicationId: application.id, payload: { requirementId: Number(requirement.id), fileId: Number(result.insertId), fileVersion: Number(version.nextVersion), size: req.file.size, sha256: digest }, ip: req.ip });
    await connection.commit();
    success(res, { id: Number(result.insertId), fileVersion: Number(version.nextVersion), sha256: digest }, 'Material version uploaded');
  } catch (error) {
    await connection?.rollback().catch(() => undefined);
    await unlinkQuiet(req.file?.path);
    next(error);
  } finally { connection?.release(); }
});

router.get('/:id/materials', requireAuth, async (req, res, next) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const application = await loadApplicationForAccess(connection, req.params.id, req.user);
    const [requirements] = await connection.execute(
      `SELECT id, requirement_code AS code, requirement_name AS name, description, is_required AS required,
              allowed_extensions AS allowedExtensions, max_file_mb AS maxFileMb,
              template_original_name AS templateOriginalName
       FROM application_material_requirements WHERE application_batch_id = ? AND deleted_at IS NULL ORDER BY sort_order, id`,
      [application.application_batch_id]
    );
    const [files] = await connection.execute(
      `SELECT amf.id, amf.material_requirement_id AS requirementId, amf.submission_version AS submissionVersion,
              amf.file_version AS fileVersion, amf.original_name AS originalName, amf.file_size AS fileSize,
              amf.mime_type AS mimeType, amf.sha256, amf.submitted_at AS submittedAt,
              amr.review_result AS reviewResult, amr.review_reason AS reviewReason,
              amr.reviewed_by AS reviewedBy, amr.reviewed_at AS reviewedAt
       FROM application_material_files amf
       LEFT JOIN application_material_reviews amr ON amr.project_application_id = amf.project_application_id
         AND amr.submission_version = amf.submission_version
       WHERE amf.project_application_id = ? ORDER BY amf.submission_version DESC, amf.file_version DESC`,
      [application.id]
    );
    success(res, { requirements, files });
  } catch (error) { next(error); }
  finally { connection?.release(); }
});

router.get('/:id/materials/:fileId/download', requireAuth, async (req, res, next) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await loadApplicationForAccess(connection, req.params.id, req.user);
    const [[file]] = await connection.execute(
      `SELECT original_name, storage_path FROM application_material_files WHERE id = ? AND project_application_id = ? LIMIT 1`,
      [req.params.fileId, req.params.id]
    );
    if (!file) throw notFound('Material file not found');
    const safePath = await resolveDownloadFile(env.upload.root, file.storage_path, { invalidMessage: 'Material path is invalid', invalidCode: 'APPLICATION_FILE_PATH_INVALID', missingMessage: 'Material file is missing' });
    res.download(safePath, file.original_name);
  } catch (error) { next(error); }
  finally { connection?.release(); }
});

router.post('/:id/submit', requireAuth, requireRole('applicant'), async (req, res, next) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const application = await loadApplicationForAccess(connection, req.params.id, req.user, true);
    assertApplicationTransition(application.status, 'submitted');
    if (application.batch_status !== 'open' || (application.deadline_at && new Date(application.deadline_at).getTime() < Date.now())) throw badRequest('Batch is not open', 'BATCH_NOT_OPEN');
    const nextVersion = Number(application.submission_version) + 1;
    const [missing] = await connection.execute(
      `SELECT amr.requirement_name AS name FROM application_material_requirements amr
       WHERE amr.application_batch_id = ? AND amr.is_required = 1 AND amr.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM application_material_files amf
           WHERE amf.project_application_id = ? AND amf.material_requirement_id = amr.id AND amf.submission_version = ?)`,
      [application.application_batch_id, application.id, nextVersion]
    );
    if (missing.length) throw badRequest(`Required materials missing: ${missing.map((item) => item.name).join('、')}`, 'REQUIRED_MATERIAL_MISSING');
    await connection.execute(
      `UPDATE project_applications SET status = 'submitted', submission_version = ?, submitted_at = NOW(),
       internal_reviewed_by = NULL, internal_reviewed_at = NULL, internal_review_reason = NULL, updated_at = NOW() WHERE id = ?`,
      [nextVersion, application.id]
    );
    await appendApplicationAudit(connection, { eventType: 'application_submitted', user: req.user, batchId: application.application_batch_id, applicationId: application.id, payload: { submissionVersion: nextVersion }, ip: req.ip });
    await connection.commit();
    success(res, { submissionVersion: nextVersion }, 'Application submitted');
  } catch (error) { await connection?.rollback().catch(() => undefined); next(error); }
  finally { connection?.release(); }
});

router.post('/:id/withdraw', requireAuth, requireRole('applicant'), async (req, res, next) => {
  let connection;
  try {
    const reason = String(req.body.reason || '').trim();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const application = await loadApplicationForAccess(connection, req.params.id, req.user, true);
    if (application.status === 'frozen') throw forbidden('A reported application can only be recalled by an administrator with a reason', 'APPLICATION_FROZEN');
    assertApplicationTransition(application.status, 'withdrawn');
    await connection.execute("UPDATE project_applications SET status = 'withdrawn', withdrawal_reason = ?, updated_at = NOW() WHERE id = ?", [reason || null, application.id]);
    await appendApplicationAudit(connection, { eventType: 'application_withdrawn', user: req.user, batchId: application.application_batch_id, applicationId: application.id, payload: { reason: reason || null }, ip: req.ip });
    await connection.commit();
    success(res, null, 'Application withdrawn');
  } catch (error) { await connection?.rollback().catch(() => undefined); next(error); }
  finally { connection?.release(); }
});

router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { page, pageSize, offset } = paginationFrom(req.query);
    const conditions = ['1=1'];
    const params = [];
    if (req.query.batchId) { conditions.push('pa.application_batch_id = ?'); params.push(Number(req.query.batchId)); }
    if (req.query.status) { conditions.push('pa.status = ?'); params.push(String(req.query.status)); }
    const where = conditions.join(' AND ');
    const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM project_applications pa WHERE ${where}`, params);
    const [items] = await pool.execute(
      `SELECT pa.id, pa.status, pa.submission_version AS submissionVersion, pa.submitted_at AS submittedAt,
              pa.internal_review_reason AS internalReviewReason, pa.application_data AS applicationData,
              ab.id AS batchId, ab.batch_name AS batchName, pe.name AS applicantName, pe.student_no AS studentNo,
              pe.college, u.username, COUNT(amf.id) AS materialVersionCount
       FROM project_applications pa JOIN application_batches ab ON ab.id = pa.application_batch_id
       JOIN people pe ON pe.id = pa.applicant_person_id JOIN users u ON u.id = pa.applicant_user_id
       LEFT JOIN application_material_files amf ON amf.project_application_id = pa.id
       WHERE ${where} GROUP BY pa.id ORDER BY pa.submitted_at DESC, pa.id DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    success(res, items, 'ok', { pagination: { page, pageSize, total: Number(count.total), totalPages: Math.ceil(Number(count.total) / pageSize) } });
  } catch (error) { next(error); }
});

router.post('/:id/review', requireAuth, requireRole('admin'), async (req, res, next) => {
  let connection;
  try {
    const result = String(req.body.result || '');
    const reason = String(req.body.reason || '').trim();
    if (!['eligible', 'returned'].includes(result)) throw badRequest('Review result is invalid', 'VALIDATION_ERROR');
    if (result === 'returned' && !reason) throw badRequest('Return reason is required', 'VALIDATION_ERROR');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const application = await loadApplicationForAccess(connection, req.params.id, req.user, true);
    assertApplicationTransition(application.status, result);
    await connection.execute(
      `UPDATE project_applications SET status = ?, internal_reviewed_by = ?, internal_reviewed_at = NOW(),
       internal_review_reason = ?, updated_at = NOW() WHERE id = ?`,
      [result, req.user.id, reason || null, application.id]
    );
    await connection.execute(
      `INSERT INTO application_material_reviews
       (project_application_id, submission_version, review_result, review_reason, reviewed_by)
       VALUES (?, ?, ?, ?, ?)`,
      [application.id, application.submission_version, result, reason || null, req.user.id]
    );
    await appendApplicationAudit(connection, { eventType: 'internal_material_reviewed', user: req.user, batchId: application.application_batch_id, applicationId: application.id, payload: { result, reason: reason || null, meaning: 'material_eligibility_only' }, ip: req.ip });
    await connection.commit();
    success(res, null, result === 'eligible' ? 'Materials marked eligible' : 'Materials returned');
  } catch (error) { await connection?.rollback().catch(() => undefined); next(error); }
  finally { connection?.release(); }
});

async function writeExportPackage(exportId, batch, applications, requirements) {
  const exportRoot = path.join(env.archive.root, 'applications');
  await fs.promises.mkdir(exportRoot, { recursive: true });
  const workbookPath = path.join(exportRoot, `application-${exportId}.xlsx`);
  const packagePath = path.join(exportRoot, `application-${exportId}-materials.zip`);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('学校报送名单');
  const schema = normalizeApplicationSchema(batch.application_schema);
  sheet.columns = [
    { header: '学号', key: 'studentNo', width: 18 }, { header: '姓名', key: 'name', width: 14 },
    { header: '学院', key: 'college', width: 24 }, ...schema.map((field) => ({ header: field.label, key: field.key, width: 22 })),
    { header: '学校结果', key: 'result', width: 14 }, { header: '项目编号', key: 'projectCode', width: 20 },
    { header: '立项日期', key: 'approvalDate', width: 16 }, { header: '备注', key: 'remark', width: 28 }
  ];
  for (const application of applications) {
    const data = parseJson(application.application_data, {});
    sheet.addRow(Object.fromEntries(Object.entries({ studentNo: application.student_no, name: application.applicant_name, college: application.college, ...data }).map(([key, value]) => [key, safeExcelValue(value)])));
  }
  sheet.getRow(1).font = { bold: true };
  await workbook.xlsx.writeFile(workbookPath);

  const filesToArchive = [];
  for (const application of applications) {
    const studentFolder = `${application.student_no}-${application.applicant_name}`.replace(/[<>:"/\\|?*]/g, '_');
    for (const file of application.files || []) {
      const requirement = requirements.find((item) => Number(item.id) === Number(file.material_requirement_id));
      const resolved = await resolveDownloadFile(env.upload.root, file.storage_path, {
        invalidMessage: 'Application material path is invalid during report export',
        invalidCode: 'APPLICATION_FILE_PATH_INVALID',
        missingMessage: 'Application material is missing during report export'
      });
      const safeFileName = `${requirement?.requirement_name || '材料'}-${file.original_name}`.replace(/[<>:"/\\|?*]/g, '_');
      filesToArchive.push({ resolved, archiveName: `${studentFolder}/${safeFileName}` });
    }
  }

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(packagePath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(workbookPath, { name: '学校报送名单.xlsx' });
    for (const item of filesToArchive) archive.file(item.resolved, { name: item.archiveName });
    archive.finalize();
  });
  return { workbookPath, packagePath };
}

async function recoverFailedExport(exportId, user, ip, failureReason) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[record]] = await connection.execute(
      "SELECT * FROM application_export_records WHERE id = ? AND status IN ('building', 'failed') FOR UPDATE",
      [exportId]
    );
    if (!record) {
      await connection.rollback();
      return;
    }
    const [items] = await connection.execute(
      `SELECT pa.id, pa.status FROM application_export_items aei
       JOIN project_applications pa ON pa.id = aei.project_application_id
       WHERE aei.application_export_id = ? FOR UPDATE`,
      [record.id]
    );
    for (const application of items) {
      if (application.status !== 'frozen') continue;
      assertApplicationTransition('frozen', 'eligible');
      await connection.execute(
        "UPDATE project_applications SET status = 'eligible', frozen_at = NULL, updated_at = NOW() WHERE id = ?",
        [application.id]
      );
    }
    await connection.execute(
      "UPDATE application_export_records SET status = 'failed', failure_reason = ? WHERE id = ?",
      [String(failureReason).slice(0, 1000), record.id]
    );
    await connection.execute(
      "UPDATE application_batches SET status = 'closed', updated_at = NOW() WHERE id = ? AND status = 'reported'",
      [record.application_batch_id]
    );
    await appendApplicationAudit(connection, {
      eventType: 'report_batch_export_failed_recovered',
      user,
      batchId: record.application_batch_id,
      payload: { exportId: Number(record.id), restoredApplications: items.filter((item) => item.status === 'frozen').length, failureReason: String(failureReason).slice(0, 500) },
      ip
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
  const exportRoot = path.join(env.archive.root, 'applications');
  await Promise.all([
    unlinkQuiet(path.join(exportRoot, `application-${exportId}.xlsx`)),
    unlinkQuiet(path.join(exportRoot, `application-${exportId}-materials.zip`))
  ]);
}

router.post('/batches/:id/export', requireAuth, requireRole('admin'), async (req, res, next) => {
  let connection;
  let exportId;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[batch]] = await connection.execute('SELECT * FROM application_batches WHERE id = ? AND is_historical = 0 AND deleted_at IS NULL FOR UPDATE', [req.params.id]);
    if (!batch || !['open', 'closed'].includes(batch.status)) throw badRequest('Batch cannot be exported', 'ILLEGAL_STATUS_TRANSITION');
    const [applications] = await connection.execute(
      `SELECT pa.*, pe.student_no, pe.name AS applicant_name, pe.college
       FROM project_applications pa JOIN people pe ON pe.id = pa.applicant_person_id
       WHERE pa.application_batch_id = ? AND pa.status = 'eligible' FOR UPDATE`, [batch.id]
    );
    if (!applications.length) throw badRequest('No eligible applications to export', 'VALIDATION_ERROR');
    const exportNo = `${batch.application_year}-${batch.approval_round}-${Date.now()}`;
    const [exportResult] = await connection.execute(
      `INSERT INTO application_export_records
       (application_batch_id, export_no, status, application_count, snapshot, exported_by)
       VALUES (?, ?, 'building', ?, ?, ?)`,
      [batch.id, exportNo, applications.length, JSON.stringify(applications.map((item) => ({ applicationId: Number(item.id), submissionVersion: Number(item.submission_version) }))), req.user.id]
    );
    exportId = Number(exportResult.insertId);
    for (const application of applications) {
      assertApplicationTransition(application.status, 'frozen');
      await connection.execute("UPDATE project_applications SET status = 'frozen', frozen_at = NOW(), updated_at = NOW() WHERE id = ?", [application.id]);
      await connection.execute('INSERT INTO application_export_items (application_export_id, project_application_id, submission_version) VALUES (?, ?, ?)', [exportId, application.id, application.submission_version]);
    }
    await connection.execute("UPDATE application_batches SET status = 'reported', updated_at = NOW() WHERE id = ?", [batch.id]);
    await appendApplicationAudit(connection, { eventType: 'report_batch_frozen', user: req.user, batchId: batch.id, payload: { exportId, exportNo, applicationCount: applications.length }, ip: req.ip });
    await connection.commit();

    const [requirements] = await pool.execute('SELECT * FROM application_material_requirements WHERE application_batch_id = ? AND deleted_at IS NULL ORDER BY sort_order, id', [batch.id]);
    for (const application of applications) {
      const [files] = await pool.execute(
        `SELECT amf.* FROM application_material_files amf
         JOIN (SELECT material_requirement_id, MAX(file_version) AS version FROM application_material_files
           WHERE project_application_id = ? AND submission_version = ? GROUP BY material_requirement_id) latest
         ON latest.material_requirement_id = amf.material_requirement_id AND latest.version = amf.file_version
         WHERE amf.project_application_id = ?`,
        [application.id, application.submission_version, application.id]
      );
      application.files = files;
    }
    const paths = await writeExportPackage(exportId, batch, applications, requirements);
    await pool.execute("UPDATE application_export_records SET status = 'ready', workbook_path = ?, package_path = ? WHERE id = ?", [paths.workbookPath, paths.packagePath, exportId]);
    success(res, { exportId, exportNo, applicationCount: applications.length }, 'Report batch frozen and export generated');
  } catch (error) {
    await connection?.rollback().catch(() => undefined);
    if (exportId) {
      try {
        await recoverFailedExport(exportId, req.user, req.ip, error.message);
      } catch (recoveryError) {
        error.message = `${error.message}; frozen-state recovery also failed: ${recoveryError.message}`;
      }
    }
    next(error);
  } finally { connection?.release(); }
});

router.get('/exports', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const [items] = await pool.execute(
      `SELECT aer.id, aer.export_no AS exportNo, aer.status, aer.application_count AS applicationCount,
              aer.failure_reason AS failureReason, aer.recall_reason AS recallReason, aer.created_at AS createdAt,
              ab.batch_name AS batchName FROM application_export_records aer
       JOIN application_batches ab ON ab.id = aer.application_batch_id ORDER BY aer.id DESC`
    );
    success(res, items);
  } catch (error) { next(error); }
});

router.get('/exports/:id/download/:kind', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const [[record]] = await pool.execute('SELECT * FROM application_export_records WHERE id = ? AND status = \'ready\' LIMIT 1', [req.params.id]);
    if (!record) throw notFound('Export not found');
    const isWorkbook = req.params.kind === 'workbook';
    if (!isWorkbook && req.params.kind !== 'package') throw notFound('Export file not found');
    const filePath = await resolveDownloadFile(env.archive.root, isWorkbook ? record.workbook_path : record.package_path, { invalidMessage: 'Export path is invalid', invalidCode: 'EXPORT_PATH_INVALID', missingMessage: 'Export file is missing' });
    res.download(filePath, isWorkbook ? `${record.export_no}.xlsx` : `${record.export_no}-materials.zip`);
  } catch (error) { next(error); }
});

router.post('/exports/:id/recall', requireAuth, requireRole('admin'), async (req, res, next) => {
  let connection;
  try {
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw badRequest('Recall reason is required', 'VALIDATION_ERROR');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[record]] = await connection.execute("SELECT * FROM application_export_records WHERE id = ? AND status = 'ready' FOR UPDATE", [req.params.id]);
    if (!record) throw notFound('Ready export not found');
    const [items] = await connection.execute('SELECT project_application_id FROM application_export_items WHERE application_export_id = ?', [record.id]);
    for (const item of items) {
      const [[application]] = await connection.execute('SELECT status FROM project_applications WHERE id = ? FOR UPDATE', [item.project_application_id]);
      assertApplicationTransition(application.status, 'eligible');
      await connection.execute("UPDATE project_applications SET status = 'eligible', frozen_at = NULL, updated_at = NOW() WHERE id = ?", [item.project_application_id]);
    }
    await connection.execute("UPDATE application_export_records SET status = 'recalled', recall_reason = ?, recalled_at = NOW() WHERE id = ?", [reason, record.id]);
    await connection.execute("UPDATE application_batches SET status = 'closed', updated_at = NOW() WHERE id = ?", [record.application_batch_id]);
    await appendApplicationAudit(connection, { eventType: 'report_batch_recalled', user: req.user, batchId: record.application_batch_id, payload: { exportId: Number(record.id), reason }, ip: req.ip });
    await connection.commit();
    success(res, null, 'Report batch recalled');
  } catch (error) { await connection?.rollback().catch(() => undefined); next(error); }
  finally { connection?.release(); }
});

const HEADER_ALIASES = {
  studentNo: ['学号', 'student_no', 'studentNo'], name: ['姓名', 'name'], result: ['学校结果', 'result'],
  projectCode: ['项目编号', 'project_code', 'projectCode'], title: ['项目名称', '项目题目', 'title'],
  projectGroup: ['组别', 'project_group', 'projectGroup'], category: ['项目类别', 'category'],
  approvalDate: ['立项日期', 'approval_date', 'approvalDate'], remark: ['备注', 'remark']
};

function normalizeSchoolResult(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['通过', 'approved', 'approve'].includes(text)) return 'approved';
  if (['未通过', '不通过', 'rejected', 'reject'].includes(text)) return 'rejected';
  return null;
}

function excelDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

async function readOfficialRows(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  if (workbook.worksheets.length !== 1) throw badRequest('Official result workbook must contain exactly one worksheet', 'VALIDATION_ERROR');
  const sheet = workbook.worksheets[0];
  if (!sheet) throw badRequest('Workbook has no worksheet', 'VALIDATION_ERROR');
  if (sheet.rowCount > 5001 || sheet.columnCount > 50) throw badRequest('Official result workbook exceeds row or column limits', 'VALIDATION_ERROR');
  const headers = new Map();
  sheet.getRow(1).eachCell((cell, column) => headers.set(String(cell.text || '').trim(), column));
  const columnFor = (key) => HEADER_ALIASES[key].map((alias) => headers.get(alias)).find(Boolean);
  if (!columnFor('studentNo')) throw badRequest('Workbook is missing 学号 column', 'VALIDATION_ERROR');
  const rows = [];
  for (let index = 2; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);
    const text = (key) => {
      const column = columnFor(key);
      return column ? String(row.getCell(column).text || '').trim() : '';
    };
    const studentNo = text('studentNo');
    if (!studentNo && !text('projectCode') && !text('name')) continue;
    const approvalColumn = columnFor('approvalDate');
    rows.push({ row: index, studentNo, name: text('name'), result: text('result'), projectCode: text('projectCode'), title: text('title'), projectGroup: text('projectGroup') || null, category: text('category') || null, approvalDate: excelDate((approvalColumn ? row.getCell(approvalColumn).value : null) || text('approvalDate')), remark: text('remark') || null });
  }
  return rows;
}

router.post('/batches/:id/results/validate', requireAuth, requireRole('admin'), singleUpload(officialUploader), async (req, res, next) => {
  try {
    if (!req.file) throw badRequest('file is required');
    const [[batch]] = await pool.execute('SELECT * FROM application_batches WHERE id = ? AND deleted_at IS NULL LIMIT 1', [req.params.id]);
    if (!batch) throw notFound('Batch not found');
    const importKind = batch.is_historical ? 'historical_first' : 'application_result';
    if (!batch.is_historical && batch.status !== 'reported') throw badRequest('School results require a reported batch', 'ILLEGAL_STATUS_TRANSITION');
    const rows = await readOfficialRows(req.file.path);
    const errors = [];
    const seen = new Set();
    const normalized = [];
    const [applications] = batch.is_historical ? [[]] : await pool.execute(
      `SELECT pa.id, pa.status, pe.student_no FROM project_applications pa JOIN people pe ON pe.id = pa.applicant_person_id WHERE pa.application_batch_id = ?`, [batch.id]
    );
    const applicationMap = new Map(applications.map((item) => [item.student_no, item]));
    for (const row of rows) {
      if (!row.studentNo) errors.push({ row: row.row, field: 'studentNo', message: '学号不能为空' });
      if (seen.has(row.studentNo)) errors.push({ row: row.row, field: 'studentNo', message: '学号重复' });
      seen.add(row.studentNo);
      if (batch.is_historical) {
        if (!row.projectCode) errors.push({ row: row.row, field: 'projectCode', message: '项目编号不能为空' });
        if (!row.name) errors.push({ row: row.row, field: 'name', message: '历史名单姓名不能为空' });
        if (!row.title) errors.push({ row: row.row, field: 'title', message: '历史名单项目名称不能为空' });
        normalized.push({ ...row, result: 'approved' });
      } else {
        const result = normalizeSchoolResult(row.result);
        const application = applicationMap.get(row.studentNo);
        if (!application || application.status !== 'frozen') errors.push({ row: row.row, field: 'studentNo', message: '学号不属于本次冻结报送名单' });
        if (!result) errors.push({ row: row.row, field: 'result', message: '学校结果必须为通过或未通过' });
        if (result === 'approved' && !row.projectCode) errors.push({ row: row.row, field: 'projectCode', message: '学校通过时项目编号不能为空' });
        if (result === 'rejected') row.projectCode = row.projectCode || null;
        normalized.push({ ...row, result, applicationId: application ? Number(application.id) : null });
      }
    }
    if (!rows.length) errors.push({ row: 1, field: 'file', message: '文件没有数据行' });
    const digest = await sha256File(req.file.path);
    const summary = { totalRows: rows.length, valid: errors.length === 0, errorCount: errors.length, errors: errors.slice(0, 200) };
    const retainedPath = errors.length ? null : req.file.path;
    const [result] = await pool.execute(
      `INSERT INTO school_result_imports
       (application_batch_id, import_kind, original_name, storage_path, file_size, sha256, validation_status, validation_summary, normalized_rows, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [batch.id, importKind, req.file.originalname, retainedPath, req.file.size, digest, errors.length ? 'invalid' : 'valid', JSON.stringify(summary), JSON.stringify(normalized), req.user.id]
    );
    if (errors.length) await unlinkQuiet(req.file.path);
    success(res, { importId: Number(result.insertId), ...summary }, errors.length ? 'Precheck found errors' : 'Precheck passed');
  } catch (error) { await unlinkQuiet(req.file?.path); next(error); }
});

router.post('/batches/:id/results/manual', requireAuth, requireRole('admin'), async (req, res, next) => {
  let filePath;
  try {
    const supplied = Array.isArray(req.body.rows) ? req.body.rows : [req.body];
    if (!supplied.length || supplied.length > 200) throw badRequest('rows must contain 1-200 results', 'VALIDATION_ERROR');
    const [[batch]] = await pool.execute("SELECT * FROM application_batches WHERE id = ? AND status = 'reported' AND is_historical = 0 LIMIT 1", [req.params.id]);
    if (!batch) throw badRequest('Manual results require a reported application batch', 'ILLEGAL_STATUS_TRANSITION');
    const [applications] = await pool.execute(
      `SELECT pa.id, pa.status, pe.student_no FROM project_applications pa JOIN people pe ON pe.id = pa.applicant_person_id
       WHERE pa.application_batch_id = ?`, [batch.id]
    );
    const applicationMap = new Map(applications.map((item) => [item.student_no, item]));
    const seen = new Set();
    const rows = supplied.map((item, index) => {
      const studentNo = String(item.studentNo || '').trim();
      const result = normalizeSchoolResult(item.result);
      const application = applicationMap.get(studentNo);
      if (!studentNo || seen.has(studentNo)) throw badRequest(`Row ${index + 1} has an empty or duplicate studentNo`, 'VALIDATION_ERROR');
      if (!application || application.status !== 'frozen') throw badRequest(`Row ${index + 1} is not in the frozen report batch`, 'VALIDATION_ERROR');
      if (!result) throw badRequest(`Row ${index + 1} has an invalid school result`, 'VALIDATION_ERROR');
      const projectCode = String(item.projectCode || '').trim() || null;
      if (result === 'approved' && !projectCode) throw badRequest(`Row ${index + 1} requires projectCode`, 'VALIDATION_ERROR');
      seen.add(studentNo);
      return {
        row: index + 1, studentNo, result, projectCode,
        approvalDate: excelDate(item.approvalDate), projectGroup: String(item.projectGroup || '').trim() || null,
        category: String(item.category || '').trim() || null, title: String(item.title || '').trim() || null,
        remark: String(item.remark || '').trim() || null, applicationId: Number(application.id)
      };
    });
    const dir = uploadDirectory('official-results');
    await fs.promises.mkdir(dir, { recursive: true });
    filePath = path.join(dir, `${Date.now()}-${crypto.randomUUID()}-manual.json`);
    const content = JSON.stringify({ enteredBy: req.user.id, rows });
    await fs.promises.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
    const digest = crypto.createHash('sha256').update(content).digest('hex');
    const [result] = await pool.execute(
      `INSERT INTO school_result_imports
       (application_batch_id, import_kind, original_name, storage_path, file_size, sha256, validation_status, validation_summary, normalized_rows, uploaded_by)
       VALUES (?, 'application_result', '管理员逐条录入.json', ?, ?, ?, 'valid', ?, ?, ?)`,
      [batch.id, filePath, Buffer.byteLength(content), digest, JSON.stringify({ totalRows: rows.length, valid: true, errorCount: 0, source: 'manual' }), JSON.stringify(rows), req.user.id]
    );
    success(res, { importId: Number(result.insertId), valid: true, totalRows: rows.length }, 'Manual results passed precheck');
  } catch (error) { if (filePath) await unlinkQuiet(filePath); next(error); }
});

async function ensureProjectForResult(connection, { batch, row, personId, applicationId, importId, userId }) {
  const [[owned]] = await connection.execute(
    `SELECT project_id FROM project_participations WHERE person_id = ? AND role = 'owner' AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [personId]
  );
  let [[project]] = await connection.execute('SELECT * FROM projects WHERE project_code = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [row.projectCode]);
  if (owned && (!project || Number(owned.project_id) !== Number(project.id))) throw badRequest(`Student ${row.studentNo} already owns a formal project`, 'OWNER_PROJECT_LIMIT');
  if (!project) {
    const [created] = await connection.execute(
      `INSERT INTO projects (project_year, project_group, project_code, title, category, approval_date, approval_type, status, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [batch.application_year, row.projectGroup || null, row.projectCode, row.title || `立项申请-${row.studentNo}`, row.category || null, row.approvalDate || null, batch.approval_round, row.remark || null]
    );
    project = { id: created.insertId };
  } else if (project.status === 'draft') {
    await connection.execute("UPDATE projects SET status = 'active', updated_at = NOW() WHERE id = ?", [project.id]);
  }
  const [[projectOwner]] = await connection.execute(
    `SELECT person_id FROM project_participations WHERE project_id = ? AND role = 'owner' AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [project.id]
  );
  if (projectOwner && Number(projectOwner.person_id) !== Number(personId)) throw badRequest(`Project ${row.projectCode} already has another owner`, 'PROJECT_OWNER_CONFLICT');
  if (!projectOwner) {
    await connection.execute(
      `INSERT INTO project_participations (project_id, person_id, role, is_primary_owner, joined_at)
       VALUES (?, ?, 'owner', 1, ?)`, [project.id, personId, row.approvalDate || null]
    );
  }
  await assertFormalProjectOwnership(connection, [Number(project.id)]);
  await connection.execute(
    `INSERT INTO project_approval_sources
     (project_id, application_batch_id, project_application_id, school_result_import_id, source_type, historical_material_status, official_row_snapshot, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [project.id, batch.id, applicationId, importId, applicationId ? 'application' : 'historical_official_list', applicationId ? 'available' : 'missing_historical', JSON.stringify(row), userId]
  );
  return Number(project.id);
}

router.post('/result-imports/:id/commit', requireAuth, requireRole('admin'), async (req, res, next) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[record]] = await connection.execute("SELECT * FROM school_result_imports WHERE id = ? AND validation_status = 'valid' FOR UPDATE", [req.params.id]);
    if (!record) throw badRequest('Validated import not found or already committed', 'VALIDATION_ERROR');
    const [[batch]] = await connection.execute('SELECT * FROM application_batches WHERE id = ? FOR UPDATE', [record.application_batch_id]);
    const rows = parseJson(record.normalized_rows, []);
    let approved = 0;
    let rejected = 0;
    for (const row of rows) {
      if (record.import_kind === 'historical_first') {
        let [[person]] = await connection.execute('SELECT * FROM people WHERE student_no = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [row.studentNo]);
        if (!person) {
          const [created] = await connection.execute(
            `INSERT INTO people (person_type, name, student_no, college, account_status, remark)
             VALUES ('student', ?, ?, NULL, 'none', '由历史首次立项正式名单补录，未创建账号')`, [row.name, row.studentNo]
          );
          person = { id: created.insertId };
        }
        const projectId = await ensureProjectForResult(connection, { batch, row, personId: person.id, applicationId: null, importId: record.id, userId: req.user.id });
        await appendApplicationAudit(connection, { eventType: 'historical_project_linked', user: req.user, batchId: batch.id, projectId, payload: { importId: Number(record.id), studentNo: row.studentNo, materials: 'missing_historical' }, ip: req.ip });
        approved += 1;
      } else {
        const [[application]] = await connection.execute('SELECT * FROM project_applications WHERE id = ? AND application_batch_id = ? FOR UPDATE', [row.applicationId, batch.id]);
        if (!application || application.status !== 'frozen') throw badRequest(`Application row ${row.row} is no longer frozen`, 'ILLEGAL_STATUS_TRANSITION');
        if (row.result === 'approved') {
          assertApplicationTransition(application.status, 'school_approved');
          const projectId = await ensureProjectForResult(connection, { batch, row: { ...row, title: parseJson(application.application_data, {}).title || row.title }, personId: application.applicant_person_id, applicationId: application.id, importId: record.id, userId: req.user.id });
          assertApplicationTransition('school_approved', 'converted');
          await connection.execute(
            `UPDATE project_applications SET status = 'converted', school_result_at = NOW(), school_result_remark = ?, project_id = ?, updated_at = NOW() WHERE id = ?`,
            [row.remark || null, projectId, application.id]
          );
          await connection.execute("UPDATE users SET role = 'project_owner', token_version = token_version + 1, updated_at = NOW() WHERE id = ? AND role = 'applicant'", [application.applicant_user_id]);
          await appendApplicationAudit(connection, { eventType: 'school_approved_and_project_created', user: req.user, batchId: batch.id, applicationId: application.id, projectId, payload: { importId: Number(record.id), schoolResult: 'approved' }, ip: req.ip });
          approved += 1;
        } else {
          assertApplicationTransition(application.status, 'school_rejected');
          await connection.execute("UPDATE project_applications SET status = 'school_rejected', school_result_at = NOW(), school_result_remark = ?, updated_at = NOW() WHERE id = ?", [row.remark || null, application.id]);
          await appendApplicationAudit(connection, { eventType: 'school_rejected', user: req.user, batchId: batch.id, applicationId: application.id, payload: { importId: Number(record.id), schoolResult: 'rejected', remark: row.remark || null }, ip: req.ip });
          rejected += 1;
        }
      }
    }
    await connection.execute("UPDATE school_result_imports SET validation_status = 'committed', committed_by = ?, committed_at = NOW() WHERE id = ?", [req.user.id, record.id]);
    if (record.import_kind === 'historical_first') {
      await connection.execute("UPDATE application_batches SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = ?", [batch.id]);
    } else {
      const [[remaining]] = await connection.execute("SELECT COUNT(*) AS total FROM project_applications WHERE application_batch_id = ? AND status = 'frozen'", [batch.id]);
      if (Number(remaining.total) === 0) {
        await connection.execute("UPDATE application_batches SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = ?", [batch.id]);
      }
    }
    await appendApplicationAudit(connection, { eventType: 'school_result_import_committed', user: req.user, batchId: batch.id, payload: { importId: Number(record.id), approved, rejected, kind: record.import_kind }, ip: req.ip });
    await connection.commit();
    success(res, { approved, rejected }, 'School results committed atomically');
  } catch (error) {
    await connection?.rollback().catch(() => undefined);
    if (error.code === 'ER_DUP_ENTRY') { error.status = 409; error.code = 'DUPLICATE_RESOURCE'; error.message = 'Project code, project owner, or source link conflicts with existing data'; }
    next(error);
  } finally { connection?.release(); }
});

router.get('/projects/:projectId/source', requireAuth, requireRole('admin', 'project_owner'), async (req, res, next) => {
  try {
    if (req.user.role === 'project_owner') {
      const [[owned]] = await pool.execute("SELECT 1 FROM project_participations WHERE project_id = ? AND person_id = ? AND role = 'owner' AND deleted_at IS NULL LIMIT 1", [req.params.projectId, req.user.personId]);
      if (!owned) throw notFound('Project not found');
    }
    const [[source]] = await pool.execute(
      `SELECT pas.source_type AS sourceType, pas.historical_material_status AS historicalMaterialStatus,
              pas.official_row_snapshot AS officialRowSnapshot, pas.project_application_id AS applicationId,
              ab.id AS batchId, ab.batch_name AS batchName, ab.application_year AS applicationYear,
              ab.approval_round AS approvalRound, sri.original_name AS officialListName, sri.sha256 AS officialListSha256
       FROM project_approval_sources pas JOIN application_batches ab ON ab.id = pas.application_batch_id
       LEFT JOIN school_result_imports sri ON sri.id = pas.school_result_import_id WHERE pas.project_id = ? LIMIT 1`,
      [req.params.projectId]
    );
    if (!source) throw notFound('Project approval source not found');
    success(res, source);
  } catch (error) { next(error); }
});

router.get('/:id/audit', requireAuth, async (req, res, next) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await loadApplicationForAccess(connection, req.params.id, req.user);
    const [items] = await connection.execute(
      `SELECT aae.id, aae.event_type AS eventType, aae.event_payload AS eventPayload, aae.created_at AS createdAt,
              u.display_name AS actorName FROM application_audit_events aae
       LEFT JOIN users u ON u.id = aae.actor_user_id WHERE aae.project_application_id = ? ORDER BY aae.id`, [req.params.id]
    );
    success(res, items);
  } catch (error) { next(error); }
  finally { connection?.release(); }
});

export default router;
