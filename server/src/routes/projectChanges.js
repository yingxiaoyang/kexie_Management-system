import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { Router } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireAdminPermission, requirePermissionWhenAdmin } from '../utils/adminPermissions.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { normalizeUploadedFileName, setFileResponseHeaders } from '../utils/fileNames.js';
import { paginationFrom } from '../utils/query.js';
import { success } from '../utils/response.js';
import { assertPlanWithinScope, changeSummary, normalizeChangePlan } from '../utils/projectChange.js';
import {
  loadProjectChangeSnapshot,
  parseProjectChangeJson,
  validateProjectChangePlan
} from '../services/projectChangeService.js';

const router = Router();

function proofDirectory() {
  const now = new Date();
  return path.join(env.upload.root, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), 'project-changes');
}

const proofStorage = multer.diskStorage({
  destination(_req, _file, callback) {
    const directory = proofDirectory();
    fs.mkdirSync(directory, { recursive: true });
    callback(null, directory);
  },
  filename(_req, file, callback) {
    callback(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
  }
});
const proofUploader = multer({
  storage: proofStorage,
  limits: { fileSize: env.upload.maxFileBytes },
  fileFilter(_req, file, callback) {
    const extension = path.extname(file.originalname).slice(1).toLowerCase();
    if (!env.upload.allowedExtensions.includes(extension)) {
      callback(badRequest(`不允许上传 .${extension} 文件`, 'UPLOAD_TYPE_NOT_ALLOWED'));
      return;
    }
    callback(null, true);
  }
});

function singleProof(req, res, next) {
  proofUploader.single('file')(req, res, async (error) => {
    if (error && req.file) await fs.promises.unlink(req.file.path).catch(() => undefined);
    next(error);
  });
}

async function changeAccess(connection, id, user, { lock = false, review = false } = {}) {
  const [[row]] = await connection.execute(
    `SELECT pcr.*, mt.task_type AS taskType, mt.status AS taskStatus, mt.change_scope AS changeScope,
            p.project_code AS projectCode, p.title AS projectTitle,
            initiator.display_name AS initiatorName
     FROM project_change_requests pcr
     JOIN material_tasks mt ON mt.id = pcr.material_task_id
     JOIN projects p ON p.id = pcr.project_id AND p.deleted_at IS NULL
     JOIN users initiator ON initiator.id = pcr.initiated_by
     WHERE pcr.id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [id]
  );
  if (!row) throw notFound('项目变更申请不存在');
  if (user.role === 'project_owner') {
    const [[owned]] = await connection.execute(
      `SELECT id FROM project_participations
       WHERE project_id = ? AND person_id = ? AND role = 'owner' AND deleted_at IS NULL LIMIT 1`,
      [row.project_id, user.personId || 0]
    );
    if (!owned || Number(row.initiated_by) !== Number(user.id)) throw forbidden('无权访问该项目变更申请');
  } else if (!review && (user.adminLevel !== 'super' || Number(row.initiated_by) !== Number(user.id))) {
    throw forbidden('只有发起该强制变更的超级管理员可以修改草稿');
  } else if (review && user.adminLevel !== 'super') {
    const [[assigned]] = await connection.execute(
      `SELECT id FROM material_submissions WHERE id = ? AND assigned_to = ? AND deleted_at IS NULL LIMIT 1`,
      [row.latest_submission_id || 0, user.id]
    );
    if (!assigned) throw forbidden('该变更材料未分配给你', 'MATERIAL_REVIEW_NOT_ASSIGNED');
  }
  return row;
}

function viewRow(row) {
  const plan = normalizeChangePlan(parseProjectChangeJson(row.proposedChanges));
  return {
    id: Number(row.id), taskId: Number(row.material_task_id ?? row.taskId), projectId: Number(row.project_id ?? row.projectId),
    taskName: row.taskName, projectCode: row.projectCode, projectTitle: row.projectTitle,
    initiatorName: row.initiatorName, initiatorType: row.initiator_type ?? row.initiatorType,
    status: row.status, currentVersion: Number((row.current_version ?? row.currentVersion) || 0),
    latestSubmissionId: row.latest_submission_id == null ? row.latestSubmissionId : Number(row.latest_submission_id),
    proposedChanges: plan, changeSummary: changeSummary(plan), changeScope: parseProjectChangeJson(row.changeScope),
    forcedReason: row.forced_reason ?? row.forcedReason, returnReason: row.return_reason ?? row.returnReason,
    submittedAt: row.submitted_at ?? row.submittedAt, reviewedAt: row.reviewed_at ?? row.reviewedAt,
    effectiveAt: row.effective_at ?? row.effectiveAt, createdAt: row.created_at ?? row.createdAt,
    assignmentVersion: Number(row.assignmentVersion || 0), assignedTo: row.assignedTo == null ? null : Number(row.assignedTo)
  };
}

router.get('/options', requireAuth, requireRole('project_owner', 'admin'), requirePermissionWhenAdmin('material_review'), async (req, res, next) => {
  try {
    const params = [];
    let ownership = '';
    if (req.user.role === 'project_owner') {
      ownership = `AND EXISTS (SELECT 1 FROM project_participations pp
        WHERE pp.project_id = p.id AND pp.person_id = ? AND pp.role = 'owner' AND pp.deleted_at IS NULL)`;
      params.push(req.user.personId || 0);
    }
    const [tasks] = await pool.execute(
      `SELECT mt.id AS taskId, mt.task_name AS taskName, mt.change_phase AS changePhase, mt.change_scope AS changeScope,
              p.id AS projectId, p.project_code AS projectCode, p.title AS projectTitle
       FROM projects p JOIN material_tasks mt ON mt.task_type = 'project_change' AND mt.status = 'published'
         AND mt.deleted_at IS NULL AND (
           mt.project_scope_type = 'all' OR (mt.project_scope_type = 'year' AND mt.project_year = p.project_year)
           OR (mt.project_scope_type = 'group' AND mt.project_group = p.project_group)
           OR (mt.project_scope_type = 'custom' AND EXISTS (
             SELECT 1 FROM material_task_projects mtp WHERE mtp.material_task_id = mt.id AND mtp.project_id = p.id
           )))
       WHERE p.deleted_at IS NULL ${ownership} ORDER BY mt.deadline_at, p.project_code`, params
    );
    const [students] = await pool.execute(
      `SELECT pe.id, pe.name, pe.student_no AS identifier, pe.account_status AS accountStatus,
              u.id AS userId, u.role AS accountRole, u.status AS userStatus
       FROM people pe LEFT JOIN users u ON u.person_id = pe.id AND u.deleted_at IS NULL
       WHERE pe.person_type = 'student' AND pe.deleted_at IS NULL ORDER BY pe.student_no`
    );
    const [teachers] = await pool.execute(
      `SELECT id, name, teacher_no AS identifier FROM people
       WHERE person_type = 'teacher' AND deleted_at IS NULL ORDER BY teacher_no`
    );
    success(res, { tasks: tasks.map((item) => ({ ...item, changeScope: parseProjectChangeJson(item.changeScope) })), students, teachers });
  } catch (error) { next(error); }
});

router.get('/', requireAuth, requireRole('project_owner', 'admin'), requirePermissionWhenAdmin('material_review'), async (req, res, next) => {
  try {
    if (req.user.role === 'admin' && !req.user.permissions?.includes('material_review') && req.user.adminLevel !== 'super') {
      throw forbidden('当前管理员未获授材料审核权限', 'ADMIN_PERMISSION_REQUIRED');
    }
    const { page, pageSize, offset } = paginationFrom(req.query);
    const conditions = [];
    const params = [];
    if (req.user.role === 'project_owner') {
      conditions.push('pcr.initiated_by = ?'); params.push(req.user.id);
    } else if (req.user.adminLevel !== 'super') {
      conditions.push('ms.assigned_to = ?'); params.push(req.user.id);
    }
    if (req.query.status) { conditions.push('pcr.status = ?'); params.push(req.query.status); }
    if (req.query.exportState === 'pending') conditions.push("pcr.status = 'submitted'");
    if (req.query.exportState === 'approved') conditions.push("pcr.status = 'approved'");
    if (req.query.exportState === 'returned') conditions.push("pcr.status = 'returned'");
    if (req.query.keyword) {
      conditions.push('(p.project_code LIKE ? OR p.title LIKE ? OR initiator.display_name LIKE ?)');
      const keyword = `%${String(req.query.keyword).trim()}%`; params.push(keyword, keyword, keyword);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const from = `FROM project_change_requests pcr
      JOIN material_tasks mt ON mt.id = pcr.material_task_id
      JOIN projects p ON p.id = pcr.project_id
      JOIN users initiator ON initiator.id = pcr.initiated_by
      LEFT JOIN material_submissions ms ON ms.id = pcr.latest_submission_id`;
    const [[count]] = await pool.execute(`SELECT COUNT(*) AS total ${from} ${where}`, params);
    const [rows] = await pool.execute(
      `SELECT pcr.*, mt.task_name AS taskName, mt.change_scope AS changeScope,
              p.project_code AS projectCode, p.title AS projectTitle, initiator.display_name AS initiatorName,
              ms.assignment_version AS assignmentVersion, ms.assigned_to AS assignedTo
       ${from} ${where} ORDER BY pcr.updated_at DESC LIMIT ${pageSize} OFFSET ${offset}`, params
    );
    success(res, rows.map(viewRow), 'ok', { pagination: { page, pageSize, total: Number(count.total), totalPages: Math.ceil(Number(count.total) / pageSize) } });
  } catch (error) { next(error); }
});

router.get('/export', requireAuth, requireRole('admin'), requireAdminPermission('material_review'), async (req, res, next) => {
  try {
    const conditions = [];
    const params = [];
    if (req.user.adminLevel !== 'super') { conditions.push('ms.assigned_to = ?'); params.push(req.user.id); }
    if (req.query.status) { conditions.push('pcr.status = ?'); params.push(req.query.status); }
    const [rows] = await pool.execute(
      `SELECT p.project_code AS projectCode, p.title AS projectTitle, mt.task_name AS taskName,
              initiator.display_name AS initiatorName, pcr.initiator_type AS initiatorType,
              pcr.proposed_changes AS proposedChanges, pcr.status, pcr.current_version AS version,
              pcr.submitted_at AS submittedAt, pcr.reviewed_at AS reviewedAt, reviewer.display_name AS reviewerName
       FROM project_change_requests pcr JOIN projects p ON p.id = pcr.project_id
       JOIN material_tasks mt ON mt.id = pcr.material_task_id JOIN users initiator ON initiator.id = pcr.initiated_by
       LEFT JOIN users reviewer ON reviewer.id = pcr.reviewed_by
       LEFT JOIN material_submissions ms ON ms.id = pcr.latest_submission_id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY p.project_code, pcr.id`, params
    );
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('项目变更申请');
    sheet.columns = [
      { header: '项目编号', key: 'projectCode', width: 18 }, { header: '项目名称', key: 'projectTitle', width: 32 },
      { header: '任务', key: 'taskName', width: 24 }, { header: '申请人', key: 'initiatorName', width: 14 },
      { header: '发起方式', key: 'initiatorType', width: 14 }, { header: '变更摘要', key: 'summary', width: 48 },
      { header: '状态', key: 'status', width: 12 }, { header: '版本', key: 'version', width: 8 },
      { header: '提交时间', key: 'submittedAt', width: 22 }, { header: '审核人', key: 'reviewerName', width: 14 },
      { header: '审核时间', key: 'reviewedAt', width: 22 }
    ];
    const labels = { owner: '负责人申请', forced_admin: '超级管理员强制发起', draft: '草稿', submitted: '待审核', returned: '已退回', approved: '已通过' };
    for (const row of rows) sheet.addRow({ ...row, initiatorType: labels[row.initiatorType], status: labels[row.status], summary: changeSummary(normalizeChangePlan(parseProjectChangeJson(row.proposedChanges))) });
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: 'A1', to: 'K1' };
    setFileResponseHeaders(res, { fileName: `项目变更申请-${new Date().toISOString().slice(0, 10)}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) { next(error); }
});

router.post('/', requireAuth, requireRole('project_owner', 'admin'), async (req, res, next) => {
  let connection;
  try {
    const taskId = Number(req.body.taskId); const projectId = Number(req.body.projectId);
    if (!taskId || !projectId) throw badRequest('请选择项目和变更任务', 'VALIDATION_ERROR');
    const forced = req.user.role === 'admin';
    const forcedReason = forced ? String(req.body.forcedReason || '').trim() : null;
    if (forced && req.user.adminLevel !== 'super') throw forbidden('仅超级管理员可以强制发起负责人变更', 'SUPER_ADMIN_REQUIRED');
    if (forced && !forcedReason) throw badRequest('强制变更必须填写原因', 'FORCED_CHANGE_REASON_REQUIRED');
    const plan = normalizeChangePlan(req.body.proposedChanges);
    connection = await pool.getConnection(); await connection.beginTransaction();
    const [[context]] = await connection.execute(
      `SELECT mt.change_scope AS changeScope, mt.status AS taskStatus,
              mt.project_scope_type AS scopeType, mt.project_year AS taskYear, mt.project_group AS taskGroup,
              p.project_year AS projectYear, p.project_group AS projectGroup,
              EXISTS(SELECT 1 FROM material_task_projects mtp WHERE mtp.material_task_id = mt.id AND mtp.project_id = p.id) AS customIncluded,
              EXISTS(SELECT 1 FROM project_participations pp WHERE pp.project_id = p.id AND pp.person_id = ?
                AND pp.role = 'owner' AND pp.deleted_at IS NULL) AS ownsProject
       FROM material_tasks mt JOIN projects p ON p.id = ? AND p.deleted_at IS NULL
       WHERE mt.id = ? AND mt.task_type = 'project_change' AND mt.deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [req.user.personId || 0, projectId, taskId]
    );
    if (!context) throw notFound('项目信息变更任务不存在');
    if (context.taskStatus !== 'published') throw badRequest('该变更任务当前未开放', 'PROJECT_CHANGE_TASK_CLOSED');
    const inScope = context.scopeType === 'all'
      || (context.scopeType === 'year' && Number(context.taskYear) === Number(context.projectYear))
      || (context.scopeType === 'group' && context.taskGroup === context.projectGroup)
      || (context.scopeType === 'custom' && Boolean(context.customIncluded));
    if (!inScope) throw forbidden('该项目不在此变更任务的适用范围内', 'PROJECT_CHANGE_PROJECT_OUT_OF_SCOPE');
    if (!forced && !context.ownsProject) throw forbidden('只有当前负责人可以发起项目变更');
    assertPlanWithinScope(plan, parseProjectChangeJson(context.changeScope), { allowEmpty: true });
    if (forced && !plan.ownerChange) throw badRequest('强制发起仅用于负责人无法操作时的负责人变更', 'FORCED_OWNER_CHANGE_ONLY');
    const [result] = await connection.execute(
      `INSERT INTO project_change_requests
       (material_task_id, project_id, initiated_by, initiator_type, proposed_changes, forced_reason)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)`,
      [taskId, projectId, req.user.id, forced ? 'forced_admin' : 'owner', JSON.stringify(plan), forcedReason]
    );
    await connection.execute(
      `INSERT INTO project_change_audit_events
       (change_request_id, project_id, version_no, event_type, actor_user_id, event_payload)
       VALUES (?, ?, 0, 'draft_created', ?, CAST(? AS JSON))`,
      [result.insertId, projectId, req.user.id, JSON.stringify({ forcedReason, summary: changeSummary(plan) })]
    );
    await connection.commit(); success(res, { id: Number(result.insertId) }, '变更草稿已创建');
  } catch (error) { await connection?.rollback(); next(error); } finally { connection?.release(); }
});

router.put('/:id', requireAuth, requireRole('project_owner', 'admin'), async (req, res, next) => {
  let connection;
  try {
    connection = await pool.getConnection(); await connection.beginTransaction();
    const row = await changeAccess(connection, req.params.id, req.user, { lock: true });
    if (!['draft', 'returned'].includes(row.status)) throw conflict('已提交或已通过的变更申请不能修改', 'PROJECT_CHANGE_NOT_EDITABLE');
    const plan = normalizeChangePlan(req.body.proposedChanges);
    assertPlanWithinScope(plan, parseProjectChangeJson(row.changeScope), { allowEmpty: true });
    await connection.execute(
      `UPDATE project_change_requests SET proposed_changes = CAST(? AS JSON), updated_at = NOW() WHERE id = ?`,
      [JSON.stringify(plan), row.id]
    );
    await connection.execute(
      `INSERT INTO project_change_audit_events
       (change_request_id, project_id, version_no, event_type, actor_user_id, event_payload)
       VALUES (?, ?, ?, 'draft_saved', ?, CAST(? AS JSON))`,
      [row.id, row.project_id, row.current_version, req.user.id, JSON.stringify({ summary: changeSummary(plan) })]
    );
    await connection.commit(); success(res, { id: Number(row.id), proposedChanges: plan }, '草稿已保存');
  } catch (error) { await connection?.rollback(); next(error); } finally { connection?.release(); }
});

router.post('/:id/proof', requireAuth, requireRole('project_owner', 'admin'), singleProof, async (req, res, next) => {
  let connection;
  try {
    if (!req.file) throw badRequest('请选择变更证明文件', 'PROOF_FILE_REQUIRED');
    connection = await pool.getConnection(); await connection.beginTransaction();
    const row = await changeAccess(connection, req.params.id, req.user, { lock: true });
    if (!['draft', 'returned'].includes(row.status)) throw conflict('当前状态不能上传证明文件', 'PROJECT_CHANGE_NOT_EDITABLE');
    const [[fileRule]] = await connection.execute(
      `SELECT COALESCE(mc.allowed_extensions, mt.allowed_extensions) AS allowedExtensions,
              COALESCE(mc.max_file_mb, mt.max_file_mb) AS maxFileMb, mt.max_task_project_mb AS maxTaskProjectMb
       FROM material_tasks mt LEFT JOIN material_categories mc ON mc.id = (
         SELECT c.id FROM material_categories c WHERE c.material_task_id = mt.id AND c.deleted_at IS NULL
         ORDER BY c.is_required DESC, c.sort_order, c.id LIMIT 1)
       WHERE mt.id = ? LIMIT 1`, [row.material_task_id]
    );
    const allowed = parseProjectChangeJson(fileRule?.allowedExtensions, []);
    const extension = path.extname(req.file.originalname).slice(1).toLowerCase();
    if (allowed.length && !allowed.includes(extension)) throw badRequest(`证明文件不允许使用 .${extension} 格式`, 'UPLOAD_TYPE_NOT_ALLOWED');
    if (req.file.size > Number(fileRule?.maxFileMb || 50) * 1024 * 1024) throw badRequest('证明文件超过单文件大小限制', 'UPLOAD_FILE_SIZE_EXCEEDED');
    const [[used]] = await connection.execute(
      `SELECT COALESCE(SUM(file_size), 0) AS total FROM project_change_draft_files
       WHERE change_request_id = ? AND deleted_at IS NULL`, [row.id]
    );
    if (Number(used.total) + req.file.size > Number(fileRule?.maxTaskProjectMb || 500) * 1024 * 1024) {
      throw badRequest('证明文件累计大小超过任务限制', 'UPLOAD_TOTAL_SIZE_EXCEEDED');
    }
    const name = normalizeUploadedFileName(req.file.originalname);
    const [result] = await connection.execute(
      `INSERT INTO project_change_draft_files
       (change_request_id, original_name, storage_path, file_size, mime_type, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`, [row.id, name, req.file.path, req.file.size, req.file.mimetype, req.user.id]
    );
    await connection.execute(
      `INSERT INTO project_change_audit_events
       (change_request_id, project_id, version_no, event_type, actor_user_id, event_payload)
       VALUES (?, ?, ?, 'proof_uploaded', ?, CAST(? AS JSON))`,
      [row.id, row.project_id, row.current_version, req.user.id, JSON.stringify({ fileId: Number(result.insertId), originalName: name })]
    );
    await connection.commit(); success(res, { id: Number(result.insertId), originalName: name }, '证明文件已上传');
  } catch (error) {
    await connection?.rollback();
    if (req.file) await fs.promises.unlink(req.file.path).catch(() => undefined);
    next(error);
  } finally { connection?.release(); }
});

router.post('/:id/submit', requireAuth, requireRole('project_owner', 'admin'), async (req, res, next) => {
  let connection;
  try {
    connection = await pool.getConnection(); await connection.beginTransaction();
    const row = await changeAccess(connection, req.params.id, req.user, { lock: true });
    if (!['draft', 'returned'].includes(row.status)) throw conflict('该申请已提交，请勿重复操作', 'PROJECT_CHANGE_ALREADY_SUBMITTED');
    if (row.taskStatus !== 'published') throw badRequest('该变更任务已关闭，不能提交', 'PROJECT_CHANGE_TASK_CLOSED');
    const [files] = await connection.execute(
      `SELECT * FROM project_change_draft_files WHERE change_request_id = ? AND deleted_at IS NULL FOR UPDATE`, [row.id]
    );
    if (!files.length) throw badRequest('必须上传变更证明文件', 'PROOF_FILE_REQUIRED');
    const { plan } = await validateProjectChangePlan(connection, {
      projectId: row.project_id, plan: parseProjectChangeJson(row.proposed_changes), changeScope: parseProjectChangeJson(row.changeScope), lock: true
    });
    const snapshot = await loadProjectChangeSnapshot(connection, row.project_id);
    const [[category]] = await connection.execute(
      `SELECT id FROM material_categories WHERE material_task_id = ? AND deleted_at IS NULL ORDER BY is_required DESC, sort_order, id LIMIT 1`,
      [row.material_task_id]
    );
    if (!category) throw conflict('变更任务缺少证明文件子任务，请联系管理员', 'PROJECT_CHANGE_CATEGORY_MISSING');
    const [submission] = await connection.execute(
      `INSERT INTO material_submissions
       (material_task_id, project_id, material_category_id, submitter_user_id, submission_status, review_status, submitted_at)
       VALUES (?, ?, ?, ?, 'submitted', 'pending', NOW())`,
      [row.material_task_id, row.project_id, category.id, req.user.id]
    );
    for (const file of files) {
      await connection.execute(
        `INSERT INTO material_files (submission_id, original_name, storage_path, file_size, mime_type, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [submission.insertId, file.original_name, file.storage_path, file.file_size, file.mime_type, file.uploaded_by]
      );
    }
    const version = Number(row.current_version) + 1;
    await connection.execute(
      `INSERT INTO project_change_versions
       (change_request_id, version_no, material_submission_id, before_snapshot, proposed_changes, submitted_by)
       VALUES (?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)`,
      [row.id, version, submission.insertId, JSON.stringify(snapshot), JSON.stringify(plan), req.user.id]
    );
    const [updated] = await connection.execute(
      `UPDATE project_change_requests SET status = 'submitted', current_version = ?, proposed_changes = CAST(? AS JSON),
       return_reason = NULL, latest_submission_id = ?, submitted_at = NOW(), reviewed_by = NULL,
       reviewed_at = NULL, updated_at = NOW() WHERE id = ? AND status IN ('draft', 'returned')`,
      [version, JSON.stringify(plan), submission.insertId, row.id]
    );
    if (updated.affectedRows !== 1) throw conflict('申请状态已变化，请刷新后重试', 'PROJECT_CHANGE_SUBMIT_CONFLICT');
    await connection.execute(
      `INSERT INTO project_change_audit_events
       (change_request_id, project_id, version_no, event_type, actor_user_id, material_submission_id, event_payload)
       VALUES (?, ?, ?, 'submitted', ?, ?, CAST(? AS JSON))`,
      [row.id, row.project_id, version, req.user.id, submission.insertId, JSON.stringify({ summary: changeSummary(plan), proofFileCount: files.length })]
    );
    await connection.commit(); success(res, { id: Number(row.id), version, submissionId: Number(submission.insertId) }, '项目变更申请已提交审核');
  } catch (error) { await connection?.rollback(); next(error); } finally { connection?.release(); }
});

router.get('/:id', requireAuth, requireRole('project_owner', 'admin'), requirePermissionWhenAdmin('material_review'), async (req, res, next) => {
  try {
    const row = await changeAccess(pool, req.params.id, req.user, { review: req.user.role === 'admin' });
    const [versions] = await pool.execute(
      `SELECT pcv.version_no AS version, pcv.material_submission_id AS submissionId,
              pcv.before_snapshot AS beforeSnapshot, pcv.proposed_changes AS proposedChanges,
              pcv.submitted_at AS submittedAt, u.display_name AS submittedBy
       FROM project_change_versions pcv JOIN users u ON u.id = pcv.submitted_by
       WHERE pcv.change_request_id = ? ORDER BY pcv.version_no DESC`, [row.id]
    );
    const [files] = await pool.execute(
      `SELECT id, original_name AS originalName, file_size AS fileSize, mime_type AS mimeType, created_at AS createdAt
       FROM project_change_draft_files WHERE change_request_id = ? AND deleted_at IS NULL ORDER BY id`, [row.id]
    );
    const currentSnapshot = await loadProjectChangeSnapshot(pool, row.project_id);
    success(res, { ...viewRow(row), files, versions: versions.map((item) => ({ ...item, beforeSnapshot: parseProjectChangeJson(item.beforeSnapshot), proposedChanges: parseProjectChangeJson(item.proposedChanges) })), currentSnapshot });
  } catch (error) { next(error); }
});

export default router;
