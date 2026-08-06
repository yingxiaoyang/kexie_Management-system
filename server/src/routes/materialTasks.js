import path from 'node:path';
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { enumValue, nullableText, paginationFrom, requiredText } from '../utils/query.js';
import { success } from '../utils/response.js';

const router = Router();
const taskStatuses = ['draft', 'published', 'closed'];
const scopeTypes = ['all', 'year', 'group', 'custom'];
const defaultExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'zip'];

function taskPayload(body) {
  const projectScopeType = enumValue(body.projectScopeType, scopeTypes, 'projectScopeType', 'all');
  const allowedExtensions = Array.isArray(body.allowedExtensions) && body.allowedExtensions.length
    ? [...new Set(body.allowedExtensions.map((item) => String(item).toLowerCase().replace(/^\./, '')))]
    : defaultExtensions;
  const rawFileTasks = Array.isArray(body.fileTasks) ? body.fileTasks : body.categories;
  const fileTasks = Array.isArray(rawFileTasks)
    ? rawFileTasks.map((item, index) => ({
      categoryName: requiredText(typeof item === 'string' ? item : item.categoryName, 'categoryName', 120),
      taskDescription: typeof item === 'string' ? null : nullableText(item.taskDescription, 1000),
      isRequired: typeof item === 'string' ? true : item.isRequired !== false,
      sortOrder: Number(typeof item === 'string' ? index : item.sortOrder ?? index)
    }))
    : [];
  if (!fileTasks.length) throw badRequest('At least one file task is required', 'VALIDATION_ERROR');
  const maxFileMb = Number(body.maxFileMb || 50);
  const maxTaskProjectMb = Number(body.maxTaskProjectMb || 500);
  if (!Number.isInteger(maxFileMb) || maxFileMb < 1 || maxFileMb > 50) {
    throw badRequest('maxFileMb must be between 1 and 50', 'VALIDATION_ERROR');
  }
  if (!Number.isInteger(maxTaskProjectMb) || maxTaskProjectMb < maxFileMb || maxTaskProjectMb > 500) {
    throw badRequest('maxTaskProjectMb is invalid', 'VALIDATION_ERROR');
  }
  return {
    taskName: requiredText(body.taskName, 'taskName', 160),
    taskDescription: nullableText(body.taskDescription, 1000),
    projectScopeType,
    projectYear: projectScopeType === 'year' ? Number(body.projectYear) : null,
    projectGroup: projectScopeType === 'group' ? requiredText(body.projectGroup, 'projectGroup', 80) : null,
    projectIds: projectScopeType === 'custom' ? [...new Set((body.projectIds || []).map(Number).filter(Boolean))] : [],
    deadlineAt: body.deadlineAt || null,
    allowedExtensions,
    maxFileMb,
    maxTaskProjectMb,
    hasTemplate: Boolean(body.hasTemplate),
    status: enumValue(body.status, taskStatuses, 'status', 'draft'),
    fileTasks
  };
}

async function attachFileTasks(items) {
  const taskIds = items.map((item) => Number(item.id)).filter(Boolean);
  if (!taskIds.length) return items;
  const [rows] = await pool.execute(
    `SELECT id, material_task_id AS materialTaskId, category_name AS categoryName,
            task_description AS taskDescription, is_required AS isRequired, sort_order AS sortOrder
     FROM material_categories
     WHERE deleted_at IS NULL AND material_task_id IN (${taskIds.map(() => '?').join(',')})
     ORDER BY material_task_id, sort_order, id`,
    taskIds
  );
  const grouped = new Map();
  for (const row of rows) {
    const taskId = Number(row.materialTaskId);
    if (!grouped.has(taskId)) grouped.set(taskId, []);
    grouped.get(taskId).push({ ...row, isRequired: Boolean(row.isRequired) });
  }
  return items.map((item) => ({ ...item, fileTasks: grouped.get(Number(item.id)) || [] }));
}

function scopeLabel(row) {
  if (row.projectScopeType === 'year') return `${row.projectYear} 年项目`;
  if (row.projectScopeType === 'group') return `${row.projectGroup || ''}项目`;
  if (row.projectScopeType === 'custom') return '指定项目';
  return '全部项目';
}

router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { page, pageSize, offset } = paginationFrom(req.query);
    const conditions = ['mt.deleted_at IS NULL'];
    const params = [];
    if (req.query.status) {
      conditions.push('mt.status = ?');
      params.push(req.query.status);
    }
    if (req.query.keyword) {
      conditions.push('mt.task_name LIKE ?');
      params.push(`%${String(req.query.keyword).trim()}%`);
    }
    const where = conditions.join(' AND ');
    const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM material_tasks mt WHERE ${where}`, params);
    const [rows] = await pool.execute(
      `SELECT mt.id, mt.task_name AS taskName, mt.task_description AS taskDescription,
              mt.project_scope_type AS projectScopeType, mt.project_year AS projectYear,
              mt.project_group AS projectGroup, mt.deadline_at AS deadlineAt,
              mt.allowed_extensions AS allowedExtensions, mt.max_file_mb AS maxFileMb,
              mt.max_task_project_mb AS maxTaskProjectMb, mt.has_template AS hasTemplate,
              mt.status, mt.created_at AS createdAt,
              GROUP_CONCAT(DISTINCT mc.category_name ORDER BY mc.sort_order SEPARATOR '、') AS categoryNames,
              COUNT(DISTINCT tta.id) AS templateCount,
              COUNT(DISTINCT CASE WHEN ms.review_status = 'pending' THEN ms.id END) AS pendingCount
       FROM material_tasks mt
       LEFT JOIN material_categories mc ON mc.material_task_id = mt.id AND mc.deleted_at IS NULL
       LEFT JOIN task_template_attachments tta ON tta.material_task_id = mt.id AND tta.deleted_at IS NULL
       LEFT JOIN material_submissions ms ON ms.material_task_id = mt.id AND ms.deleted_at IS NULL
       WHERE ${where}
       GROUP BY mt.id ORDER BY mt.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    const items = await attachFileTasks(rows.map((row) => ({ ...row, scopeLabel: scopeLabel(row), hasTemplate: Boolean(row.hasTemplate) })));
    success(res, items, 'ok', {
      pagination: { page, pageSize, total: Number(countRow.total), totalPages: Math.ceil(Number(countRow.total) / pageSize) }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/my', requireAuth, requireRole('project_owner'), async (req, res, next) => {
  try {
    const personId = req.user.personId || 0;
    const [rows] = await pool.execute(
      `SELECT mt.id AS taskId, mt.task_name AS taskName, mt.task_description AS taskDescription,
              mt.deadline_at AS deadlineAt, mt.allowed_extensions AS allowedExtensions,
              mt.max_file_mb AS maxFileMb, mt.max_task_project_mb AS maxTaskProjectMb,
              mt.has_template AS hasTemplate, mt.status AS taskStatus,
              p.id AS projectId, p.project_code AS projectCode, p.title AS projectTitle,
              mc.id AS categoryId, mc.category_name AS categoryName,
              mc.task_description AS fileTaskDescription, mc.is_required AS isRequired,
              ms.id AS submissionId, ms.submission_status AS submissionStatus,
              ms.review_status AS reviewStatus, ms.return_reason AS returnReason,
              ms.submitted_at AS submittedAt,
              (SELECT COUNT(*) FROM task_template_attachments tta WHERE tta.material_task_id = mt.id AND tta.deleted_at IS NULL) AS templateCount
       FROM project_participations owner_rel
       JOIN projects p ON p.id = owner_rel.project_id AND p.deleted_at IS NULL
       JOIN material_tasks mt ON mt.deleted_at IS NULL AND mt.status IN ('published', 'closed')
         AND (
           mt.project_scope_type = 'all'
           OR (mt.project_scope_type = 'year' AND mt.project_year = p.project_year)
           OR (mt.project_scope_type = 'group' AND mt.project_group = p.project_group)
           OR (mt.project_scope_type = 'custom' AND EXISTS (
             SELECT 1 FROM material_task_projects mtp WHERE mtp.material_task_id = mt.id AND mtp.project_id = p.id
           ))
         )
       JOIN material_categories mc ON mc.material_task_id = mt.id AND mc.deleted_at IS NULL
       LEFT JOIN material_submissions ms ON ms.id = (
         SELECT latest.id FROM material_submissions latest
         WHERE latest.material_task_id = mt.id AND latest.project_id = p.id
           AND latest.material_category_id = mc.id AND latest.deleted_at IS NULL
         ORDER BY latest.id DESC LIMIT 1
       )
       WHERE owner_rel.person_id = ? AND owner_rel.role = 'owner' AND owner_rel.deleted_at IS NULL
       ORDER BY mt.deadline_at IS NULL, mt.deadline_at, p.project_code, mc.sort_order`,
      [personId]
    );
    success(res, rows.map((row) => ({ ...row, hasTemplate: Boolean(row.hasTemplate), isRequired: Boolean(row.isRequired) })));
  } catch (error) {
    next(error);
  }
});

router.post('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  let connection;
  try {
    const data = taskPayload(req.body);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO material_tasks
       (task_name, task_description, project_scope_type, project_year, project_group, deadline_at,
        allowed_extensions, max_file_mb, max_task_project_mb, has_template, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.taskName, data.taskDescription, data.projectScopeType, data.projectYear, data.projectGroup, data.deadlineAt,
        JSON.stringify(data.allowedExtensions), data.maxFileMb, data.maxTaskProjectMb, data.hasTemplate ? 1 : 0, data.status, req.user.id]
    );
    for (const category of data.fileTasks) {
      await connection.execute(
        `INSERT INTO material_categories (material_task_id, category_name, task_description, is_required, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [result.insertId, category.categoryName, category.taskDescription, category.isRequired ? 1 : 0, category.sortOrder]
      );
    }
    for (const projectId of data.projectIds) {
      await connection.execute('INSERT INTO material_task_projects (material_task_id, project_id) VALUES (?, ?)', [result.insertId, projectId]);
    }
    await connection.commit();
    success(res, { id: result.insertId }, 'Material task created');
  } catch (error) {
    await connection?.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.put('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  let connection;
  try {
    const data = taskPayload(req.body);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[task]] = await connection.execute(
      `SELECT id, status FROM material_tasks WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
      [req.params.id]
    );
    if (!task) throw notFound('Material task not found');
    if (task.status !== 'draft') throw badRequest('Only draft tasks can be edited', 'VALIDATION_ERROR');
    const [[submission]] = await connection.execute(
      'SELECT id FROM material_submissions WHERE material_task_id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id]
    );
    if (submission) throw badRequest('Task with submissions cannot be edited', 'VALIDATION_ERROR');
    await connection.execute(
      `UPDATE material_tasks SET task_name=?, task_description=?, project_scope_type=?, project_year=?, project_group=?,
       deadline_at=?, allowed_extensions=?, max_file_mb=?, max_task_project_mb=?, has_template=?, status=?, updated_at=NOW()
       WHERE id=?`,
      [data.taskName, data.taskDescription, data.projectScopeType, data.projectYear, data.projectGroup,
        data.deadlineAt, JSON.stringify(data.allowedExtensions), data.maxFileMb, data.maxTaskProjectMb,
        data.hasTemplate ? 1 : 0, data.status, req.params.id]
    );
    await connection.execute('DELETE FROM material_categories WHERE material_task_id = ?', [req.params.id]);
    await connection.execute('DELETE FROM material_task_projects WHERE material_task_id = ?', [req.params.id]);
    for (const category of data.fileTasks) {
      await connection.execute(
        `INSERT INTO material_categories
         (material_task_id, category_name, task_description, is_required, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [req.params.id, category.categoryName, category.taskDescription, category.isRequired ? 1 : 0, category.sortOrder]
      );
    }
    for (const projectId of data.projectIds) {
      await connection.execute('INSERT INTO material_task_projects (material_task_id, project_id) VALUES (?, ?)', [req.params.id, projectId]);
    }
    await connection.commit();
    success(res, null, 'Material task updated');
  } catch (error) {
    await connection?.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.patch('/:id/status', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const status = enumValue(req.body.status, taskStatuses, 'status');
    const [result] = await pool.execute(
      'UPDATE material_tasks SET status = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [status, req.params.id]
    );
    if (!result.affectedRows) throw notFound('Material task not found');
    success(res, null, 'Task status updated');
  } catch (error) {
    next(error);
  }
});

router.get('/:taskId/templates', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, material_task_id AS taskId, original_name AS originalName,
              file_size AS fileSize, mime_type AS mimeType, created_at AS createdAt
       FROM task_template_attachments
       WHERE material_task_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
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
      `SELECT original_name, storage_path FROM task_template_attachments
       WHERE id = ? AND material_task_id = ? AND deleted_at IS NULL LIMIT 1`,
      [req.params.attachmentId, req.params.taskId]
    );
    const attachment = rows[0];
    if (!attachment) throw notFound('Template attachment not found');
    res.download(path.resolve(attachment.storage_path), attachment.original_name);
  } catch (error) {
    next(error);
  }
});

export default router;
