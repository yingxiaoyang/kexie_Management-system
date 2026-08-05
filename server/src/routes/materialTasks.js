import path from 'node:path';
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { notFound } from '../utils/errors.js';
import { success } from '../utils/response.js';

const router = Router();

router.get('/:taskId/templates', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, material_task_id AS taskId, original_name AS originalName,
              file_size AS fileSize, mime_type AS mimeType, created_at AS createdAt
       FROM task_template_attachments
       WHERE material_task_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [req.params.taskId]
    );
    success(res, rows);
  } catch (error) {
    next(error);
  }
});

router.get('/:taskId/templates/:attachmentId/download', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT original_name, storage_path
       FROM task_template_attachments
       WHERE id = ? AND material_task_id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [req.params.attachmentId, req.params.taskId]
    );

    const attachment = rows[0];
    if (!attachment) {
      throw notFound('Template attachment not found');
    }

    res.download(path.resolve(attachment.storage_path), attachment.original_name);
  } catch (error) {
    next(error);
  }
});

export default router;
