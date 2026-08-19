import fs from 'node:fs';
import { Router } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireAdminPermission, requirePermissionWhenAdmin } from '../utils/adminPermissions.js';
import { archivePlacements, normalizeArchiveTemplateConfig } from '../utils/archive.js';
import { ensureMaterialTaskAccess } from '../utils/accessControl.js';
import { resolveDownloadFile } from '../utils/safeFiles.js';
import { badRequest, notFound } from '../utils/errors.js';
import { enumValue, nullableText, paginationFrom, requiredText } from '../utils/query.js';
import { success } from '../utils/response.js';
import { inspectOriginalFileName, setFileResponseHeaders } from '../utils/fileNames.js';
import { normalizeChangeScope } from '../utils/projectChange.js';
import { scanOverdueRequiredMaterials } from '../services/participationEligibilityService.js';

const router = Router();
const taskStatuses = ['draft', 'published', 'closed'];
const scopeTypes = ['all', 'year', 'group', 'custom'];
const defaultExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'zip'];

function optionalPositiveInteger(value, fieldName) {
  if (value == null || value === '') return null;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1) {
    throw badRequest(`${fieldName} is invalid`, 'VALIDATION_ERROR');
  }
  return numberValue;
}

function normalizedExtensions(value, fallback = defaultExtensions) {
  const source = Array.isArray(value) && value.length ? value : fallback;
  return [...new Set(source.map((item) => String(item).toLowerCase().replace(/^\./, '')).filter(Boolean))];
}

function taskPayload(body) {
  const taskType = enumValue(body.taskType, ['standard', 'project_change'], 'taskType', 'standard');
  const changePhase = taskType === 'project_change' ? enumValue(body.changePhase, ['midterm', 'stage'], 'changePhase') : null;
  const changeScope = taskType === 'project_change' ? normalizeChangeScope(body.changeScope) : null;
  if (taskType === 'project_change' && !Object.values(changeScope).some(Boolean)) {
    throw badRequest('项目信息变更任务必须至少允许一类变更', 'PROJECT_CHANGE_SCOPE_REQUIRED');
  }
  const projectScopeType = enumValue(body.projectScopeType, scopeTypes, 'projectScopeType', 'all');
  const parentExtensions = normalizedExtensions(body.allowedExtensions);
  const parentMaxFileMb = Number(body.maxFileMb || 50);
  const rawFileTasks = Array.isArray(body.fileTasks) ? body.fileTasks : body.categories;
  const fileTasks = Array.isArray(rawFileTasks)
    ? rawFileTasks.map((item, index) => {
      const maxFileMb = Number(typeof item === 'string' ? parentMaxFileMb : item.maxFileMb || parentMaxFileMb);
      if (!Number.isInteger(maxFileMb) || maxFileMb < 1 || maxFileMb > 50) {
        throw badRequest(`fileTasks[${index}].maxFileMb must be between 1 and 50`, 'VALIDATION_ERROR');
      }
      return {
        id: typeof item === 'string' || !item.id ? null : Number(item.id),
        categoryName: requiredText(typeof item === 'string' ? item : item.categoryName, 'categoryName', 120),
        taskDescription: typeof item === 'string' ? null : nullableText(item.taskDescription, 1000),
        allowedExtensions: normalizedExtensions(typeof item === 'string' ? parentExtensions : item.allowedExtensions, parentExtensions),
        maxFileMb,
        hasTemplate: typeof item === 'string' ? false : Boolean(item.hasTemplate),
        isRequired: typeof item === 'string' ? true : item.isRequired !== false,
        sortOrder: Number(typeof item === 'string' ? index : item.sortOrder ?? index)
      };
    })
    : [];
  if (!fileTasks.length) throw badRequest('At least one file task is required', 'VALIDATION_ERROR');
  if (fileTasks.some((item) => item.id != null && (!Number.isInteger(item.id) || item.id < 1))) {
    throw badRequest('fileTasks contains an invalid id', 'VALIDATION_ERROR');
  }
  const names = fileTasks.map((item) => item.categoryName);
  if (new Set(names).size !== names.length) throw badRequest('File task names must be unique within one material task', 'VALIDATION_ERROR');
  const maxFileMb = Math.max(parentMaxFileMb, ...fileTasks.map((item) => item.maxFileMb));
  const maxTaskProjectMb = Number(body.maxTaskProjectMb || 500);
  if (!Number.isInteger(maxTaskProjectMb) || maxTaskProjectMb < maxFileMb || maxTaskProjectMb > 500) {
    throw badRequest('maxTaskProjectMb is invalid', 'VALIDATION_ERROR');
  }
  const projectYear = projectScopeType === 'year' ? Number(body.projectYear) : null;
  if (projectScopeType === 'year' && (!Number.isInteger(projectYear) || projectYear < 2000 || projectYear > 2100)) {
    throw badRequest('projectYear is invalid', 'VALIDATION_ERROR');
  }
  const projectIds = projectScopeType === 'custom' ? [...new Set((body.projectIds || []).map(Number).filter(Number.isInteger))] : [];
  if (projectScopeType === 'custom' && !projectIds.length) throw badRequest('At least one project is required for custom scope', 'VALIDATION_ERROR');
  return {
    taskType,
    changePhase,
    changeScope,
    taskName: requiredText(body.taskName, 'taskName', 160),
    taskDescription: nullableText(body.taskDescription, 1000),
    projectScopeType,
    projectYear,
    projectGroup: projectScopeType === 'group' ? requiredText(body.projectGroup, 'projectGroup', 80) : null,
    projectIds,
    deadlineAt: body.deadlineAt || null,
    allowedExtensions: normalizedExtensions(fileTasks.flatMap((item) => item.allowedExtensions)),
    maxFileMb,
    maxTaskProjectMb,
    hasTemplate: fileTasks.some((item) => item.hasTemplate) || Boolean(body.hasTemplate),
    status: enumValue(body.status, taskStatuses, 'status', 'draft'),
    fileTasks
  };
}

async function attachTaskDetails(items) {
  const taskIds = items.map((item) => Number(item.id)).filter(Boolean);
  if (!taskIds.length) return items;
  const placeholders = taskIds.map(() => '?').join(',');
  const [[fileTaskRows], [projectRows], [templateRows]] = await Promise.all([
    pool.execute(
      `SELECT mc.id, mc.material_task_id AS materialTaskId, mc.category_name AS categoryName,
              mc.task_description AS taskDescription, mc.allowed_extensions AS allowedExtensions,
              mc.max_file_mb AS maxFileMb, mc.has_template AS hasTemplate,
              mc.is_required AS isRequired, mc.sort_order AS sortOrder,
              CASE WHEN mc.has_template = 1 THEN (
                SELECT COUNT(*) FROM task_template_attachments tta
                WHERE tta.material_task_id = mc.material_task_id AND tta.deleted_at IS NULL
                  AND (tta.material_category_id = mc.id OR tta.material_category_id IS NULL)
              ) ELSE 0 END AS templateCount
       FROM material_categories mc
       WHERE mc.deleted_at IS NULL AND mc.material_task_id IN (${placeholders})
       ORDER BY mc.material_task_id, mc.sort_order, mc.id`,
      taskIds
    ),
    pool.execute(
      `SELECT material_task_id AS materialTaskId, project_id AS projectId
       FROM material_task_projects WHERE material_task_id IN (${placeholders})
       ORDER BY material_task_id, project_id`,
      taskIds
    ),
    pool.execute(
      `SELECT id, material_task_id AS materialTaskId, material_category_id AS categoryId,
              original_name AS originalName, file_size AS fileSize, created_at AS createdAt
       FROM task_template_attachments
       WHERE deleted_at IS NULL AND material_task_id IN (${placeholders})
       ORDER BY created_at DESC, id DESC`,
      taskIds
    )
  ]);
  const templatesByTask = new Map();
  for (const row of templateRows) {
    const taskId = Number(row.materialTaskId);
    const fileName = inspectOriginalFileName(row.originalName);
    if (!templatesByTask.has(taskId)) templatesByTask.set(taskId, []);
    templatesByTask.get(taskId).push({
      ...row,
      originalName: fileName.displayName,
      storedOriginalName: fileName.originalName,
      fileNameRecovered: fileName.recovered,
      fileNameWarning: fileName.warning,
      id: Number(row.id),
      categoryId: row.categoryId == null ? null : Number(row.categoryId),
      fileSize: Number(row.fileSize || 0)
    });
  }
  const fileTasksByTask = new Map();
  for (const row of fileTaskRows) {
    const taskId = Number(row.materialTaskId);
    const templateFiles = (templatesByTask.get(taskId) || [])
      .filter((file) => file.categoryId == null || file.categoryId === Number(row.id));
    if (!fileTasksByTask.has(taskId)) fileTasksByTask.set(taskId, []);
    fileTasksByTask.get(taskId).push({
      ...row,
      id: Number(row.id),
      allowedExtensions: Array.isArray(row.allowedExtensions) ? row.allowedExtensions : JSON.parse(row.allowedExtensions || '[]'),
      hasTemplate: Boolean(row.hasTemplate),
      isRequired: Boolean(row.isRequired),
      maxFileMb: Number(row.maxFileMb || 50),
      templateCount: Number(row.templateCount || 0),
      templateFiles
    });
  }
  const projectsByTask = new Map();
  for (const row of projectRows) {
    const taskId = Number(row.materialTaskId);
    if (!projectsByTask.has(taskId)) projectsByTask.set(taskId, []);
    projectsByTask.get(taskId).push(Number(row.projectId));
  }
  return items.map((item) => {
    const projectIds = projectsByTask.get(Number(item.id)) || [];
    const enriched = { ...item, projectIds, fileTasks: fileTasksByTask.get(Number(item.id)) || [] };
    return { ...enriched, scopeLabel: scopeLabel(enriched) };
  });
}

function scopeLabel(row) {
  if (row.projectScopeType === 'year') return `${row.projectYear} 年项目`;
  if (row.projectScopeType === 'group') return `组别：${row.projectGroup || '未设置'}`;
  if (row.projectScopeType === 'custom') return `指定 ${row.projectIds?.length || 0} 个项目`;
  return '全部项目';
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function ensureRemovedFileTasksAreUnused(fileTaskIds) {
  if (!fileTaskIds.length) return;
  const [templates] = await pool.execute('SELECT template_name AS templateName, template_config AS templateConfig FROM archive_templates WHERE deleted_at IS NULL');
  for (const template of templates) {
    const config = normalizeArchiveTemplateConfig(parseJson(template.templateConfig));
    if (config.version === 2 && archivePlacements(config).some((item) => fileTaskIds.includes(item.fileTaskId))) {
      throw badRequest(`请先从归档模板“${template.templateName}”中移除要删除的子文件任务`, 'FILE_TASK_IN_ARCHIVE_TEMPLATE');
    }
  }
}

router.get('/options', requireAuth, requireRole('admin'), requireAdminPermission('material_task'), async (_req, res, next) => {
  try {
    const [[years], [groups], [projects]] = await Promise.all([
      pool.execute('SELECT DISTINCT project_year AS value FROM projects WHERE deleted_at IS NULL ORDER BY project_year DESC'),
      pool.execute("SELECT DISTINCT project_group AS value FROM projects WHERE deleted_at IS NULL AND project_group IS NOT NULL AND project_group <> '' ORDER BY project_group"),
      pool.execute('SELECT id, project_year AS projectYear, project_group AS projectGroup, project_code AS projectCode, title FROM projects WHERE deleted_at IS NULL ORDER BY project_year DESC, project_code')
    ]);
    success(res, { years: years.map((item) => Number(item.value)), groups: groups.map((item) => item.value), projects });
  } catch (error) {
    next(error);
  }
});

router.get('/', requireAuth, requireRole('admin'), requireAdminPermission('material_task'), async (req, res, next) => {
  try {
    const { page, pageSize, offset } = paginationFrom(req.query);
    const conditions = ['mt.deleted_at IS NULL'];
    const params = [];
    if (req.query.status) { conditions.push('mt.status = ?'); params.push(req.query.status); }
    if (req.query.keyword) { conditions.push('mt.task_name LIKE ?'); params.push(`%${String(req.query.keyword).trim()}%`); }
    const where = conditions.join(' AND ');
    const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM material_tasks mt WHERE ${where}`, params);
    const [rows] = await pool.execute(
      `SELECT mt.id, mt.task_name AS taskName, mt.task_description AS taskDescription,
              mt.project_scope_type AS projectScopeType, mt.project_year AS projectYear,
              mt.project_group AS projectGroup, mt.deadline_at AS deadlineAt,
              mt.allowed_extensions AS allowedExtensions, mt.max_file_mb AS maxFileMb,
              mt.max_task_project_mb AS maxTaskProjectMb, mt.has_template AS hasTemplate,
              mt.task_type AS taskType, mt.change_phase AS changePhase, mt.change_scope AS changeScope,
              mt.status, mt.created_at AS createdAt,
              GROUP_CONCAT(DISTINCT mc.category_name ORDER BY mc.sort_order SEPARATOR '、') AS categoryNames,
              COUNT(DISTINCT tta.id) AS templateCount,
              COUNT(DISTINCT ms.id) AS submissionCount,
              COUNT(DISTINCT CASE WHEN ms.review_status = 'pending' THEN ms.id END) AS pendingCount
       FROM material_tasks mt
       LEFT JOIN material_categories mc ON mc.material_task_id = mt.id AND mc.deleted_at IS NULL
       LEFT JOIN task_template_attachments tta ON tta.material_task_id = mt.id AND tta.deleted_at IS NULL
       LEFT JOIN material_submissions ms ON ms.material_task_id = mt.id AND ms.deleted_at IS NULL
       WHERE ${where}
       GROUP BY mt.id ORDER BY mt.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    const baseItems = rows.map((row) => ({
      ...row,
      changeScope: parseJson(row.changeScope, null),
      hasTemplate: Boolean(row.hasTemplate),
      submissionCount: Number(row.submissionCount || 0),
      pendingCount: Number(row.pendingCount || 0),
      editable: row.status !== 'closed' && Number(row.submissionCount || 0) === 0
    }));
    const items = await attachTaskDetails(baseItems);
    success(res, items, 'ok', { pagination: { page, pageSize, total: Number(countRow.total), totalPages: Math.ceil(Number(countRow.total) / pageSize) } });
  } catch (error) {
    next(error);
  }
});

router.get('/my', requireAuth, requireRole('project_owner'), async (req, res, next) => {
  try {
    const personId = req.user.personId || 0;
    const [rows] = await pool.execute(
      `SELECT mt.id AS taskId, mt.task_name AS taskName, mt.task_description AS taskDescription,
              mt.deadline_at AS deadlineAt, mt.task_type AS taskType, mt.change_phase AS changePhase, mt.change_scope AS changeScope,
              COALESCE(mc.allowed_extensions, mt.allowed_extensions) AS allowedExtensions,
              COALESCE(mc.max_file_mb, mt.max_file_mb) AS maxFileMb,
              mt.max_task_project_mb AS maxTaskProjectMb,
              mc.has_template AS hasTemplate, mt.status AS taskStatus,
              p.id AS projectId, p.project_code AS projectCode, p.title AS projectTitle,
              mc.id AS categoryId, mc.category_name AS categoryName,
              mc.task_description AS fileTaskDescription, mc.is_required AS isRequired,
              ms.id AS submissionId, ms.submission_status AS submissionStatus,
              ms.review_status AS reviewStatus, ms.return_reason AS returnReason,
              ms.submitted_at AS submittedAt,
              CASE WHEN mc.has_template = 1 THEN (
                SELECT COUNT(*) FROM task_template_attachments tta
                WHERE tta.material_task_id = mt.id AND tta.deleted_at IS NULL
                  AND (tta.material_category_id = mc.id OR tta.material_category_id IS NULL)
              ) ELSE 0 END AS templateCount
       FROM project_participations owner_rel
       JOIN projects p ON p.id = owner_rel.project_id AND p.deleted_at IS NULL
       JOIN material_tasks mt ON mt.deleted_at IS NULL AND mt.task_type = 'standard' AND mt.status IN ('published', 'closed')
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
    success(res, rows.map((row) => ({
      ...row,
      changeScope: parseJson(row.changeScope, null),
      allowedExtensions: Array.isArray(row.allowedExtensions) ? row.allowedExtensions : JSON.parse(row.allowedExtensions || '[]'),
      hasTemplate: Boolean(row.hasTemplate),
      isRequired: Boolean(row.isRequired),
      maxFileMb: Number(row.maxFileMb || 50),
      templateCount: Number(row.templateCount || 0)
    })));
  } catch (error) {
    next(error);
  }
});

router.post('/', requireAuth, requireRole('admin'), requireAdminPermission('material_task'), async (req, res, next) => {
  let connection;
  try {
    const data = taskPayload(req.body);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO material_tasks
       (task_name, task_description, task_type, change_phase, change_scope, project_scope_type, project_year, project_group, deadline_at,
        allowed_extensions, max_file_mb, max_task_project_mb, has_template, status, created_by)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.taskName, data.taskDescription, data.taskType, data.changePhase, data.changeScope ? JSON.stringify(data.changeScope) : null,
        data.projectScopeType, data.projectYear, data.projectGroup, data.deadlineAt,
        JSON.stringify(data.allowedExtensions), data.maxFileMb, data.maxTaskProjectMb, data.hasTemplate ? 1 : 0, data.status, req.user.id]
    );
    const savedFileTasks = [];
    for (const fileTask of data.fileTasks) {
      const [fileTaskResult] = await connection.execute(
        `INSERT INTO material_categories
         (material_task_id, category_name, task_description, allowed_extensions, max_file_mb, has_template, is_required, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, fileTask.categoryName, fileTask.taskDescription, JSON.stringify(fileTask.allowedExtensions),
          fileTask.maxFileMb, fileTask.hasTemplate ? 1 : 0, fileTask.isRequired ? 1 : 0, fileTask.sortOrder]
      );
      savedFileTasks.push({ id: fileTaskResult.insertId, categoryName: fileTask.categoryName });
    }
    for (const projectId of data.projectIds) {
      await connection.execute('INSERT INTO material_task_projects (material_task_id, project_id) VALUES (?, ?)', [result.insertId, projectId]);
    }
    if (['published', 'closed'].includes(data.status)) {
      await scanOverdueRequiredMaterials(connection, { materialTaskId: Number(result.insertId), actorUserId: req.user.id, triggerSource: 'business_event' });
    }
    await connection.commit();
    success(res, { id: result.insertId, fileTasks: savedFileTasks }, 'Material task created');
  } catch (error) {
    await connection?.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.put('/:id', requireAuth, requireRole('admin'), requireAdminPermission('material_task'), async (req, res, next) => {
  let connection;
  try {
    const data = taskPayload(req.body);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[task]] = await connection.execute('SELECT id, status, task_type AS taskType FROM material_tasks WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [req.params.id]);
    if (!task) throw notFound('Material task not found');
    if (task.taskType !== data.taskType) throw badRequest('任务类型创建后不可切换', 'MATERIAL_TASK_TYPE_IMMUTABLE');
    const [[submission]] = await connection.execute('SELECT id FROM material_submissions WHERE material_task_id = ? AND deleted_at IS NULL LIMIT 1', [req.params.id]);
    if (submission) throw badRequest('已有提交记录的统筹任务不能再修改', 'TASK_ALREADY_HAS_SUBMISSIONS');
    if (task.status === 'closed') throw badRequest('已关闭任务请重新开放后再修改', 'VALIDATION_ERROR');

    const [existingRows] = await connection.execute('SELECT id FROM material_categories WHERE material_task_id = ? AND deleted_at IS NULL FOR UPDATE', [req.params.id]);
    const existingIds = new Set(existingRows.map((row) => Number(row.id)));
    const submittedIds = data.fileTasks.map((item) => item.id).filter(Boolean);
    if (new Set(submittedIds).size !== submittedIds.length) {
      throw badRequest('fileTasks contains duplicate ids', 'VALIDATION_ERROR');
    }
    if (submittedIds.some((id) => !existingIds.has(id))) throw badRequest('fileTasks contains an item from another material task', 'VALIDATION_ERROR');
    const removedIds = [...existingIds].filter((id) => !submittedIds.includes(id));
    await ensureRemovedFileTasksAreUnused(removedIds);

    // Free the per-task unique category names before applying the final set. This
    // allows safe renames, swaps, and "remove A then rename B to A" in one edit.
    await connection.execute(
      `UPDATE material_categories
       SET category_name = CONCAT('__tmp_file_task_', id, '_', UUID()), updated_at = NOW()
       WHERE material_task_id = ? AND deleted_at IS NULL`,
      [req.params.id]
    );

    const [[commonTemplateRow]] = await connection.execute(
      'SELECT COUNT(*) AS total FROM task_template_attachments WHERE material_task_id = ? AND material_category_id IS NULL AND deleted_at IS NULL',
      [req.params.id]
    );
    const hasTemplate = Number(commonTemplateRow.total) > 0 || data.fileTasks.some((item) => item.hasTemplate);
    await connection.execute(
      `UPDATE material_tasks SET task_name=?, task_description=?, task_type=?, change_phase=?, change_scope=CAST(? AS JSON), project_scope_type=?, project_year=?, project_group=?,
       deadline_at=?, allowed_extensions=?, max_file_mb=?, max_task_project_mb=?, has_template=?, status=?, updated_at=NOW()
       WHERE id=?`,
      [data.taskName, data.taskDescription, data.taskType, data.changePhase, data.changeScope ? JSON.stringify(data.changeScope) : null,
        data.projectScopeType, data.projectYear, data.projectGroup,
        data.deadlineAt, JSON.stringify(data.allowedExtensions), data.maxFileMb, data.maxTaskProjectMb,
        hasTemplate ? 1 : 0, data.status, req.params.id]
    );

    const savedFileTasks = [];
    for (const fileTask of data.fileTasks) {
      if (fileTask.id) {
        await connection.execute(
          `UPDATE material_categories SET category_name=?, task_description=?, allowed_extensions=?, max_file_mb=?,
           has_template=?, is_required=?, sort_order=?, updated_at=NOW() WHERE id=? AND material_task_id=?`,
          [fileTask.categoryName, fileTask.taskDescription, JSON.stringify(fileTask.allowedExtensions), fileTask.maxFileMb,
            fileTask.hasTemplate ? 1 : 0, fileTask.isRequired ? 1 : 0, fileTask.sortOrder, fileTask.id, req.params.id]
        );
        savedFileTasks.push({ id: fileTask.id, categoryName: fileTask.categoryName });
      } else {
        const [fileTaskResult] = await connection.execute(
          `INSERT INTO material_categories
           (material_task_id, category_name, task_description, allowed_extensions, max_file_mb, has_template, is_required, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [req.params.id, fileTask.categoryName, fileTask.taskDescription, JSON.stringify(fileTask.allowedExtensions),
            fileTask.maxFileMb, fileTask.hasTemplate ? 1 : 0, fileTask.isRequired ? 1 : 0, fileTask.sortOrder]
        );
        savedFileTasks.push({ id: fileTaskResult.insertId, categoryName: fileTask.categoryName });
      }
    }
    if (removedIds.length) {
      await connection.execute(
        `UPDATE task_template_attachments SET deleted_at = NOW()
         WHERE material_category_id IN (${removedIds.map(() => '?').join(',')}) AND deleted_at IS NULL`,
        removedIds
      );
      await connection.execute(
        `UPDATE material_categories SET deleted_at = NOW(), updated_at = NOW()
         WHERE id IN (${removedIds.map(() => '?').join(',')})`,
        removedIds
      );
    }
    await connection.execute('DELETE FROM material_task_projects WHERE material_task_id = ?', [req.params.id]);
    for (const projectId of data.projectIds) {
      await connection.execute('INSERT INTO material_task_projects (material_task_id, project_id) VALUES (?, ?)', [req.params.id, projectId]);
    }
    if (['published', 'closed'].includes(data.status)) {
      await scanOverdueRequiredMaterials(connection, { materialTaskId: Number(req.params.id), actorUserId: req.user.id, triggerSource: 'business_event' });
    }
    await connection.commit();
    success(res, { id: Number(req.params.id), fileTasks: savedFileTasks }, 'Material task updated');
  } catch (error) {
    await connection?.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.patch('/:id/status', requireAuth, requireRole('admin'), requireAdminPermission('material_task'), async (req, res, next) => {
  let connection;
  try {
    const status = enumValue(req.body.status, taskStatuses, 'status');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.execute('UPDATE material_tasks SET status = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL', [status, req.params.id]);
    if (!result.affectedRows) throw notFound('Material task not found');
    if (['published', 'closed'].includes(status)) {
      await scanOverdueRequiredMaterials(connection, {
        materialTaskId: Number(req.params.id), actorUserId: req.user.id, triggerSource: 'business_event'
      });
    }
    await connection.commit();
    success(res, null, 'Task status updated');
  } catch (error) {
    await connection?.rollback().catch(() => undefined);
    next(error);
  } finally { connection?.release(); }
});

router.get('/:taskId/templates', requireAuth, requireRole('admin', 'project_owner'), requirePermissionWhenAdmin('material_task'), async (req, res, next) => {
  try {
    const categoryId = optionalPositiveInteger(req.query.categoryId, 'categoryId');
    await ensureMaterialTaskAccess(req.user, req.params.taskId, {
      categoryId,
      requireReleasedForOwner: true
    });
    const conditions = ['material_task_id = ?', 'deleted_at IS NULL'];
    const params = [req.params.taskId];
    if (categoryId) {
      conditions.push('(material_category_id = ? OR material_category_id IS NULL)');
      params.push(categoryId);
      const [[fileTask]] = await pool.execute(
        'SELECT has_template AS hasTemplate FROM material_categories WHERE id = ? AND material_task_id = ? AND deleted_at IS NULL LIMIT 1',
        [categoryId, req.params.taskId]
      );
      if (!fileTask || !fileTask.hasTemplate) return success(res, []);
    }
    const [rows] = await pool.execute(
      `SELECT id, material_task_id AS taskId, material_category_id AS categoryId,
              original_name AS originalName, file_size AS fileSize, mime_type AS mimeType, created_at AS createdAt
       FROM task_template_attachments WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      params
    );
    success(res, rows.map((row) => {
      const fileName = inspectOriginalFileName(row.originalName);
      return { ...row, originalName: fileName.displayName, storedOriginalName: fileName.originalName, fileNameRecovered: fileName.recovered, fileNameWarning: fileName.warning };
    }));
  } catch (error) {
    next(error);
  }
});

router.get('/:taskId/templates/:attachmentId/download', requireAuth, requireRole('admin', 'project_owner'), requirePermissionWhenAdmin('material_task'), async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT tta.original_name, tta.storage_path, tta.material_category_id AS categoryId
       FROM task_template_attachments tta
       LEFT JOIN material_categories mc ON mc.id = tta.material_category_id
       JOIN material_tasks mt ON mt.id = tta.material_task_id
       WHERE tta.id = ? AND tta.material_task_id = ? AND tta.deleted_at IS NULL
         AND ((tta.material_category_id IS NULL AND mt.has_template = 1)
           OR (tta.material_category_id IS NOT NULL AND mc.has_template = 1 AND mc.deleted_at IS NULL))
       LIMIT 1`,
      [req.params.attachmentId, req.params.taskId]
    );
    const attachment = rows[0];
    if (!attachment) throw notFound('Template attachment not found');
    await ensureMaterialTaskAccess(req.user, req.params.taskId, {
      categoryId: attachment.categoryId || null,
      requireReleasedForOwner: true
    });
    const filePath = await resolveDownloadFile(env.upload.root, attachment.storage_path, {
      invalidMessage: 'Template file path is outside the system upload directory',
      invalidCode: 'TEMPLATE_FILE_PATH_INVALID',
      missingMessage: 'Template file not found'
    });
    const fileName = inspectOriginalFileName(attachment.original_name).displayName;
    setFileResponseHeaders(res, { fileName, contentType: 'application/octet-stream' });
    fs.createReadStream(filePath).on('error', next).pipe(res);
  } catch (error) {
    next(error);
  }
});

export default router;
