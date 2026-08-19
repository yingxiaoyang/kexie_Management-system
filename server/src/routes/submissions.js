import { Router } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ensureSubmissionAccess } from '../utils/accessControl.js';
import { resolveDownloadFile } from '../utils/safeFiles.js';
import { badRequest, notFound } from '../utils/errors.js';
import { paginationFrom } from '../utils/query.js';
import { success } from '../utils/response.js';
import { requireAdminPermission, requirePermissionWhenAdmin } from '../utils/adminPermissions.js';

const router = Router();

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
    }
    if (req.query.reviewStatus) {
      conditions.push('ms.review_status = ?');
      params.push(req.query.reviewStatus);
    }
    if (req.query.keyword) {
      const keyword = `%${String(req.query.keyword).trim()}%`;
      conditions.push('(p.title LIKE ? OR p.project_code LIKE ? OR mc.category_name LIKE ? OR u.display_name LIKE ?)');
      params.push(keyword, keyword, keyword, keyword);
    }
    const where = conditions.join(' AND ');
    const [[countRow]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM material_submissions ms
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
              ms.return_reason AS returnReason, ms.submitted_at AS submittedAt, ms.reviewed_at AS reviewedAt,
              COUNT(mf.id) AS fileCount, COALESCE(SUM(mf.file_size), 0) AS totalFileSize
       FROM material_submissions ms
       JOIN material_tasks mt ON mt.id = ms.material_task_id
       JOIN projects p ON p.id = ms.project_id
       JOIN material_categories mc ON mc.id = ms.material_category_id
       JOIN users u ON u.id = ms.submitter_user_id
       LEFT JOIN material_files mf ON mf.submission_id = ms.id AND mf.deleted_at IS NULL
       WHERE ${where}
       GROUP BY ms.id ORDER BY ms.submitted_at DESC, ms.id DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    success(res, items, 'ok', {
      pagination: { page, pageSize, total: Number(countRow.total), totalPages: Math.ceil(Number(countRow.total) / pageSize) }
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/review', requireAuth, requireRole('admin'), requireAdminPermission('material_review'), async (req, res, next) => {
  try {
    const action = req.body.action;
    if (!['approve', 'return'].includes(action)) throw badRequest('action is invalid', 'VALIDATION_ERROR');
    const reason = String(req.body.reason || '').trim();
    if (action === 'return' && !reason) throw badRequest('Return reason is required', 'VALIDATION_ERROR');
    const reviewStatus = action === 'approve' ? 'approved' : 'returned';
    const submissionStatus = action === 'approve' ? 'submitted' : 'returned';
    const [result] = await pool.execute(
      `UPDATE material_submissions SET review_status = ?, submission_status = ?, return_reason = ?,
       reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = ? AND deleted_at IS NULL`,
      [reviewStatus, submissionStatus, action === 'return' ? reason : null, req.user.id, req.params.id]
    );
    if (!result.affectedRows) throw notFound('Submission not found');
    success(res, null, action === 'approve' ? 'Submission approved' : 'Submission returned');
  } catch (error) {
    next(error);
  }
});

router.get('/:id/files', requireAuth, requireRole('admin', 'project_owner'), requirePermissionWhenAdmin('material_review'), async (req, res, next) => {
  try {
    await ensureSubmissionAccess(req.user, req.params.id);
    const [items] = await pool.execute(
      `SELECT mf.id, mf.original_name AS originalName, mf.file_size AS fileSize, mf.mime_type AS mimeType, mf.created_at AS createdAt
       FROM material_files mf JOIN material_submissions ms ON ms.id = mf.submission_id
       WHERE mf.submission_id = ? AND mf.deleted_at IS NULL AND ms.deleted_at IS NULL`,
      [req.params.id]
    );
    success(res, items);
  } catch (error) {
    next(error);
  }
});

router.get('/:submissionId/files/:fileId/download', requireAuth, requireRole('admin', 'project_owner'), requirePermissionWhenAdmin('material_review'), async (req, res, next) => {
  try {
    await ensureSubmissionAccess(req.user, req.params.submissionId);
    const [rows] = await pool.execute(
      `SELECT mf.original_name, mf.storage_path
       FROM material_files mf JOIN material_submissions ms ON ms.id = mf.submission_id
       WHERE mf.id = ? AND mf.submission_id = ? AND mf.deleted_at IS NULL AND ms.deleted_at IS NULL LIMIT 1`,
      [req.params.fileId, req.params.submissionId]
    );
    const file = rows[0];
    if (!file) throw notFound('File not found');
    const filePath = await resolveDownloadFile(env.upload.root, file.storage_path, {
      invalidMessage: 'Submission file path is outside the system upload directory',
      invalidCode: 'SUBMISSION_FILE_PATH_INVALID',
      missingMessage: 'Submission file not found'
    });
    res.download(filePath, file.original_name);
  } catch (error) {
    next(error);
  }
});

export default router;
