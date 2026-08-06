import { pool } from '../db/pool.js';
import { forbidden, notFound } from './errors.js';

function userPersonId(user) {
  return Number(user?.personId || 0);
}

export async function ensureProjectAccess(user, projectId, connection = pool) {
  if (user?.role === 'admin') return;
  const [[allowed]] = await connection.execute(
    `SELECT 1
     FROM project_participations
     WHERE project_id = ? AND person_id = ? AND role = 'owner' AND deleted_at IS NULL
     LIMIT 1`,
    [projectId, userPersonId(user)]
  );
  if (!allowed) throw forbidden('No permission to access this project');
}

export async function ensureSubmissionAccess(user, submissionId, connection = pool) {
  const [[submission]] = await connection.execute(
    `SELECT id, project_id AS projectId
     FROM material_submissions
     WHERE id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [submissionId]
  );
  if (!submission) throw notFound('Submission not found');
  await ensureProjectAccess(user, submission.projectId, connection);
  return submission;
}

export async function ensureMaterialTaskAccess(user, taskId, {
  categoryId = null,
  requireReleasedForOwner = false,
  connection = pool
} = {}) {
  const params = [taskId];
  const categoryCondition = categoryId
    ? `AND EXISTS (
      SELECT 1 FROM material_categories mc
      WHERE mc.id = ? AND mc.material_task_id = mt.id AND mc.deleted_at IS NULL
    )`
    : '';
  if (categoryId) params.push(categoryId);

  const [[task]] = await connection.execute(
    `SELECT mt.id, mt.status
     FROM material_tasks mt
     WHERE mt.id = ? AND mt.deleted_at IS NULL ${categoryCondition}
     LIMIT 1`,
    params
  );
  if (!task) throw notFound('Material task not found');
  if (user?.role === 'admin') return task;

  const statusCondition = requireReleasedForOwner ? "AND mt.status IN ('published', 'closed')" : '';
  const ownerParams = [userPersonId(user), taskId];
  const ownerCategoryCondition = categoryId
    ? `AND EXISTS (
      SELECT 1 FROM material_categories mc
      WHERE mc.id = ? AND mc.material_task_id = mt.id AND mc.deleted_at IS NULL
    )`
    : '';
  if (categoryId) ownerParams.push(categoryId);

  const [[allowed]] = await connection.execute(
    `SELECT 1
     FROM material_tasks mt
     JOIN projects p ON p.deleted_at IS NULL
     JOIN project_participations pp
       ON pp.project_id = p.id
      AND pp.person_id = ?
      AND pp.role = 'owner'
      AND pp.deleted_at IS NULL
     WHERE mt.id = ?
       AND mt.deleted_at IS NULL
       ${statusCondition}
       ${ownerCategoryCondition}
       AND (
         mt.project_scope_type = 'all'
         OR (mt.project_scope_type = 'year' AND mt.project_year = p.project_year)
         OR (mt.project_scope_type = 'group' AND mt.project_group = p.project_group)
         OR (mt.project_scope_type = 'custom' AND EXISTS (
           SELECT 1 FROM material_task_projects mtp
           WHERE mtp.material_task_id = mt.id AND mtp.project_id = p.id
         ))
       )
     LIMIT 1`,
    ownerParams
  );
  if (!allowed) throw forbidden('No permission to access this material task');
  return task;
}
