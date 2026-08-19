import { badRequest, notFound } from './errors.js';

export const FORMAL_PROJECT_STATUSES = Object.freeze(['active', 'checking', 'completed', 'archived', 'stopped']);

export function isFormalProjectStatus(status) {
  return FORMAL_PROJECT_STATUSES.includes(status);
}

export async function assertEligibleProjectOwner(connection, personId, projectId = null) {
  const [[person]] = await connection.execute(
    `SELECT id, person_type, deleted_at FROM people WHERE id = ? LIMIT 1 FOR UPDATE`,
    [personId]
  );
  if (!person || person.deleted_at) throw notFound('负责人不存在');
  if (person.person_type !== 'student') {
    throw badRequest('正式项目负责人必须是学生', 'PROJECT_OWNER_MUST_BE_STUDENT');
  }
  const params = [personId];
  let exclude = '';
  if (projectId) {
    exclude = 'AND pp.project_id <> ?';
    params.push(projectId);
  }
  const [[owned]] = await connection.execute(
    `SELECT pp.project_id
     FROM project_participations pp
     JOIN projects p ON p.id = pp.project_id AND p.deleted_at IS NULL
     WHERE pp.person_id = ? AND pp.role = 'owner' AND pp.deleted_at IS NULL ${exclude}
     LIMIT 1 FOR UPDATE`,
    params
  );
  if (owned) {
    throw badRequest('一个学生最多负责一个未删除的正式项目', 'OWNER_PROJECT_LIMIT');
  }
  return person;
}

export async function assertFormalProjectOwnership(connection, projectIds = null) {
  const ids = [...new Set((projectIds || []).map(Number).filter(Number.isInteger))];
  if (Array.isArray(projectIds) && !ids.length) return;
  const params = [...FORMAL_PROJECT_STATUSES];
  let scope = '';
  if (ids.length) {
    scope = `AND p.id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  const [invalid] = await connection.execute(
    `SELECT p.id, p.project_code, COUNT(pp.id) AS owner_count
     FROM projects p
     LEFT JOIN project_participations pp
       ON pp.project_id = p.id AND pp.role = 'owner' AND pp.deleted_at IS NULL
     WHERE p.deleted_at IS NULL AND p.status IN (${FORMAL_PROJECT_STATUSES.map(() => '?').join(',')}) ${scope}
     GROUP BY p.id
     HAVING COUNT(pp.id) <> 1
     LIMIT 20`,
    params
  );
  if (invalid.length) {
    const codes = invalid.map((row) => `${row.project_code}（负责人 ${Number(row.owner_count)} 人）`).join('、');
    throw badRequest(`正式项目必须且只能有一名负责人：${codes}`, 'FORMAL_PROJECT_OWNER_REQUIRED');
  }

  const ownerTypeParams = [...FORMAL_PROJECT_STATUSES];
  let ownerTypeScope = '';
  if (ids.length) {
    ownerTypeScope = `AND p.id IN (${ids.map(() => '?').join(',')})`;
    ownerTypeParams.push(...ids);
  }
  const [invalidOwnerTypes] = await connection.execute(
    `SELECT p.project_code, pe.id AS person_id
     FROM projects p
     JOIN project_participations pp ON pp.project_id = p.id AND pp.role = 'owner' AND pp.deleted_at IS NULL
     JOIN people pe ON pe.id = pp.person_id
     WHERE p.deleted_at IS NULL AND p.status IN (${FORMAL_PROJECT_STATUSES.map(() => '?').join(',')})
       AND (pe.deleted_at IS NOT NULL OR pe.person_type <> 'student') ${ownerTypeScope}
     LIMIT 20`,
    ownerTypeParams
  );
  if (invalidOwnerTypes.length) {
    throw badRequest('正式项目负责人必须是未删除的学生', 'PROJECT_OWNER_MUST_BE_STUDENT');
  }

  const duplicateParams = [...FORMAL_PROJECT_STATUSES];
  let duplicateScope = '';
  if (ids.length) {
    duplicateScope = `AND EXISTS (
      SELECT 1
      FROM project_participations scoped_owner
      JOIN projects scoped_project ON scoped_project.id = scoped_owner.project_id AND scoped_project.deleted_at IS NULL
      WHERE scoped_owner.person_id = pp.person_id
        AND scoped_owner.role = 'owner' AND scoped_owner.deleted_at IS NULL
        AND scoped_project.status IN (${FORMAL_PROJECT_STATUSES.map(() => '?').join(',')})
        AND scoped_owner.project_id IN (${ids.map(() => '?').join(',')})
    )`;
    duplicateParams.push(...FORMAL_PROJECT_STATUSES);
    duplicateParams.push(...ids);
  }
  const [duplicates] = await connection.execute(
    `SELECT pp.person_id, COUNT(DISTINCT pp.project_id) AS project_count
     FROM project_participations pp
     JOIN projects p ON p.id = pp.project_id AND p.deleted_at IS NULL
     WHERE pp.role = 'owner' AND pp.deleted_at IS NULL
       AND p.status IN (${FORMAL_PROJECT_STATUSES.map(() => '?').join(',')}) ${duplicateScope}
     GROUP BY pp.person_id
     HAVING COUNT(DISTINCT pp.project_id) > 1
     LIMIT 20`,
    duplicateParams
  );
  if (duplicates.length) {
    throw badRequest('存在同一学生负责多个未删除正式项目的冲突', 'OWNER_PROJECT_LIMIT');
  }
}

export function affectedProjectIds(records) {
  const ids = [];
  for (const record of records || []) {
    if (record.entityType === 'project' && record.targetId) ids.push(Number(record.targetId));
    if (record.entityType === 'participation') {
      const projectId = record.afterSnapshot?.project_id || record.beforeSnapshot?.project_id;
      if (projectId) ids.push(Number(projectId));
    }
  }
  return [...new Set(ids.filter(Number.isInteger))];
}

export async function ownershipProjectIdsForPeople(connection, personIds) {
  const ids = [...new Set((personIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return [];
  const [rows] = await connection.execute(
    `SELECT DISTINCT pp.project_id
     FROM project_participations pp
     JOIN projects p ON p.id = pp.project_id AND p.deleted_at IS NULL
     WHERE pp.role = 'owner' AND pp.deleted_at IS NULL
       AND pp.person_id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  return rows.map((row) => Number(row.project_id));
}
