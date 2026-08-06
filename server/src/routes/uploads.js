import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { Router } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { success } from '../utils/response.js';

const router = Router();

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanExtension(fileName) {
  return path.extname(fileName).slice(1).toLowerCase();
}

function datedDir(...parts) {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return path.join(env.upload.root, year, month, ...parts);
}

function createUploader(category) {
  const storage = multer.diskStorage({
    destination(req, file, callback) {
      const dir = datedDir(category);
      ensureDir(dir);
      callback(null, dir);
    },
    filename(req, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase();
      callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
    }
  });

  return multer({
    storage,
    limits: { fileSize: env.upload.maxFileBytes },
    fileFilter(req, file, callback) {
      const extension = cleanExtension(file.originalname);
      if (!env.upload.allowedExtensions.includes(extension)) {
        callback(badRequest(`File type .${extension} is not allowed`, 'UPLOAD_TYPE_NOT_ALLOWED'));
        return;
      }
      callback(null, true);
    }
  });
}

async function removeUploadedFiles(files = []) {
  await Promise.all(
    files.map((file) => fs.promises.unlink(file.path).catch(() => undefined))
  );
}

const taskTemplateUploader = createUploader('task-templates');
const submissionUploader = createUploader('submissions');

router.post(
  '/task-templates',
  requireAuth,
  requireRole('admin'),
  taskTemplateUploader.array('files', 10),
  async (req, res, next) => {
    let connection;
    let transactionStarted = false;
    try {
      const taskId = Number(req.body.taskId);
      if (!taskId) {
        throw badRequest('taskId is required');
      }
      if (!req.files?.length) {
        throw badRequest('At least one file is required');
      }

      connection = await pool.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;

      const [[task]] = await connection.execute(
        'SELECT id FROM material_tasks WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [taskId]
      );
      if (!task) {
        throw notFound('Material task not found');
      }

      const savedFiles = [];
      for (const file of req.files || []) {
        const [result] = await connection.execute(
          `INSERT INTO task_template_attachments
           (material_task_id, original_name, storage_path, file_size, mime_type, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [taskId, file.originalname, file.path, file.size, file.mimetype, req.user.id]
        );
        savedFiles.push({
          id: result.insertId,
          originalName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype
        });
      }

      await connection.commit();
      transactionStarted = false;
      success(res, savedFiles, 'Uploaded');
    } catch (error) {
      if (connection && transactionStarted) {
        await connection.rollback();
      }
      await removeUploadedFiles(req.files);
      next(error);
    } finally {
      connection?.release();
    }
  }
);

router.post(
  '/submissions',
  requireAuth,
  requireRole('project_owner'),
  submissionUploader.array('files', 20),
  async (req, res, next) => {
    let connection;
    let transactionStarted = false;
    try {
      const taskId = Number(req.body.taskId);
      const projectId = Number(req.body.projectId);
      const categoryId = Number(req.body.categoryId);
      if (!taskId || !projectId || !categoryId) {
        throw badRequest('taskId, projectId and categoryId are required');
      }
      if (!req.files?.length) {
        throw badRequest('At least one file is required');
      }

      connection = await pool.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;

      const [[context]] = await connection.execute(
        `SELECT mt.id AS taskId, mt.status AS taskStatus, mt.project_scope_type AS scopeType,
                mt.project_year AS taskYear, mt.project_group AS taskGroup,
                mt.allowed_extensions AS allowedExtensions, mt.max_file_mb AS maxFileMb,
                mt.max_task_project_mb AS maxTaskProjectMb,
                p.project_year AS projectYear, p.project_group AS projectGroup,
                mc.id AS categoryId,
                EXISTS(
                  SELECT 1 FROM project_participations pp
                  WHERE pp.project_id = p.id AND pp.person_id = ? AND pp.role = 'owner' AND pp.deleted_at IS NULL
                ) AS ownsProject,
                EXISTS(
                  SELECT 1 FROM material_task_projects mtp
                  WHERE mtp.material_task_id = mt.id AND mtp.project_id = p.id
                ) AS customIncluded
         FROM material_tasks mt
         JOIN projects p ON p.id = ? AND p.deleted_at IS NULL
         LEFT JOIN material_categories mc ON mc.id = ? AND mc.material_task_id = mt.id AND mc.deleted_at IS NULL
         WHERE mt.id = ? AND mt.deleted_at IS NULL LIMIT 1`,
        [req.user.personId || 0, projectId, categoryId, taskId]
      );
      if (!context) throw notFound('Material task or project not found');
      if (!context.categoryId) throw notFound('Material category not found');
      if (!context.ownsProject) throw forbidden('You are not the owner of this project');
      if (context.taskStatus !== 'published') throw badRequest('Material task is not open for submission', 'VALIDATION_ERROR');
      const inScope = context.scopeType === 'all'
        || (context.scopeType === 'year' && Number(context.taskYear) === Number(context.projectYear))
        || (context.scopeType === 'group' && context.taskGroup === context.projectGroup)
        || (context.scopeType === 'custom' && Boolean(context.customIncluded));
      if (!inScope) throw forbidden('Project is not included in this material task');
      const allowedExtensions = Array.isArray(context.allowedExtensions)
        ? context.allowedExtensions
        : JSON.parse(context.allowedExtensions || '[]');
      for (const file of req.files || []) {
        const extension = cleanExtension(file.originalname);
        if (allowedExtensions.length && !allowedExtensions.includes(extension)) {
          throw badRequest(`File type .${extension} is not allowed for this task`, 'UPLOAD_TYPE_NOT_ALLOWED');
        }
        if (file.size > Number(context.maxFileMb) * 1024 * 1024) {
          throw badRequest('File size exceeds the task limit', 'UPLOAD_FILE_SIZE_EXCEEDED');
        }
      }

      const [[sumRow]] = await connection.execute(
        `SELECT COALESCE(SUM(mf.file_size), 0) AS totalSize
         FROM material_submissions ms
         JOIN material_files mf ON mf.submission_id = ms.id
         WHERE ms.material_task_id = ? AND ms.project_id = ?
           AND ms.deleted_at IS NULL AND mf.deleted_at IS NULL`,
        [taskId, projectId]
      );

      const newSize = (req.files || []).reduce((total, file) => total + file.size, 0);
      const maxTaskProjectBytes = Math.min(env.upload.maxTaskProjectBytes, Number(context.maxTaskProjectMb) * 1024 * 1024);
      if (Number(sumRow.totalSize) + newSize > maxTaskProjectBytes) {
        throw badRequest('Total upload size exceeds the task limit', 'UPLOAD_TOTAL_SIZE_EXCEEDED');
      }

      const [submissionResult] = await connection.execute(
        `INSERT INTO material_submissions
         (material_task_id, project_id, material_category_id, submitter_user_id, submission_status, review_status, submitted_at)
         VALUES (?, ?, ?, ?, 'submitted', 'pending', NOW())`,
        [taskId, projectId, categoryId, req.user.id]
      );

      const files = [];
      for (const file of req.files || []) {
        const [fileResult] = await connection.execute(
          `INSERT INTO material_files
           (submission_id, original_name, storage_path, file_size, mime_type, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [submissionResult.insertId, file.originalname, file.path, file.size, file.mimetype, req.user.id]
        );
        files.push({
          id: fileResult.insertId,
          originalName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype
        });
      }

      await connection.commit();
      transactionStarted = false;
      success(res, { submissionId: submissionResult.insertId, files }, 'Uploaded');
    } catch (error) {
      if (connection && transactionStarted) {
        await connection.rollback();
      }
      await removeUploadedFiles(req.files);
      next(error);
    } finally {
      connection?.release();
    }
  }
);

export default router;
