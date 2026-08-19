import fs from 'node:fs';
import archiver from 'archiver';
import { Router } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ensureSubmissionAccess } from '../utils/accessControl.js';
import { resolveDownloadFile } from '../utils/safeFiles.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { paginationFrom } from '../utils/query.js';
import { success } from '../utils/response.js';
import { requireAdminPermission, requirePermissionWhenAdmin, requireSuperAdmin } from '../utils/adminPermissions.js';
import { filePreviewInfo, inspectOriginalFileName, matchesPreviewSignature, setFileResponseHeaders } from '../utils/fileNames.js';
import { expectedAssignmentVersion, parseSubmissionIds, sanitizeZipSegment, uniqueZipEntryName } from '../utils/materialReview.js';

const router = Router();

function materialFileView(row) {
  const name = inspectOriginalFileName(row.originalName);
  return {
    id: Number(row.id),
    originalName: name.displayName,
    storedOriginalName: name.originalName,
    fileNameRecovered: name.recovered,
    fileNameWarning: name.warning,
    fileSize: Number(row.fileSize),
    mimeType: row.mimeType,
    createdAt: row.createdAt,
    ...filePreviewInfo(name.displayName, row.mimeType)
  };
}

async function ensureReviewSubmissionAccess(user, submissionId, connection = pool) {
  if (user.role !== 'admin') return ensureSubmissionAccess(user, submissionId, connection);
  const [[submission]] = await connection.execute(
    `SELECT id, project_id AS projectId, assigned_to AS assignedTo
     FROM material_submissions WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [submissionId]
  );
  if (!submission) throw notFound('材料提交记录不存在');
  if (user.adminLevel !== 'super' && Number(submission.assignedTo || 0) !== Number(user.id)) {
    throw forbidden('该审核任务未分配给你，或已经被改派', 'MATERIAL_REVIEW_NOT_ASSIGNED');
  }
  return submission;
}

async function resolveSubmissionFile(submissionId, fileId) {
  const [[file]] = await pool.execute(
    `SELECT mf.id, mf.original_name AS originalName, mf.storage_path AS storagePath,
            mf.file_size AS fileSize, mf.mime_type AS mimeType, mf.created_at AS createdAt
     FROM material_files mf JOIN material_submissions ms ON ms.id = mf.submission_id
     WHERE mf.id = ? AND mf.submission_id = ? AND mf.deleted_at IS NULL AND ms.deleted_at IS NULL LIMIT 1`,
    [fileId, submissionId]
  );
  if (!file) throw notFound('文件不存在');
  const filePath = await resolveDownloadFile(env.upload.root, file.storagePath, {
    invalidMessage: '材料文件路径超出系统上传目录',
    invalidCode: 'SUBMISSION_FILE_PATH_INVALID',
    missingMessage: '材料文件不存在'
  });
  return { filePath, view: materialFileView(file) };
}

router.get('/review-options', requireAuth, requireRole('admin'), requireSuperAdmin, async (_req, res, next) => {
  try {
    const [[reviewers], [projects], [tasks]] = await Promise.all([
      pool.execute(
        `SELECT u.id, u.display_name AS displayName, u.username
         FROM users u JOIN admin_user_permissions permission
           ON permission.user_id = u.id AND permission.permission_key = 'material_review'
         WHERE u.role = 'admin' AND u.admin_level = 'limited' AND u.status = 'enabled' AND u.deleted_at IS NULL
         ORDER BY u.display_name, u.id`
      ),
      pool.execute(
        `SELECT DISTINCT p.id, p.project_code AS projectCode, p.title
         FROM material_submissions ms JOIN projects p ON p.id = ms.project_id
         WHERE ms.deleted_at IS NULL ORDER BY p.project_code, p.id`
      ),
      pool.execute(
        `SELECT DISTINCT mt.id, mt.task_name AS taskName
         FROM material_submissions ms JOIN material_tasks mt ON mt.id = ms.material_task_id
         WHERE ms.deleted_at IS NULL ORDER BY mt.task_name, mt.id`
      )
    ]);
    success(res, { reviewers, projects, tasks });
  } catch (error) {
    next(error);
  }
});

router.post('/batch-assign', requireAuth, requireRole('admin'), requireSuperAdmin, async (req, res, next) => {
  let connection;
  let transactionActive = false;
  try {
    const submissionIds = parseSubmissionIds(req.body.submissionIds);
    const assigneeId = Number(req.body.assigneeId);
    const reason = String(req.body.reason || '').trim();
    if (!Number.isSafeInteger(assigneeId) || assigneeId <= 0) {
      throw badRequest('请选择要分配的小管理员', 'VALIDATION_ERROR');
    }
    if (reason.length > 1000) throw badRequest('分配原因不能超过 1000 个字符', 'VALIDATION_ERROR');

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionActive = true;
    const [[assignee]] = await connection.execute(
      `SELECT u.id, u.display_name AS displayName
       FROM users u JOIN admin_user_permissions permission
         ON permission.user_id = u.id AND permission.permission_key = 'material_review'
       WHERE u.id = ? AND u.role = 'admin' AND u.admin_level = 'limited'
         AND u.status = 'enabled' AND u.deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [assigneeId]
    );
    if (!assignee) {
      throw badRequest('只能分配给有效且拥有“材料审核”权限的小管理员', 'INVALID_REVIEW_ASSIGNEE');
    }

    const placeholders = submissionIds.map(() => '?').join(',');
    const [submissions] = await connection.execute(
      `SELECT id, project_id AS projectId, review_status AS reviewStatus,
              assigned_to AS assignedTo, assignment_version AS assignmentVersion
       FROM material_submissions
       WHERE id IN (${placeholders}) AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
      submissionIds
    );
    if (submissions.length !== submissionIds.length) {
      throw notFound('部分材料审核任务不存在，请刷新列表后重试');
    }

    for (const submission of submissions) {
      const submissionId = Number(submission.id);
      const expectedVersion = expectedAssignmentVersion(req.body.expectedAssignmentVersions, submissionId);
      if (submission.reviewStatus !== 'pending') {
        throw conflict(`任务 ${submissionId} 已完成审核，不能再分配`, 'MATERIAL_REVIEW_ALREADY_COMPLETED');
      }
      if (Number(submission.assignmentVersion) !== expectedVersion) {
        throw conflict(`任务 ${submissionId} 的分配已发生变化，请刷新列表后重试`, 'MATERIAL_ASSIGNMENT_CONFLICT');
      }
      const previousAssigneeId = submission.assignedTo === null ? null : Number(submission.assignedTo);
      if (previousAssigneeId === assigneeId) {
        throw conflict(`任务 ${submissionId} 已分配给该小管理员`, 'MATERIAL_ASSIGNMENT_UNCHANGED');
      }
      if (previousAssigneeId && !reason) {
        throw badRequest('重新分配审核任务必须填写原因', 'REASSIGN_REASON_REQUIRED');
      }

      const [updated] = await connection.execute(
        `UPDATE material_submissions
         SET assigned_to = ?, assigned_by = ?, assigned_at = NOW(), assignment_version = assignment_version + 1, updated_at = NOW()
         WHERE id = ? AND review_status = 'pending' AND assignment_version = ? AND deleted_at IS NULL`,
        [assigneeId, req.user.id, submissionId, expectedVersion]
      );
      if (updated.affectedRows !== 1) {
        throw conflict(`任务 ${submissionId} 已被其他管理员处理，请刷新列表后重试`, 'MATERIAL_ASSIGNMENT_CONFLICT');
      }
      await connection.execute(
        `INSERT INTO material_review_audit_events
         (submission_id, project_id, event_type, actor_user_id, from_assignee_user_id,
          to_assignee_user_id, assignment_version, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [submissionId, submission.projectId, previousAssigneeId ? 'reassigned' : 'assigned', req.user.id,
          previousAssigneeId, assigneeId, expectedVersion + 1, previousAssigneeId ? reason : (reason || null)]
      );
    }

    await connection.commit();
    transactionActive = false;
    success(res, { assignedCount: submissions.length, assigneeId, assigneeName: assignee.displayName }, '审核任务已分配');
  } catch (error) {
    if (connection && transactionActive) await connection.rollback().catch(() => undefined);
    next(error);
  } finally {
    connection?.release();
  }
});

router.post('/batch-download', requireAuth, requireRole('admin'), requireAdminPermission('material_review'), async (req, res, next) => {
  try {
    const submissionIds = parseSubmissionIds(req.body.submissionIds);
    const placeholders = submissionIds.map(() => '?').join(',');
    const params = [...submissionIds];
    const assigneeCondition = req.user.adminLevel === 'super' ? '' : 'AND ms.assigned_to = ?';
    if (req.user.adminLevel !== 'super') params.push(req.user.id);
    const [rows] = await pool.execute(
      `SELECT ms.id AS submissionId, p.project_code AS projectCode, p.title AS projectTitle,
              mt.task_name AS taskName, mc.category_name AS categoryName,
              mf.id AS fileId, mf.original_name AS originalName, mf.storage_path AS storagePath,
              mf.file_size AS fileSize, mf.mime_type AS mimeType
       FROM material_submissions ms
       JOIN projects p ON p.id = ms.project_id
       JOIN material_tasks mt ON mt.id = ms.material_task_id
       JOIN material_categories mc ON mc.id = ms.material_category_id
       LEFT JOIN material_files mf ON mf.submission_id = ms.id AND mf.deleted_at IS NULL
       WHERE ms.id IN (${placeholders}) AND ms.deleted_at IS NULL ${assigneeCondition}
       ORDER BY ms.id, mf.id`,
      params
    );
    const visibleIds = new Set(rows.map((row) => Number(row.submissionId)));
    if (visibleIds.size !== submissionIds.length) {
      throw forbidden('所选任务中包含不存在或无权访问的审核任务', 'MATERIAL_REVIEW_BATCH_FORBIDDEN');
    }

    const entries = [];
    const usedNames = new Set();
    for (const row of rows) {
      if (!row.fileId) continue;
      const filePath = await resolveDownloadFile(env.upload.root, row.storagePath, {
        invalidMessage: '材料文件路径超出系统上传目录',
        invalidCode: 'SUBMISSION_FILE_PATH_INVALID',
        missingMessage: `材料文件 ${row.fileId} 不存在`
      });
      const fileName = inspectOriginalFileName(row.originalName).displayName;
      const directory = [
        `${sanitizeZipSegment(row.projectCode || `项目-${row.submissionId}`)}-${sanitizeZipSegment(row.projectTitle)}`,
        sanitizeZipSegment(row.taskName),
        `${sanitizeZipSegment(row.categoryName)}-提交${row.submissionId}`
      ].join('/');
      entries.push({ filePath, name: uniqueZipEntryName(directory, fileName, usedNames) });
    }
    if (!entries.length) throw badRequest('所选任务没有可下载的原始文件', 'NO_FILES_TO_DOWNLOAD');
    const totalFileBytes = rows.reduce((total, row) => total + Number(row.fileSize || 0), 0);
    if (totalFileBytes > env.archive.maxTotalFileBytes) {
      throw badRequest('所选原始文件总量超过单次下载上限，请减少选择后重试', 'BATCH_DOWNLOAD_SIZE_EXCEEDED');
    }

    const zipName = `材料审核原文件-${new Date().toISOString().slice(0, 10)}.zip`;
    setFileResponseHeaders(res, { fileName: zipName, contentType: 'application/zip' });
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (error) => res.destroy(error));
    req.on('aborted', () => archive.abort());
    archive.pipe(res);
    for (const entry of entries) archive.file(entry.filePath, { name: entry.name });
    await archive.finalize();
  } catch (error) {
    next(error);
  }
});

router.get('/', requireAuth, requireRole('admin', 'project_owner'), requirePermissionWhenAdmin('material_review'), async (req, res, next) => {
  try {
    const { page, pageSize, offset } = paginationFrom(req.query);
    const conditions = ['ms.deleted_at IS NULL'];
    const params = [];
    if (req.user.role === 'project_owner') {
      conditions.push(`EXISTS (
        SELECT 1 FROM project_participations mine
        WHERE mine.project_id = ms.project_id AND mine.person_id = ? AND mine.role = 'owner' AND mine.deleted_at IS NULL
      )`);
      params.push(req.user.personId || 0);
    } else if (req.user.adminLevel !== 'super') {
      conditions.push('ms.assigned_to = ?');
      params.push(req.user.id);
    }
    if (req.query.reviewStatus) {
      conditions.push('ms.review_status = ?');
      params.push(req.query.reviewStatus);
    }
    if (req.user.adminLevel === 'super' && req.query.assignmentStatus === 'unassigned') {
      conditions.push('ms.assigned_to IS NULL');
    } else if (req.user.adminLevel === 'super' && req.query.assignmentStatus === 'assigned') {
      conditions.push('ms.assigned_to IS NOT NULL');
    }
    if (req.user.adminLevel === 'super' && req.query.assigneeId) {
      conditions.push('ms.assigned_to = ?');
      params.push(Number(req.query.assigneeId));
    }
    if (req.user.adminLevel === 'super' && req.query.projectId) {
      conditions.push('ms.project_id = ?');
      params.push(Number(req.query.projectId));
    }
    if (req.user.adminLevel === 'super' && req.query.taskId) {
      conditions.push('ms.material_task_id = ?');
      params.push(Number(req.query.taskId));
    }
    if (req.query.keyword) {
      const keyword = `%${String(req.query.keyword).trim()}%`;
      conditions.push('(p.title LIKE ? OR p.project_code LIKE ? OR mt.task_name LIKE ? OR mc.category_name LIKE ? OR u.display_name LIKE ?)');
      params.push(keyword, keyword, keyword, keyword, keyword);
    }
    const where = conditions.join(' AND ');
    const [[countRow]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM material_submissions ms
       JOIN material_tasks mt ON mt.id = ms.material_task_id
       JOIN projects p ON p.id = ms.project_id
       JOIN material_categories mc ON mc.id = ms.material_category_id
       JOIN users u ON u.id = ms.submitter_user_id WHERE ${where}`,
      params
    );
    const [items] = await pool.execute(
      `SELECT ms.id, ms.material_task_id AS taskId, mt.task_name AS taskName,
              ms.project_id AS projectId, p.project_code AS projectCode, p.title AS projectTitle,
              mc.category_name AS categoryName, u.display_name AS submitter,
              ms.submission_status AS submissionStatus, ms.review_status AS reviewStatus,
              ms.return_reason AS returnReason, ms.submitted_at AS submittedAt,
              ms.assigned_to AS assignedTo, assignee.display_name AS assigneeName,
              ms.assigned_by AS assignedBy, assigner.display_name AS assignerName, ms.assigned_at AS assignedAt,
              ms.assignment_version AS assignmentVersion,
              ms.reviewed_by AS reviewedBy, reviewer.display_name AS reviewerName, ms.reviewed_at AS reviewedAt,
              COUNT(mf.id) AS fileCount, COALESCE(SUM(mf.file_size), 0) AS totalFileSize
       FROM material_submissions ms
       JOIN material_tasks mt ON mt.id = ms.material_task_id
       JOIN projects p ON p.id = ms.project_id
       JOIN material_categories mc ON mc.id = ms.material_category_id
       JOIN users u ON u.id = ms.submitter_user_id
       LEFT JOIN users assignee ON assignee.id = ms.assigned_to
       LEFT JOIN users assigner ON assigner.id = ms.assigned_by
       LEFT JOIN users reviewer ON reviewer.id = ms.reviewed_by
       LEFT JOIN material_files mf ON mf.submission_id = ms.id AND mf.deleted_at IS NULL
       WHERE ${where}
       GROUP BY ms.id ORDER BY ms.submitted_at DESC, ms.id DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    success(res, items.map((item) => ({ ...item, assignmentVersion: Number(item.assignmentVersion) })), 'ok', {
      pagination: { page, pageSize, total: Number(countRow.total), totalPages: Math.ceil(Number(countRow.total) / pageSize) }
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/review', requireAuth, requireRole('admin'), requireAdminPermission('material_review'), async (req, res, next) => {
  let connection;
  let transactionActive = false;
  try {
    const action = req.body.action;
    if (!['approve', 'return'].includes(action)) throw badRequest('审核结论无效', 'VALIDATION_ERROR');
    const reason = String(req.body.reason || '').trim();
    if (action === 'return' && !reason) throw badRequest('退回时必须填写原因', 'VALIDATION_ERROR');
    if (reason.length > 1000) throw badRequest('退回原因不能超过 1000 个字符', 'VALIDATION_ERROR');
    const expectedVersion = Number(req.body.assignmentVersion);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw badRequest('页面数据不完整，请刷新材料审核列表后重试', 'ASSIGNMENT_VERSION_REQUIRED');
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionActive = true;
    const [[submission]] = await connection.execute(
      `SELECT id, project_id AS projectId, review_status AS reviewStatus,
              assigned_to AS assignedTo, assignment_version AS assignmentVersion
       FROM material_submissions WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [req.params.id]
    );
    if (!submission) throw notFound('材料提交记录不存在');
    if (submission.reviewStatus !== 'pending') {
      throw conflict('该材料已被审核，请刷新列表查看最新结果', 'MATERIAL_REVIEW_ALREADY_COMPLETED');
    }
    if (Number(submission.assignmentVersion) !== expectedVersion) {
      throw conflict('该审核任务已被重新分配，请刷新列表后重试', 'MATERIAL_ASSIGNMENT_CONFLICT');
    }
    if (req.user.adminLevel !== 'super' && Number(submission.assignedTo || 0) !== Number(req.user.id)) {
      throw forbidden('该审核任务未分配给你，或已经被改派', 'MATERIAL_REVIEW_NOT_ASSIGNED');
    }

    const reviewStatus = action === 'approve' ? 'approved' : 'returned';
    const submissionStatus = action === 'approve' ? 'submitted' : 'returned';
    const [updated] = await connection.execute(
      `UPDATE material_submissions SET review_status = ?, submission_status = ?, return_reason = ?,
       reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = ? AND review_status = 'pending' AND assignment_version = ? AND deleted_at IS NULL`,
      [reviewStatus, submissionStatus, action === 'return' ? reason : null, req.user.id, req.params.id, expectedVersion]
    );
    if (updated.affectedRows !== 1) {
      throw conflict('该材料已被其他管理员审核或改派，请刷新列表后重试', 'MATERIAL_REVIEW_CONFLICT');
    }
    await connection.execute(
      `INSERT INTO material_review_audit_events
       (submission_id, project_id, event_type, actor_user_id, from_assignee_user_id,
        to_assignee_user_id, assignment_version, review_result, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [submission.id, submission.projectId, action === 'return' ? 'returned' : 'reviewed', req.user.id,
        submission.assignedTo, submission.assignedTo, expectedVersion, reviewStatus, action === 'return' ? reason : null]
    );
    await connection.commit();
    transactionActive = false;
    success(res, { reviewerId: req.user.id, reviewerName: req.user.displayName, reviewStatus }, action === 'approve' ? '材料审核已通过' : '材料已退回');
  } catch (error) {
    if (connection && transactionActive) await connection.rollback().catch(() => undefined);
    next(error);
  } finally {
    connection?.release();
  }
});

router.get('/:id/audit', requireAuth, requireRole('admin'), requireAdminPermission('material_review'), async (req, res, next) => {
  try {
    await ensureReviewSubmissionAccess(req.user, req.params.id);
    const [items] = await pool.execute(
      `SELECT audit.id, audit.event_type AS eventType, audit.assignment_version AS assignmentVersion,
              audit.review_result AS reviewResult, audit.reason, audit.created_at AS createdAt,
              actor.display_name AS actorName, previous.display_name AS fromAssigneeName,
              next_assignee.display_name AS toAssigneeName
       FROM material_review_audit_events audit
       JOIN users actor ON actor.id = audit.actor_user_id
       LEFT JOIN users previous ON previous.id = audit.from_assignee_user_id
       LEFT JOIN users next_assignee ON next_assignee.id = audit.to_assignee_user_id
       WHERE audit.submission_id = ? ORDER BY audit.id`,
      [req.params.id]
    );
    success(res, items.map((item) => ({ ...item, assignmentVersion: Number(item.assignmentVersion) })));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/files', requireAuth, requireRole('admin', 'project_owner'), requirePermissionWhenAdmin('material_review'), async (req, res, next) => {
  try {
    await ensureReviewSubmissionAccess(req.user, req.params.id);
    const [items] = await pool.execute(
      `SELECT mf.id, mf.original_name AS originalName, mf.file_size AS fileSize,
              mf.mime_type AS mimeType, mf.created_at AS createdAt
       FROM material_files mf JOIN material_submissions ms ON ms.id = mf.submission_id
       WHERE mf.submission_id = ? AND mf.deleted_at IS NULL AND ms.deleted_at IS NULL`,
      [req.params.id]
    );
    success(res, items.map(materialFileView));
  } catch (error) {
    next(error);
  }
});

router.get('/:submissionId/files/:fileId/preview', requireAuth, requireRole('admin', 'project_owner'), requirePermissionWhenAdmin('material_review'), async (req, res, next) => {
  try {
    await ensureReviewSubmissionAccess(req.user, req.params.submissionId);
    const { filePath, view } = await resolveSubmissionFile(req.params.submissionId, req.params.fileId);
    if (!view.previewable) {
      throw badRequest(view.previewMessage, 'FILE_PREVIEW_NOT_SUPPORTED');
    }
    const handle = await fs.promises.open(filePath, 'r');
    const signature = Buffer.alloc(8);
    try {
      const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
      if (!matchesPreviewSignature(signature.subarray(0, bytesRead), view.previewMimeType)) {
        throw badRequest('文件内容与声明类型不一致，已阻止网页预览，请下载后谨慎查看', 'FILE_PREVIEW_CONTENT_MISMATCH');
      }
    } finally {
      await handle.close();
    }
    setFileResponseHeaders(res, { disposition: 'inline', fileName: view.originalName, contentType: view.previewMimeType });
    fs.createReadStream(filePath).on('error', next).pipe(res);
  } catch (error) {
    next(error);
  }
});

router.get('/:submissionId/files/:fileId/download', requireAuth, requireRole('admin', 'project_owner'), requirePermissionWhenAdmin('material_review'), async (req, res, next) => {
  try {
    await ensureReviewSubmissionAccess(req.user, req.params.submissionId);
    const { filePath, view } = await resolveSubmissionFile(req.params.submissionId, req.params.fileId);
    setFileResponseHeaders(res, { fileName: view.originalName, contentType: 'application/octet-stream' });
    fs.createReadStream(filePath).on('error', next).pipe(res);
  } catch (error) {
    next(error);
  }
});

export default router;
