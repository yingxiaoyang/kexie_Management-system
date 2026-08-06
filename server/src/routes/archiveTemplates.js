import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { archivePreview, normalizeArchiveTemplateConfig } from '../utils/archive.js';
import { badRequest, notFound } from '../utils/errors.js';
import { paginationFrom, requiredText } from '../utils/query.js';
import { success } from '../utils/response.js';

const router = Router();
const statuses = ['enabled', 'disabled'];

function templatePayload(body) {
  const status = body.status || 'enabled';
  if (!statuses.includes(status)) throw badRequest('status is invalid', 'VALIDATION_ERROR');
  return {
    templateName: requiredText(body.templateName, 'templateName', 160),
    templateConfig: normalizeArchiveTemplateConfig(body.templateConfig),
    status
  };
}

function mapTemplate(row) {
  return {
    ...row,
    templateConfig: normalizeArchiveTemplateConfig(row.templateConfig)
  };
}

router.use(requireAuth, requireRole('admin'));

router.get('/', async (req, res, next) => {
  try {
    const { page, pageSize, offset } = paginationFrom(req.query);
    const conditions = ['at.deleted_at IS NULL'];
    const params = [];
    if (req.query.status) {
      if (!statuses.includes(req.query.status)) throw badRequest('status is invalid', 'VALIDATION_ERROR');
      conditions.push('at.status = ?');
      params.push(req.query.status);
    }
    if (req.query.keyword) {
      conditions.push('at.template_name LIKE ?');
      params.push(`%${String(req.query.keyword).trim()}%`);
    }
    const where = conditions.join(' AND ');
    const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM archive_templates at WHERE ${where}`, params);
    const [rows] = await pool.execute(
      `SELECT at.id, at.template_name AS templateName, at.template_config AS templateConfig,
              at.status, at.created_at AS createdAt, at.updated_at AS updatedAt,
              u.display_name AS createdBy
       FROM archive_templates at
       JOIN users u ON u.id = at.created_by
       WHERE ${where}
       ORDER BY at.updated_at DESC, at.id DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    success(res, rows.map(mapTemplate), 'ok', {
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
    const templateConfig = normalizeArchiveTemplateConfig(req.body.templateConfig);
    success(res, archivePreview(templateConfig));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = templatePayload(req.body);
    const [result] = await pool.execute(
      `INSERT INTO archive_templates (template_name, template_config, status, created_by)
       VALUES (?, ?, ?, ?)`,
      [data.templateName, JSON.stringify(data.templateConfig), data.status, req.user.id]
    );
    success(res, { id: result.insertId, preview: archivePreview(data.templateConfig) }, 'Archive template created');
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = templatePayload(req.body);
    const [result] = await pool.execute(
      `UPDATE archive_templates
       SET template_name = ?, template_config = ?, status = ?, updated_at = NOW()
       WHERE id = ? AND deleted_at IS NULL`,
      [data.templateName, JSON.stringify(data.templateConfig), data.status, req.params.id]
    );
    if (!result.affectedRows) throw notFound('Archive template not found');
    success(res, { preview: archivePreview(data.templateConfig) }, 'Archive template updated');
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const status = req.body.status;
    if (!statuses.includes(status)) throw badRequest('status is invalid', 'VALIDATION_ERROR');
    const [result] = await pool.execute(
      'UPDATE archive_templates SET status = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [status, req.params.id]
    );
    if (!result.affectedRows) throw notFound('Archive template not found');
    success(res, null, status === 'enabled' ? 'Archive template enabled' : 'Archive template disabled');
  } catch (error) {
    next(error);
  }
});

export default router;
