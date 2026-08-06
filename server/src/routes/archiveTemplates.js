import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { archivePlacements, archivePreview, normalizeArchiveTemplateConfig } from '../utils/archive.js';
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

async function validateTaskReferences(templateConfig) {
  if (templateConfig.version !== 2) return;
  const placements = archivePlacements(templateConfig);
  const fileTaskIds = placements.map((item) => item.fileTaskId);
  const [rows] = await pool.execute(
    `SELECT mc.id, mc.material_task_id AS materialTaskId
     FROM material_categories mc
     JOIN material_tasks mt ON mt.id = mc.material_task_id AND mt.deleted_at IS NULL
     WHERE mc.deleted_at IS NULL AND mc.id IN (${fileTaskIds.map(() => '?').join(',')})`,
    fileTaskIds
  );
  const actual = new Map(rows.map((row) => [Number(row.id), Number(row.materialTaskId)]));
  if (placements.some((item) => actual.get(item.fileTaskId) !== item.materialTaskId)) {
    throw badRequest('Archive template contains an invalid material task or file task reference', 'VALIDATION_ERROR');
  }
}

router.use(requireAuth, requireRole('admin'));

router.get('/task-library', async (_req, res, next) => {
  try {
    const [tasks] = await pool.execute(
      `SELECT mt.id, mt.task_name AS taskName, mt.task_description AS taskDescription,
              mt.status, mc.id AS fileTaskId, mc.category_name AS fileTaskName,
              mc.task_description AS fileTaskDescription, mc.is_required AS isRequired,
              mc.sort_order AS sortOrder
       FROM material_tasks mt
       JOIN material_categories mc ON mc.material_task_id = mt.id AND mc.deleted_at IS NULL
       WHERE mt.deleted_at IS NULL
       ORDER BY mt.created_at DESC, mt.id DESC, mc.sort_order, mc.id`
    );
    const grouped = new Map();
    for (const row of tasks) {
      if (!grouped.has(Number(row.id))) grouped.set(Number(row.id), {
        id: Number(row.id), taskName: row.taskName, taskDescription: row.taskDescription,
        status: row.status, fileTasks: []
      });
      grouped.get(Number(row.id)).fileTasks.push({
        id: Number(row.fileTaskId), fileTaskId: Number(row.fileTaskId),
        fileTaskName: row.fileTaskName, taskDescription: row.fileTaskDescription,
        isRequired: Boolean(row.isRequired), sortOrder: Number(row.sortOrder)
      });
    }
    success(res, [...grouped.values()]);
  } catch (error) {
    next(error);
  }
});

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
    await validateTaskReferences(templateConfig);
    success(res, archivePreview(templateConfig));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = templatePayload(req.body);
    await validateTaskReferences(data.templateConfig);
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
    await validateTaskReferences(data.templateConfig);
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
